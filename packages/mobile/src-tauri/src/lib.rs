use tauri::Manager;

#[cfg(target_os = "android")]
mod runtime;
#[cfg(target_os = "android")]
mod llm;
// `validate` is pure Rust (no Android-specific deps) and is now referenced
// from `speech.rs` (host-compiled). Keep it available on every target — the
// few `#[allow(dead_code)]`s inside guard against the unused-symbol warnings
// when no caller is cfg-enabled.
#[allow(dead_code)]
mod validate;
#[cfg(target_os = "android")]
mod proxy;
mod kokoro;
mod parakeet;
mod speech;

/// Install the process-wide logger. Release builds log at Info level, debug
/// builds at Debug. On Android we route to logcat (`adb logcat -s OpenCode:I`);
/// on desktop we rely on stderr. Called once during `run()`.
fn init_logging() {
    #[cfg(target_os = "android")]
    {
        let level = if cfg!(debug_assertions) {
            log::LevelFilter::Debug
        } else {
            log::LevelFilter::Info
        };
        android_logger::init_once(
            android_logger::Config::default()
                .with_max_level(level)
                .with_tag("OpenCode"),
        );
    }
}

/// Append a line to runtime/logs/debug.log for JavaScript-side diagnostics.
#[cfg(target_os = "android")]
#[tauri::command]
fn write_debug_log(app: tauri::AppHandle, message: String) {
    // Bound defensively — a hostile caller could otherwise flood the log
    // file. Silently truncate rather than erroring (the command is called
    // from JS on hot paths and a Result would complicate every call site).
    let message = if message.len() > 8192 {
        let mut cutoff = 8192;
        while cutoff > 0 && !message.is_char_boundary(cutoff) {
            cutoff -= 1;
        }
        &message[..cutoff]
    } else {
        message.as_str()
    };
    use std::io::Write;
    let dir = runtime::runtime_dir(&app);
    let log_dir = dir.join("logs");
    let _ = std::fs::create_dir_all(&log_dir);
    if let Ok(mut f) = std::fs::OpenOptions::new().create(true).append(true).open(log_dir.join("debug.log")) {
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_secs())
            .unwrap_or(0);
        let _ = writeln!(f, "[{}] {}", now, message);
    }
    log::debug!("[debug.log] {}", message);
}

/// Fetch a URL using a reqwest client that accepts self-signed TLS certificates.
/// Used by the mobile app to connect to the desktop OpenCode server in Internet
/// mode (which uses an rcgen self-signed cert that rustls/Mozilla CA bundle
/// does not trust). The fingerprint is validated by the caller (JS side) via
/// the `fp` parameter received from the pairing QR code.
///
/// dead_code allow: registered in invoke_handler under `#[cfg(target_os="android")]`,
/// so host cargo check sees no caller.
#[allow(dead_code)]
#[tauri::command]
async fn fetch_private_server(
    url: String,
    method: Option<String>,
    headers: Option<std::collections::HashMap<String, String>>,
    body: Option<String>,
) -> Result<serde_json::Value, String> {
    // Defence in depth: bound the URL and body so an XSS cannot pin the
    // process with multi-MB strings. The URL allowlist is enforced at the
    // JS layer (the fingerprint-validated remote-server URL) — we do not
    // duplicate the allowlist here because custom desktop ports are
    // legitimate.
    crate::validate::validate_bounded_text(&url, 4096, "url")?;
    if url.contains('\n') || url.contains('\r') {
        return Err("url contains control characters".into());
    }
    if let Some(ref b) = body {
        crate::validate::validate_bounded_text(b, 16 * 1024 * 1024, "body")?;
    }
    let client = reqwest::Client::builder()
        .danger_accept_invalid_certs(true)
        .timeout(std::time::Duration::from_secs(30))
        .build()
        .map_err(|e| e.to_string())?;

    let method_str = method.unwrap_or_else(|| "GET".into());
    let parsed_method: reqwest::Method = method_str.parse().map_err(|_| format!("invalid method: {method_str}"))?;
    let mut req = client.request(parsed_method, &url);

    for (k, v) in headers.unwrap_or_default() {
        req = req.header(k, v);
    }
    if let Some(b) = body {
        req = req.body(b);
    }

    let resp = req.send().await.map_err(|e| e.to_string())?;
    let status = resp.status().as_u16();
    let body = resp.text().await.map_err(|e| e.to_string())?;
    Ok(serde_json::json!({ "status": status, "body": body }))
}

/// Return the current Android thermal state. Maps
/// `PowerManager.getCurrentThermalStatus()` (API 29+) to one of:
/// "nominal" | "fair" | "serious" | "critical".
///
/// Mapping (Android PowerManager THERMAL_STATUS_* constants):
///   NONE (0), LIGHT (1)                 -> "nominal"
///   MODERATE (2)                        -> "fair"
///   SEVERE (3)                          -> "serious"
///   CRITICAL (4), EMERGENCY (5), SHUTDOWN (6) -> "critical"
///
/// Implementation (I9, Sprint 3 cleanup): JNI query to
/// PowerManager.getCurrentThermalStatus(). Falls back to "nominal" on any
/// JNI error or pre-API-29 device — the TS cache layer tolerates stale reads.
///
/// Polling model: callers poll every ~30s; this matches Android Thermal API
/// guidance and avoids the complexity of a PowerManager.OnThermalStatusChangedListener
/// which would require holding a long-lived JNI global ref. If future work
/// wants push updates, see the `thermal_listener.md` design note.
#[cfg(target_os = "android")]
#[tauri::command]
fn get_thermal_state() -> &'static str {
    match query_thermal_status_jni() {
        Ok(code) => thermal_code_to_label(code),
        Err(e) => {
            log::debug!("[thermal] JNI query failed, returning nominal: {}", e);
            "nominal"
        }
    }
}

#[cfg(target_os = "android")]
fn thermal_code_to_label(code: i32) -> &'static str {
    match code {
        0 | 1 => "nominal",        // NONE, LIGHT
        2 => "fair",               // MODERATE
        3 => "serious",            // SEVERE
        _ if code >= 4 => "critical", // CRITICAL, EMERGENCY, SHUTDOWN
        _ => "nominal",            // unknown/negative — be conservative
    }
}

#[cfg(target_os = "android")]
fn query_thermal_status_jni() -> Result<i32, String> {
    use jni::objects::{JObject, JString, JValue};

    // SAFETY: ndk_context is populated by the Tauri/Android runtime before
    // our code runs. The VM and context pointers stay valid for the process
    // lifetime. We never mutate either.
    let ctx = ndk_context::android_context();
    let vm = unsafe { jni::JavaVM::from_raw(ctx.vm().cast()) }
        .map_err(|e| format!("JavaVM::from_raw: {e:?}"))?;
    let mut env = vm
        .attach_current_thread()
        .map_err(|e| format!("attach_current_thread: {e:?}"))?;

    let activity = unsafe { JObject::from_raw(ctx.context().cast()) };

    // Context.getSystemService("power") -> PowerManager
    let service_name: JString = env
        .new_string("power")
        .map_err(|e| format!("new_string: {e:?}"))?;
    let pm = env
        .call_method(
            &activity,
            "getSystemService",
            "(Ljava/lang/String;)Ljava/lang/Object;",
            &[JValue::Object(&service_name)],
        )
        .map_err(|e| format!("getSystemService: {e:?}"))?
        .l()
        .map_err(|e| format!("getSystemService ret: {e:?}"))?;

    if pm.is_null() {
        return Err("PowerManager unavailable".into());
    }

    // PowerManager.getCurrentThermalStatus() -> int (API 29+)
    let status = env
        .call_method(&pm, "getCurrentThermalStatus", "()I", &[])
        .map_err(|e| format!("getCurrentThermalStatus: {e:?}"))?
        .i()
        .map_err(|e| format!("getCurrentThermalStatus ret: {e:?}"))?;

    Ok(status)
}

// Desktop placeholder — see I9 backlog. A real implementation would need a
// native hook per OS: Windows WMI (MSAcpi_ThermalZoneTemperature),
// Linux /sys/class/thermal/thermal_zone*/temp, macOS IOKit SMC.

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    init_logging();

    #[cfg_attr(not(target_os = "android"), allow(unused_mut))]
    let mut builder = tauri::Builder::default()
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_os::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_haptics::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_dialog::init());

    // Register Android-only embedded runtime commands
    #[cfg(target_os = "android")]
    {
        builder = builder.invoke_handler(tauri::generate_handler![
            fetch_private_server,
            write_debug_log,
            get_thermal_state,
            runtime::check_runtime,
            runtime::extract_runtime,
            runtime::start_embedded_server,
            runtime::check_local_health,
            runtime::stop_local_server,
            runtime::install_extended_env,
            runtime::read_server_logs,
            runtime::list_storage_roots,
            llm::list_models,
            llm::download_model,
            llm::delete_model,
            llm::load_llm_model,
            llm::unload_llm_model,
            llm::is_llm_loaded,
            llm::abort_llm,
            llm::generate_llm,
            llm::check_llm_health,
            llm::llm_idle_tick,
            llm::set_llm_config,
            llm::get_memory_info,
            speech::stt_download_model,
            speech::stt_load_model,
            speech::stt_transcribe,
            speech::stt_available,
            speech::stt_loaded,
            speech::tts_start,
            speech::tts_speak,
            speech::tts_stop,
            speech::tts_save_voice_clone,
            speech::tts_list_voice_clones,
            speech::tts_delete_voice_clone,
            speech::tts_available,
            speech::kokoro_available,
            speech::kokoro_download_model,
            speech::kokoro_load,
            speech::kokoro_loaded,
            speech::kokoro_voices,
            speech::kokoro_synthesize,
        ]);
    }

    builder
        .setup(|app| {
            app.manage(speech::SpeechState::new());
            #[cfg(debug_assertions)]
            {
                let window = app.get_webview_window("main").unwrap();
                window.open_devtools();
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
