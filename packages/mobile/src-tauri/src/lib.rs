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
    log::info!("[debug.log] {}", message);
}

/// Streaming wire protocol for `fetch_private_server`. Status + headers are
/// emitted first so the JS side can resolve the `Response`, then `Chunk`
/// messages stream the body until `End` (or `Error` on failure). SSE / chat
/// events are async-iterable on top of `response.body`, so a buffered
/// `resp.text().await` starved the SDK reader and chat tokens never arrived.
#[cfg(target_os = "android")]
#[derive(serde::Serialize, Clone)]
#[serde(tag = "kind")]
#[allow(dead_code)]
enum PrivateFetchMsg {
    Headers {
        status: u16,
        headers: std::collections::HashMap<String, String>,
    },
    Chunk {
        data: Vec<u8>,
    },
    End,
    Error {
        message: String,
    },
}

/// Fetch a URL with a reqwest client that accepts self-signed TLS certs,
/// streaming the body to JS through a Tauri Channel so SSE / chat tokens
/// flow incrementally instead of buffering the whole response.
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
    on_event: tauri::ipc::Channel<PrivateFetchMsg>,
) -> Result<(), String> {
    use futures_util::StreamExt;

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
        // No global timeout: SSE streams can be idle for many minutes between
        // events. Keepalive / heartbeats are the SDK's job.
        .build()
        .map_err(|e| e.to_string())?;

    let method_str = method.unwrap_or_else(|| "GET".into());
    let parsed_method: reqwest::Method = method_str
        .parse()
        .map_err(|_| format!("invalid method: {method_str}"))?;
    let mut req = client.request(parsed_method, &url);

    for (k, v) in headers.unwrap_or_default() {
        req = req.header(k, v);
    }
    if let Some(b) = body {
        req = req.body(b);
    }

    log::info!("[priv-fetch] start url={url} method={method_str}");
    let resp = match req.send().await {
        Ok(r) => r,
        Err(e) => {
            log::warn!("[priv-fetch] send error url={url}: {e}");
            let _ = on_event.send(PrivateFetchMsg::Error {
                message: e.to_string(),
            });
            return Err(e.to_string());
        }
    };
    let status = resp.status().as_u16();
    let content_type = resp
        .headers()
        .get("content-type")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
        .to_string();
    let content_length = resp.headers().get("content-length").and_then(|v| v.to_str().ok()).map(String::from);
    log::info!(
        "[priv-fetch] response status={status} content_type={content_type:?} content_length={content_length:?} url={url}"
    );

    let mut resp_headers = std::collections::HashMap::<String, String>::new();
    for (name, value) in resp.headers() {
        if let Ok(v) = value.to_str() {
            resp_headers.insert(name.to_string(), v.to_string());
        }
    }
    if on_event
        .send(PrivateFetchMsg::Headers {
            status,
            headers: resp_headers,
        })
        .is_err()
    {
        log::warn!("[priv-fetch] channel closed before Headers delivered url={url}");
        return Ok(());
    }

    // For non-streaming responses (everything except SSE / ndjson), pull the
    // body in one shot via `resp.bytes()`. This is more reliable than
    // `bytes_stream()` for short bodies — some HTTP/2 + rustls + self-signed
    // cert combinations leave the per-chunk stream pending even after
    // Content-Length bytes have been read, which kept JS-side
    // `Response.text()` waiting forever and caused the SDK to abort the
    // POST after its internal timeout.
    let is_streaming =
        content_type.contains("text/event-stream") || content_type.contains("application/x-ndjson");

    if is_streaming {
        let mut stream = resp.bytes_stream();
        let mut chunk_count: u64 = 0;
        while let Some(chunk_result) = stream.next().await {
            match chunk_result {
                Ok(chunk) => {
                    chunk_count += 1;
                    let chunk_len = chunk.len();
                    if on_event
                        .send(PrivateFetchMsg::Chunk {
                            data: chunk.to_vec(),
                        })
                        .is_err()
                    {
                        log::info!(
                            "[priv-fetch] channel dropped at chunk #{chunk_count} url={url}"
                        );
                        return Ok(());
                    }
                    if chunk_count == 1 || chunk_count.is_multiple_of(20) {
                        log::info!("[priv-fetch] stream chunk #{chunk_count} ({chunk_len}b) url={url}");
                    }
                }
                Err(e) => {
                    log::warn!("[priv-fetch] stream error url={url}: {e}");
                    let _ = on_event.send(PrivateFetchMsg::Error {
                        message: e.to_string(),
                    });
                    return Err(e.to_string());
                }
            }
        }
        log::info!("[priv-fetch] stream End ({chunk_count} chunks) url={url}");
    } else {
        match resp.bytes().await {
            Ok(body) => {
                let len = body.len();
                if !body.is_empty()
                    && on_event
                        .send(PrivateFetchMsg::Chunk {
                            data: body.to_vec(),
                        })
                        .is_err()
                {
                    log::warn!("[priv-fetch] channel closed before single-shot chunk delivered url={url}");
                    return Ok(());
                }
                log::info!("[priv-fetch] single-shot body {len}b url={url}");
            }
            Err(e) => {
                log::warn!("[priv-fetch] body read error url={url}: {e}");
                let _ = on_event.send(PrivateFetchMsg::Error {
                    message: e.to_string(),
                });
                return Err(e.to_string());
            }
        }
    }

    let _ = on_event.send(PrivateFetchMsg::End);
    log::info!("[priv-fetch] command return Ok url={url}");
    Ok(())
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
