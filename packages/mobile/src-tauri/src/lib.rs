use tauri::Manager;

#[cfg(target_os = "android")]
mod termux;

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
        .plugin(tauri_plugin_shell::init());

    // Register Android-only Termux commands
    #[cfg(target_os = "android")]
    {
        builder = builder.invoke_handler(tauri::generate_handler![
            termux::check_termux,
            termux::launch_termux_server,
            termux::check_local_health,
            termux::open_termux_setup,
            termux::stop_local_server,
        ]);
    }

    builder
        .setup(|app| {
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
