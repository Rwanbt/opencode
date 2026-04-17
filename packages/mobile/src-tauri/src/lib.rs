use tauri::Manager;

#[cfg(target_os = "android")]
mod runtime;
#[cfg(target_os = "android")]
mod llm;
#[cfg(target_os = "android")]
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
#[tauri::command]
async fn fetch_private_server(
    url: String,
    method: Option<String>,
    headers: Option<std::collections::HashMap<String, String>>,
    body: Option<String>,
) -> Result<serde_json::Value, String> {
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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    init_logging();

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
