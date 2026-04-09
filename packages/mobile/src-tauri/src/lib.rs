use tauri::Manager;

#[cfg(target_os = "android")]
mod runtime;
#[cfg(target_os = "android")]
mod llm;
#[cfg(target_os = "android")]
mod proxy;
mod kokoro;
mod parakeet;
mod speech;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
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
            runtime::check_runtime,
            runtime::extract_runtime,
            runtime::start_embedded_server,
            runtime::check_local_health,
            runtime::stop_local_server,
            runtime::install_extended_env,
            runtime::read_server_logs,
            llm::list_models,
            llm::download_model,
            llm::delete_model,
            llm::load_llm_model,
            llm::unload_llm_model,
            llm::is_llm_loaded,
            llm::abort_llm,
            llm::generate_llm,
            llm::check_llm_health,
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
