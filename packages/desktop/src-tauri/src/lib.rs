mod auth_storage;
mod cli;
mod constants;
mod child_processes;
mod identity_generated;
mod llm;
mod util;
mod validate;
// pub for examples/test_kokoro.rs — revert to `mod` if examples are removed
pub mod kokoro;
mod parakeet;
mod speech;
#[cfg(target_os = "linux")]
pub mod linux_display;
#[cfg(target_os = "linux")]
pub mod linux_windowing;
mod logging;
mod markdown;
mod os;
mod server;
mod tls;
mod window_customizer;
mod windows;

use crate::cli::CommandChild;
use futures::{FutureExt, TryFutureExt};
use std::{
    env,
    future::Future,
    net::TcpListener,
    path::{Path, PathBuf},
    process::Command,
    sync::{Arc, Mutex, OnceLock},
    time::Duration,
};
use tauri::{AppHandle, Listener, Manager, RunEvent, State, ipc::Channel};
#[cfg(any(target_os = "linux", all(debug_assertions, windows)))]
use tauri_plugin_deep_link::DeepLinkExt;
use tauri_specta::Event;
use tokio::{
    sync::{oneshot, watch},
    time::{sleep, timeout},
};

use crate::cli::{sqlite_migration::SqliteMigrationProgress, sync_cli};
use crate::constants::*;
use crate::windows::{LoadingWindow, MainWindow};

#[derive(Clone, serde::Serialize, specta::Type, Debug)]
struct ServerReadyData {
    url: String,
    username: Option<String>,
    password: Option<String>,
}

#[derive(Clone, Copy, serde::Serialize, specta::Type, Debug)]
#[serde(tag = "phase", rename_all = "snake_case")]
enum InitStep {
    ServerWaiting,
    SqliteWaiting,
    Done,
}

#[derive(serde::Deserialize, specta::Type)]
#[serde(rename_all = "snake_case")]
enum WslPathMode {
    Windows,
    Linux,
}

struct InitState {
    current: watch::Receiver<InitStep>,
}

struct ServerState {
    child: Arc<Mutex<Option<CommandChild>>>,
}

/// Resolves with sidecar credentials as soon as the sidecar is spawned (before health check).
struct SidecarReady(futures::future::Shared<oneshot::Receiver<ServerReadyData>>);

#[derive(Clone, serde::Serialize, serde::Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
struct WorkbenchWorkspace {
    workspace_id: String,
    instance_id: String,
}

#[derive(Clone, serde::Serialize, serde::Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
struct WorkbenchLease {
    token: String,
    token_id: String,
    instance_id: String,
    workspace_id: String,
    capabilities: Vec<String>,
    // f64: specta rejects u64 (BigIntForbidden); epoch milliseconds are exact
    // in f64 up to 2^53 (year 285616). The TypeScript side already types these
    // as `number` and validates them with Number.isSafeInteger — see
    // packages/workbench-shell/src/native-token-bridge.ts.
    issued_at: f64,
    expires_at: f64,
}

#[derive(Clone, serde::Serialize, serde::Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
struct WorkbenchRotation {
    token: WorkbenchLease,
    previous_token: Option<String>,
    // f64: specta rejects u64 (BigIntForbidden); a grace period in milliseconds
    // is orders of magnitude below f64's exact-integer range.
    grace_period_ms: f64,
}

#[tauri::command]
#[specta::specta]
fn open_design_browser(app: AppHandle, url: String) -> Result<String, String> {
    windows::open_design_browser(&app, &url)
}

#[tauri::command]
#[specta::specta]
fn navigate_design_browser(app: AppHandle, label: String, action: String) -> Result<(), String> {
    windows::navigate_design_browser(&app, &label, &action)
}

#[tauri::command]
#[specta::specta]
fn close_design_browser(app: AppHandle, label: String) -> Result<(), String> {
    windows::close_design_browser(&app, &label)
}

async fn workbench_native_request(
    ready: &SidecarReady,
    action: &str,
    workspace_path: Option<&str>,
    workspace_id: Option<&str>,
    capabilities: &[String],
) -> Result<serde_json::Value, String> {
    let server = ready.0.clone().await.map_err(|_| "sidecar readiness channel closed".to_string())?;
    let ipc = auth_storage::endpoint().ok_or_else(|| "native keychain IPC is unavailable".to_string())?;
    let url = format!("{}/workbench/native/token", server.url.trim_end_matches('/'));
    let body = serde_json::json!({
        "action": action,
        "workspacePath": workspace_path,
        "workspaceId": workspace_id,
        "capabilities": capabilities,
    });
    let client = reqwest::Client::builder().no_proxy().timeout(Duration::from_secs(10)).build().map_err(|e| format!("native Workbench client: {e}"))?;
    let response = client.post(url).header("x-unifia-keychain-token", &ipc.token).json(&body).send().await.map_err(|e| format!("native Workbench request: {e}"))?;
    let status = response.status();
    let text = response.text().await.map_err(|e| format!("native Workbench response: {e}"))?;
    let value = serde_json::from_str::<serde_json::Value>(&text).map_err(|e| format!("native Workbench invalid response: {e}"))?;
    if !status.is_success() { return Err(value.get("error").and_then(serde_json::Value::as_str).unwrap_or("native Workbench request failed").to_string()) }
    Ok(value)
}

#[tauri::command]
#[specta::specta]
async fn workbench_open_workspace(state: State<'_, SidecarReady>, workspace_path: String) -> Result<WorkbenchWorkspace, String> {
    let value = workbench_native_request(&state, "open", Some(&workspace_path), None, &[]).await?;
    serde_json::from_value(value).map_err(|e| format!("native Workbench workspace response: {e}"))
}

/// The capabilities a WebView may lease at connection time. This is a real
/// second gate, not a mirror: before it existed, `capabilities: Vec<String>`
/// reached the sidecar completely unvalidated, so a compromised WebView could
/// simply ask for more.
///
/// It MUST equal `SURFACE_LEASE_CAPABILITIES` in
/// packages/workbench-shell/src/routes.ts — the list the app actually
/// requests. When it did not, `workbench_issue_token` refused the request and
/// the whole Workbench connection failed, which no TypeScript test could see
/// because the check lives here. `scripts/check-capability-lease-parity.mjs`
/// compares the two files and is wired into the verification gates.
///
/// Widened beyond read/watch on 2026-08-23: the Fichiers CRUD, composer
/// uploads and artifact preview are real Design operations, and none of them
/// has an approval UI able to answer the 202 the broker would otherwise
/// return. Step-up capabilities (artifact.create, artifact.export) stay OUT —
/// the server grants those through its own gate when the operation is called,
/// never by handing the WebView a broader token.
const ALLOWED_CONNECTION_CAPABILITIES: &[&str] = &[
    "workspace.read",
    "workspace.write",
    "workspace.watch",
    "artifact.preview",
];

fn reject_disallowed_capabilities(requested: &[String]) -> Result<(), String> {
    for capability in requested {
        if !ALLOWED_CONNECTION_CAPABILITIES.contains(&capability.as_str()) {
            return Err(format!("capability not allowed at connection: {capability}"));
        }
    }
    Ok(())
}

#[tauri::command]
#[specta::specta]
async fn workbench_issue_token(state: State<'_, SidecarReady>, workspace_id: String, capabilities: Vec<String>) -> Result<WorkbenchLease, String> {
    reject_disallowed_capabilities(&capabilities)?;
    let value = workbench_native_request(&state, "issue", None, Some(&workspace_id), &capabilities).await?;
    serde_json::from_value(value).map_err(|e| format!("native Workbench lease response: {e}"))
}

#[tauri::command]
#[specta::specta]
async fn workbench_rotate_token(state: State<'_, SidecarReady>, workspace_id: String, capabilities: Vec<String>) -> Result<WorkbenchRotation, String> {
    reject_disallowed_capabilities(&capabilities)?;
    let value = workbench_native_request(&state, "rotate", None, Some(&workspace_id), &capabilities).await?;
    serde_json::from_value(value).map_err(|e| format!("native Workbench rotation response: {e}"))
}

#[cfg(test)]
mod capability_allowlist_tests {
    use super::reject_disallowed_capabilities;

    #[test]
    fn accepts_the_read_watch_connection_lease() {
        let requested = vec!["workspace.read".to_string(), "workspace.watch".to_string()];
        assert!(reject_disallowed_capabilities(&requested).is_ok());
    }

    /// The exact list packages/workbench-shell/src/routes.ts requests. A
    /// mismatch here refuses the lease and breaks the whole connection, so it
    /// is asserted verbatim rather than derived.
    #[test]
    fn accepts_the_full_surface_lease_the_app_requests() {
        let requested = vec![
            "workspace.read".to_string(),
            "workspace.write".to_string(),
            "workspace.watch".to_string(),
            "artifact.preview".to_string(),
        ];
        assert!(reject_disallowed_capabilities(&requested).is_ok(), "the Rust allowlist drifted from SURFACE_LEASE_CAPABILITIES");
    }

    /// Step-up capabilities are granted by the server when the operation runs,
    /// never leased at connection.
    #[test]
    fn refuses_step_up_capabilities_at_connection() {
        for capability in ["artifact.create", "artifact.export"] {
            assert!(reject_disallowed_capabilities(&[capability.to_string()]).is_err(), "{capability} must not be leasable");
        }
    }

    #[test]
    fn accepts_an_empty_request() {
        assert!(reject_disallowed_capabilities(&[]).is_ok());
    }

    #[test]
    fn refuses_a_capability_outside_the_allowlist() {
        let requested = vec!["workflow.run".to_string()];
        let error = reject_disallowed_capabilities(&requested).expect_err("workflow.run must be refused");
        assert!(error.contains("workflow.run"), "error should name the refused capability: {error}");
    }

    #[test]
    fn refuses_a_mixed_request_containing_one_disallowed_capability() {
        let requested = vec!["workspace.read".to_string(), "desktop.control".to_string()];
        assert!(reject_disallowed_capabilities(&requested).is_err());
    }
}

#[tauri::command]
#[specta::specta]
async fn workbench_revoke_token(state: State<'_, SidecarReady>, workspace_id: String) -> Result<(), String> {
    workbench_native_request(&state, "revoke", None, Some(&workspace_id), &[]).await.map(|_| ())
}

#[tauri::command]
#[specta::specta]
fn kill_sidecar(app: AppHandle) {
    let Some(server_state) = app.try_state::<ServerState>() else {
        tracing::info!("Server not running");
        return;
    };

    let Some(server_state) = server_state
        .child
        .lock()
        .expect("Failed to acquire mutex lock")
        .take()
    else {
        tracing::info!("Server state missing");
        return;
    };

    let _ = server_state.kill();

    tracing::info!("Killed server");
}

#[tauri::command]
#[specta::specta]
async fn await_initialization(
    state: State<'_, SidecarReady>,
    init_state: State<'_, InitState>,
    events: Channel<InitStep>,
) -> Result<ServerReadyData, String> {
    let mut rx = init_state.current.clone();

    // Stream InitStep progress in the BACKGROUND. The UI must not block on
    // InitStep::Done — that step only fires after the sidecar health check,
    // which can take up to 30s on a slow/misconfigured sidecar. Credentials are
    // available the moment the sidecar is spawned, so we return them immediately
    // and let the SDK connection retry until the server is healthy. The progress
    // events keep flowing for any listener (e.g. the loading window).
    tauri::async_runtime::spawn(async move {
        let e = *rx.borrow();
        let _ = events.send(e);

        while rx.changed().await.is_ok() {
            let step = *rx.borrow_and_update();
            let _ = events.send(step);

            if matches!(step, InitStep::Done) {
                break;
            }
        }
    });

    // Return sidecar credentials as soon as they are available (immediate,
    // before the health check completes).
    state
        .inner()
        .0
        .clone()
        .await
        .map_err(|_| "Failed to get sidecar data".to_string())
}

#[tauri::command]
#[specta::specta]
fn check_app_exists(app_name: &str) -> bool {
    // Refuse traversal / shell / path separators: both check paths below
    // interpret the name as a registry key (Windows) or a filename (macOS)
    // and feed it to `which` (Linux).
    if crate::validate::validate_open_app_name(app_name).is_err() {
        return false;
    }
    #[cfg(target_os = "windows")]
    {
        os::windows::check_windows_app(app_name)
    }

    #[cfg(target_os = "macos")]
    {
        check_macos_app(app_name)
    }

    #[cfg(target_os = "linux")]
    {
        check_linux_app(app_name)
    }
}

#[tauri::command]
#[specta::specta]
fn resolve_app_path(app_name: &str) -> Option<String> {
    // Same guard as `check_app_exists`: refuse anything that isn't a bare
    // app alias before it reaches the Windows registry lookup.
    crate::validate::validate_open_app_name(app_name).ok()?;
    #[cfg(target_os = "windows")]
    {
        os::windows::resolve_windows_app_path(app_name)
    }

    #[cfg(not(target_os = "windows"))]
    {
        // On macOS/Linux, just return the app_name as-is since
        // the opener plugin handles them correctly
        Some(app_name.to_string())
    }
}

#[tauri::command]
#[specta::specta]
fn open_path(_app: AppHandle, path: String, app_name: Option<String>) -> Result<(), String> {
    // Validate target path / URL before it reaches any plugin or OS call.
    let safe_path = crate::validate::validate_open_target(&path)?;
    let safe_app = match app_name.as_deref() {
        Some(name) => Some(crate::validate::validate_open_app_name(name)?.to_string()),
        None => None,
    };

    #[cfg(target_os = "windows")]
    {
        let resolved_app = safe_app
            .as_deref()
            .map(|v| os::windows::resolve_windows_app_path(v).unwrap_or_else(|| v.to_string()));
        let is_powershell = resolved_app.as_ref().is_some_and(|v| {
            std::path::Path::new(v)
                .file_name()
                .and_then(|name| name.to_str())
                .is_some_and(|name| {
                    name.eq_ignore_ascii_case("powershell")
                        || name.eq_ignore_ascii_case("powershell.exe")
                })
        });

        if is_powershell {
            return os::windows::open_in_powershell(safe_path);
        }

        tauri_plugin_opener::open_path(safe_path, resolved_app.as_deref())
            .map_err(|e| format!("Failed to open path: {e}"))
    }

    #[cfg(not(target_os = "windows"))]
    tauri_plugin_opener::open_path(safe_path, safe_app.as_deref())
        .map_err(|e| format!("Failed to open path: {e}"))
}

#[cfg(target_os = "macos")]
fn check_macos_app(app_name: &str) -> bool {
    // Check common installation locations
    let mut app_locations = vec![
        format!("/Applications/{}.app", app_name),
        format!("/System/Applications/{}.app", app_name),
    ];

    if let Ok(home) = std::env::var("HOME") {
        app_locations.push(format!("{}/Applications/{}.app", home, app_name));
    }

    for location in app_locations {
        if std::path::Path::new(&location).exists() {
            return true;
        }
    }

    // Also check if command exists in PATH
    Command::new("which")
        .arg(app_name)
        .output()
        .map(|output| output.status.success())
        .unwrap_or(false)
}

#[derive(serde::Serialize, serde::Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub enum LinuxDisplayBackend {
    Wayland,
    Auto,
}

#[tauri::command]
#[specta::specta]
fn get_display_backend() -> Option<LinuxDisplayBackend> {
    #[cfg(target_os = "linux")]
    {
        let prefer = linux_display::read_wayland().unwrap_or(false);
        return Some(if prefer {
            LinuxDisplayBackend::Wayland
        } else {
            LinuxDisplayBackend::Auto
        });
    }

    #[cfg(not(target_os = "linux"))]
    None
}

#[tauri::command]
#[specta::specta]
fn set_display_backend(_app: AppHandle, _backend: LinuxDisplayBackend) -> Result<(), String> {
    #[cfg(target_os = "linux")]
    {
        let prefer = matches!(_backend, LinuxDisplayBackend::Wayland);
        return linux_display::write_wayland(&_app, prefer);
    }

    #[cfg(not(target_os = "linux"))]
    Ok(())
}

#[cfg(target_os = "linux")]
fn check_linux_app(app_name: &str) -> bool {
    return true;
}

/// Read the current CPU thermal state from the OS.
/// Returns "nominal", "fair", "serious", or "critical".
///
/// Linux: reads /sys/class/thermal/thermal_zone*/temp, averages across zones
///        (°C × 1000). Zones > 100°C are clamped to critical.
/// Windows/macOS: not implemented yet — returns "nominal".
#[tauri::command]
#[specta::specta]
fn get_thermal_state() -> String {
    #[cfg(target_os = "linux")]
    {
        let mut temps: Vec<f32> = Vec::new();
        if let Ok(entries) = std::fs::read_dir("/sys/class/thermal") {
            for entry in entries.flatten() {
                let name = entry.file_name();
                let n = name.to_string_lossy();
                if !n.starts_with("thermal_zone") {
                    continue;
                }
                // Skip cooling devices; only zones have a `temp` file
                let temp_path = entry.path().join("temp");
                if let Ok(raw) = std::fs::read_to_string(&temp_path) {
                    if let Ok(millideg) = raw.trim().parse::<f32>() {
                        temps.push(millideg / 1000.0);
                    }
                }
            }
        }
        if !temps.is_empty() {
            let max_c = temps.iter().cloned().fold(f32::NEG_INFINITY, f32::max);
            let label = if max_c >= 95.0 {
                "critical"
            } else if max_c >= 85.0 {
                "serious"
            } else if max_c >= 70.0 {
                "fair"
            } else {
                "nominal"
            };
            tracing::debug!("[thermal] max={:.1}°C zones={} → {}", max_c, temps.len(), label);
            return label.to_string();
        }
    }
    "nominal".to_string()
}

#[tauri::command]
#[specta::specta]
fn wsl_path(path: String, mode: Option<WslPathMode>) -> Result<String, String> {
    // Defence in depth: bound the input before handing it to an external
    // command. A null byte would confuse both Windows and wsl.exe argument
    // parsing; overly long inputs have no legitimate use (MAX_PATH ≈ 260).
    crate::validate::validate_bounded_text(&path, 4096, "wsl path")?;
    if path.contains('\r') || path.contains('\n') {
        return Err("wsl path contains control characters".into());
    }
    if !cfg!(windows) {
        return Ok(path);
    }

    let flag = match mode.unwrap_or(WslPathMode::Linux) {
        WslPathMode::Windows => "-w",
        WslPathMode::Linux => "-u",
    };

    let output = if path.starts_with('~') {
        let suffix = path.strip_prefix('~').unwrap_or("");
        let escaped = suffix.replace('"', "\\\"");
        let cmd = format!("wslpath {flag} \"$HOME{escaped}\"");
        Command::new("wsl")
            .args(["-e", "sh", "-lc", &cmd])
            .output()
            .map_err(|e| format!("Failed to run wslpath: {e}"))?
    } else {
        Command::new("wsl")
            .args(["-e", "wslpath", flag, &path])
            .output()
            .map_err(|e| format!("Failed to run wslpath: {e}"))?
    };

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        if stderr.is_empty() {
            return Err("wslpath failed".to_string());
        }
        return Err(stderr);
    }

    Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = make_specta_builder();

    #[cfg(debug_assertions)] // <- Only export on non-release builds
    export_types(&builder);

    // Reclaim children left behind by a previous session that did not exit
    // cleanly. Renaming the sidecar was not enough to make killing by image name
    // safe: `llama-server` is llama.cpp's name rather than ours, and even
    // `unifia-cli` is shared by every channel, so `taskkill /F /IM` reached
    // processes belonging to the user or to another Unifia install. Leases make
    // the blast radius exactly the set of processes we can prove we started.
    let child_processes = child_processes::ChildProcesses::default();
    child_processes.recover_orphans();

    let mut builder = tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            // Focus existing window when another instance is launched
            if let Some(window) = app.get_webview_window(MainWindow::LABEL) {
                let _ = window.set_focus();
                let _ = window.unminimize();
            }
        }))
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_os::init())
        .plugin(
            tauri_plugin_window_state::Builder::new()
                .with_state_flags(window_state_flags())
                .with_denylist(&[LoadingWindow::LABEL])
                .build(),
        )
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(crate::window_customizer::PinchZoomDisablePlugin)
        .invoke_handler(builder.invoke_handler())
        .setup(move |app| {
            let handle = app.handle().clone();

            let log_dir = app
                .path()
                .app_log_dir()
                .expect("failed to resolve app log dir");
            // Hold the guard in managed state so it lives for the app's lifetime,
            // ensuring all buffered logs are flushed on shutdown.
            handle.manage(logging::init(&log_dir));
            handle.manage(child_processes);
            handle.manage(llm::LlmServerState::new());
            handle.manage(speech::SpeechState::new());

            builder.mount_events(&handle);
            // Start the localhost keychain endpoint before the sidecar is spawned.
            // Failure is non-fatal — the sidecar will fall back to FileStorage.
            {
                let handle = handle.clone();
                tauri::async_runtime::spawn(async move {
                    match auth_storage::start_keychain_endpoint(handle).await {
                        Ok(e) => tracing::info!(
                            "keychain endpoint listening at {} (token redacted)",
                            e.url
                        ),
                        Err(e) => tracing::warn!("keychain endpoint failed to start: {e}"),
                    }
                });
            }
            tauri::async_runtime::spawn(initialize(handle));

            Ok(())
        });

    if UPDATER_ENABLED {
        builder = builder.plugin(tauri_plugin_updater::Builder::new().build());
    }

    builder
        .build(tauri::generate_context!())
        .expect("error while running tauri application")
        .run(|app, event| {
            if let RunEvent::Exit = event {
                tracing::info!("Received Exit");

                // Kill LLM server if running
                if let Some(state) = app.try_state::<llm::LlmServerState>()
                    && let Ok(mut guard) = state.child.lock()
                        && let Some(ref mut child) = *guard {
                            let _ = child.start_kill();
                        }

                // FIX: kill_sidecar() sends a message to an async channel, but
                // the tokio runtime may shut down before the background task can
                // call start_kill(). Use a synchronous OS-level kill as fallback.
                kill_sidecar(app.clone());

                // Stops the sidecar and llama-server by PID, after checking each
                // one is still the process we spawned. This used to kill by image
                // name, which also ended the llama-server belonging to the user's
                // genuine OpenCode install.
                if let Some(children) = app.try_state::<child_processes::ChildProcesses>() {
                    children.stop_all();
                }
            }
        });
}

fn make_specta_builder() -> tauri_specta::Builder<tauri::Wry> {
    // NOTE: tauri_specta::Builder::commands() REPLACES (does not append).
    // All commands MUST be in a single .commands() call.
    tauri_specta::Builder::<tauri::Wry>::new()
        .commands(tauri_specta::collect_commands![
            kill_sidecar,
            cli::install_cli,
            await_initialization,
            workbench_open_workspace,
            workbench_issue_token,
            workbench_rotate_token,
            workbench_revoke_token,
            server::get_default_server_url,
            server::set_default_server_url,
            server::get_wsl_config,
            server::set_wsl_config,
            server::get_remote_config,
            server::set_remote_enabled,
            server::reset_remote_password,
            server::set_remote_credentials,
            server::set_internet_mode,
            server::export_tls_cert,
            server::rotate_tls_cert,
            get_display_backend,
            set_display_backend,
            get_thermal_state,
            markdown::parse_markdown_command,
            check_app_exists,
            wsl_path,
            resolve_app_path,
            open_path,
            open_design_browser,
            navigate_design_browser,
            close_design_browser,
            llm::list_models,
            llm::download_model,
            llm::delete_model,
            llm::check_llm_health,
            llm::load_llm_model,
            llm::unload_llm_model,
            llm::get_vram_info,
            llm::set_llm_config,
            llm::detect_active_backend,
            llm::run_inference_benchmark,
            speech::tts_start,
            speech::tts_speak,
            speech::tts_stop,
            speech::tts_save_voice_clone,
            speech::tts_list_voice_clones,
            speech::tts_delete_voice_clone,
            speech::tts_available,
            speech::tts_cleanup_chunks,
            speech::stt_download_model,
            speech::stt_load_model,
            speech::stt_transcribe,
            speech::stt_available,
            speech::stt_loaded,
            speech::kokoro_available,
            speech::kokoro_download_model,
            speech::kokoro_load,
            speech::kokoro_loaded,
            speech::kokoro_voices,
            speech::kokoro_synthesize,
            auth_storage::auth_storage_get,
            auth_storage::auth_storage_set,
            auth_storage::auth_storage_delete,
            auth_storage::auth_storage_list,
        ])
        .events(tauri_specta::collect_events![
            LoadingWindowComplete,
            SqliteMigrationProgress
        ])
        .error_handling(tauri_specta::ErrorHandlingMode::Throw)
}

#[cfg(any(debug_assertions, test))]
fn export_types(builder: &tauri_specta::Builder<tauri::Wry>) {
    builder
        .export(
            specta_typescript::Typescript::default(),
            "../src/bindings.ts",
        )
        .expect("Failed to export typescript bindings");
}

#[cfg(test)]
#[test]
fn test_export_types() {
    let builder = make_specta_builder();
    export_types(&builder);
}

#[derive(tauri_specta::Event, serde::Deserialize, specta::Type)]
struct LoadingWindowComplete;

async fn initialize(app: AppHandle) {
    tracing::info!("Initializing app");

    // The sidecar must receive the private IPC token before it is spawned.
    // The setup hook starts the same idempotent endpoint eagerly, but awaiting
    // here closes the startup race that would otherwise disable the Workbench
    // bridge on a fast machine.
    if auth_storage::endpoint().is_none() {
        if let Err(error) = auth_storage::start_keychain_endpoint(app.clone()).await {
            tracing::warn!("keychain endpoint unavailable before sidecar spawn: {error}");
        }
    }

    // Stray children from an instance that didn't exit cleanly (Tauri's
    // `RunEvent::Exit` can skip firing on abrupt close, crash, or close-via-tray
    // with state preserved) are already reclaimed by the lease sweep in `run()`,
    // which happens before this point. Repeating it here would only re-scan the
    // same, now-empty, lease directory.

    let (init_tx, init_rx) = watch::channel(InitStep::ServerWaiting);

    setup_app(&app, init_rx);
    spawn_cli_sync_task(app.clone());

    // Spawn sidecar immediately - credentials are known before health check.
    // The hostname and password come from the persisted remote-access config
    // so a paired client (e.g. a smartphone on the LAN) keeps working across
    // app launches. Toggling remote access requires a relaunch to take
    // effect — we never restart the sidecar at runtime because that would
    // kill every open PTY WebSocket and SSE stream.
    let remote_config = server::load_remote_config(&app);
    let port = get_sidecar_port();
    let _ = SIDECAR_PORT.set(port);
    let hostname = if remote_config.enabled {
        "0.0.0.0"
    } else {
        "127.0.0.1"
    };
    // The self-reported URL always uses loopback so the app's own SDK
    // connects locally regardless of whether the sidecar is bound to
    // 0.0.0.0 for LAN access.
    // In TLS/Internet mode the sidecar serves HTTPS, so we use https:// here.
    let scheme = if remote_config.tls_enabled { "https" } else { "http" };
    let url = format!("{scheme}://127.0.0.1:{port}");
    let username = remote_config.username.clone();
    let password = remote_config.password.clone();
    let tls_enabled = remote_config.tls_enabled;

    tracing::info!("Spawning sidecar on {url}");
    let (child, health_check) = server::spawn_local_server(
        app.clone(),
        hostname.to_string(),
        port,
        username.clone(),
        password.clone(),
        tls_enabled,
    );

    // Make sidecar credentials available immediately (before health check completes)
    let (ready_tx, ready_rx) = oneshot::channel();
    let _ = ready_tx.send(ServerReadyData {
        url: url.clone(),
        username: Some(username),
        password: Some(password),
    });
    app.manage(SidecarReady(ready_rx.shared()));

    // Take the lease now: if the app is killed before this runs, the next start
    // has no record of the sidecar and will leave it alone rather than guess.
    if let Some(children) = app.try_state::<child_processes::ChildProcesses>() {
        match child.pid() {
            Some(pid) => children.adopt(pid),
            None => tracing::warn!("sidecar reported no pid; it will not be reclaimed after a crash"),
        }
    }

    app.manage(ServerState {
        child: Arc::new(Mutex::new(Some(child))),
    });

    let loading_window_complete = event_once_fut::<LoadingWindowComplete>(&app);

    // SQLite migration handling:
    // We only do this if the sqlite db doesn't exist, and we're expecting the sidecar to create it.
    // A separate loading window is shown for long migrations.
    let needs_migration = !sqlite_file_exists();
    let sqlite_done = needs_migration.then(|| {
        tracing::info!(
            path = %sidecar_db_path().expect("failed to get db path").display(),
            "Sqlite file not found, waiting for it to be generated"
        );

        let (done_tx, done_rx) = oneshot::channel::<()>();
        let done_tx = Arc::new(Mutex::new(Some(done_tx)));

        let init_tx = init_tx.clone();
        let id = SqliteMigrationProgress::listen(&app, move |e| {
            let _ = init_tx.send(InitStep::SqliteWaiting);

            if matches!(e.payload, SqliteMigrationProgress::Done)
                && let Some(done_tx) = crate::util::MutexSafe::lock_safe(done_tx.as_ref()).take()
            {
                let _ = done_tx.send(());
            }
        });

        let app = app.clone();
        // Await the oneshot inside the task rather than pairing FutureExt::map
        // with an async closure — the latter yields Future<Future<()>> which
        // tokio::spawn cannot drive, and triggers an internal clippy panic on
        // the current toolchain (clippy 0.1.90 type_op_prove_predicate).
        tokio::spawn(async move {
            let _ = done_rx.await;
            app.unlisten(id);
        })
    });

    // The loading task waits for SQLite migration (if needed) then for the sidecar health check.
    // This is only used to drive the loading window progress - the main window is shown immediately.
    let loading_task = tokio::spawn({
        async move {
            if let Some(sqlite_done_rx) = sqlite_done {
                let _ = sqlite_done_rx.await;
            }

            // Wait for sidecar to become healthy (for loading window progress)
            let res = timeout(Duration::from_secs(30), health_check.0).await;
            match res {
                Ok(Ok(Ok(()))) => tracing::info!("Sidecar health check OK"),
                Ok(Ok(Err(e))) => tracing::error!("Sidecar health check failed: {e}"),
                Ok(Err(e)) => tracing::error!("Sidecar health check task failed: {e}"),
                Err(_) => tracing::error!("Sidecar health check timed out"),
            }

            tracing::info!("Loading task finished");
        }
    })
    .map_err(|_| ())
    .shared();

    // Show loading window for SQLite migrations if they take >1s
    let loading_window = if needs_migration
        && timeout(Duration::from_secs(1), loading_task.clone())
            .await
            .is_err()
    {
        tracing::debug!("Loading task timed out, showing loading window");
        let loading_window = LoadingWindow::create(&app).expect("Failed to create loading window");
        sleep(Duration::from_secs(1)).await;
        Some(loading_window)
    } else {
        None
    };

    // Create main window immediately - the web app handles its own loading/health gate
    MainWindow::create(&app).expect("Failed to create main window");

    let _ = loading_task.await;

    tracing::info!("Loading done, completing initialisation");
    let _ = init_tx.send(InitStep::Done);

    if loading_window.is_some() {
        loading_window_complete.await;
        tracing::info!("Loading window completed");
    }

    if let Some(loading_window) = loading_window {
        let _ = loading_window.close();
    }
}

fn setup_app(app: &tauri::AppHandle, init_rx: watch::Receiver<InitStep>) {
    // Registers the schemes in tauri.conf.json — only `unifia`; `opencode` is
    // parsed by the import flow but never claimed, so signing in from a browser
    // cannot silently take the handler away from an OpenCode install.
    //
    // The failure used to be discarded with `.ok()`. When registration fails the
    // app keeps running but every deep link — OAuth callbacks included — lands
    // nowhere, and nothing anywhere says why.
    #[cfg(any(target_os = "linux", all(debug_assertions, windows)))]
    if let Err(error) = app.deep_link().register_all() {
        tracing::error!(%error, "failed to register the unifia:// scheme — deep links and OAuth callbacks will not arrive");
    }

    app.manage(InitState { current: init_rx });
}

fn spawn_cli_sync_task(app: AppHandle) {
    tokio::spawn(async move {
        if let Err(e) = sync_cli(app) {
            tracing::error!("Failed to sync CLI: {e}");
        }
    });
}


/// Port the sidecar is currently listening on. Populated once during
/// `initialize()` and read by the remote-access commands so they can
/// report the active port to the frontend without an extra round-trip.
static SIDECAR_PORT: OnceLock<u32> = OnceLock::new();

pub fn runtime_sidecar_port() -> u32 {
    SIDECAR_PORT.get().copied().unwrap_or(0)
}

fn get_sidecar_port() -> u32 {
    option_env!("OPENCODE_PORT")
        .map(|s| s.to_string())
        .or_else(|| std::env::var("OPENCODE_PORT").ok())
        .and_then(|port_str| port_str.parse().ok())
        .unwrap_or_else(|| {
            TcpListener::bind("127.0.0.1:0")
                .expect("Failed to bind to find free port")
                .local_addr()
                .expect("Failed to get local address")
                .port()
        }) as u32
}

fn sqlite_file_exists() -> bool {
    let Ok(path) = sidecar_db_path() else {
        return true;
    };

    path.exists()
}

/// Where the sidecar actually creates its database.
///
/// This must mirror `Global.Path.data` in packages/unifia/src/global/index.ts,
/// which joins the XDG data home with the product's data directory name. It
/// previously joined "opencode" — the official install's directory — so the
/// probe read a file this application never writes: with OpenCode installed the
/// migration window was skipped even on a first run, and without it the window
/// appeared on every start even once Unifia's own database existed.
///
/// The file inside is now named `unifia.db` on both sides (TypeScript and
/// Rust). On first access, if a legacy `opencode.db` is present and no
/// `unifia.db` exists yet, the legacy file (and its `-wal` / `-shm` siblings)
/// is copied to the new location. The copy is never a move, so a concurrent
/// upstream install keeps working and the legacy file remains as a backup.
/// See Runbook-Autonome-Independance-Unifia-2026-08-10 §3 (carte C8-A).
fn sidecar_db_path() -> Result<PathBuf, &'static str> {
    let xdg_data_home = env::var_os("XDG_DATA_HOME").filter(|v| !v.is_empty());

    let data_home = match xdg_data_home {
        Some(v) => PathBuf::from(v),
        None => {
            let home = dirs::home_dir().ok_or("cannot determine home directory")?;
            home.join(".local").join("share")
        }
    };

    let data_dir = data_home.join(crate::identity_generated::DATA_DIR_NAME);
    let new_path = data_dir.join("unifia.db");
    let old_path = data_dir.join("opencode.db");

    migrate_legacy_db(&new_path, &old_path)?;

    Ok(new_path)
}

/// Copy a legacy `opencode.db` (and its `-wal` / `-shm` siblings) to the new
/// `unifia.db` path. Idempotent: bails out if the destination already exists
/// (so a second startup is a no-op) or if the source is missing (so a fresh
/// install does not error). Never deletes the source. Returns an error if a
/// copy itself fails, so the caller can refuse to start on a half-migrated
/// database rather than boot on an empty one.
fn migrate_legacy_db(new_path: &Path, old_path: &Path) -> Result<(), &'static str> {
    if new_path.exists() {
        return Ok(());
    }
    if !old_path.exists() {
        return Ok(());
    }
    tracing::info!(
        "migrating legacy database file from {} to {}",
        old_path.display(),
        new_path.display()
    );
    for suffix in ["", "-wal", "-shm"] {
        let src = append_suffix(old_path, suffix);
        let dst = append_suffix(new_path, suffix);
        if !src.exists() {
            continue;
        }
        if let Err(e) = std::fs::copy(&src, &dst) {
            tracing::error!(
                "failed to copy {} to {}: {}",
                src.display(),
                dst.display(),
                e
            );
            return Err("failed to migrate legacy database file");
        }
    }
    Ok(())
}

fn append_suffix(p: &Path, suffix: &str) -> PathBuf {
    let mut s = p.as_os_str().to_owned();
    s.push(suffix);
    PathBuf::from(s)
}

// Creates a `once` listener for the specified event and returns a future that resolves
// when the listener is fired.
// Since the future creation and awaiting can be done separately, it's possible to create the listener
// synchronously before doing something, then awaiting afterwards.
fn event_once_fut<T: tauri_specta::Event + serde::de::DeserializeOwned>(
    app: &AppHandle,
) -> impl Future<Output = ()> {
    let (tx, rx) = oneshot::channel();
    T::once(app, |_| {
        let _ = tx.send(());
    });
    async {
        let _ = rx.await;
    }
}

#[cfg(test)]
mod db_migration_tests {
    use super::{append_suffix, migrate_legacy_db};
    use std::fs;
    use std::path::PathBuf;
    use std::sync::atomic::{AtomicU64, Ordering};
    use std::time::{SystemTime, UNIX_EPOCH};

    static COUNTER: AtomicU64 = AtomicU64::new(0);

    fn unique_tmpdir(label: &str) -> PathBuf {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or(0);
        let seq = COUNTER.fetch_add(1, Ordering::SeqCst);
        let dir = std::env::temp_dir().join(format!(
            "unifia-{label}-{nanos}-{seq}-{}",
            std::process::id()
        ));
        fs::create_dir_all(&dir).expect("create tempdir");
        dir
    }

    #[test]
    fn copies_legacy_db_to_new_path() {
        let dir = unique_tmpdir("db-copy");
        let old = dir.join("opencode.db");
        let new = dir.join("unifia.db");
        fs::write(&old, b"legacy").unwrap();

        migrate_legacy_db(&new, &old).expect("migration ok");

        assert_eq!(fs::read(&new).unwrap(), b"legacy");
        assert!(old.exists(), "legacy file is preserved (copy, not move)");

        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn copies_wal_and_shm_siblings() {
        let dir = unique_tmpdir("db-siblings");
        let old = dir.join("opencode.db");
        let new = dir.join("unifia.db");
        fs::write(&old, b"main").unwrap();
        fs::write(append_suffix(&old, "-wal"), b"wal").unwrap();
        fs::write(append_suffix(&old, "-shm"), b"shm").unwrap();

        migrate_legacy_db(&new, &old).expect("migration ok");

        assert_eq!(fs::read(&new).unwrap(), b"main");
        assert_eq!(fs::read(append_suffix(&new, "-wal")).unwrap(), b"wal");
        assert_eq!(fs::read(append_suffix(&new, "-shm")).unwrap(), b"shm");

        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn idempotent_when_new_already_exists() {
        let dir = unique_tmpdir("db-idempotent");
        let old = dir.join("opencode.db");
        let new = dir.join("unifia.db");
        fs::write(&old, b"legacy").unwrap();
        fs::write(&new, b"current").unwrap();

        migrate_legacy_db(&new, &old).expect("migration ok");

        assert_eq!(fs::read(&new).unwrap(), b"current", "new file is not overwritten");
        assert!(old.exists(), "legacy file is untouched");

        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn noop_when_legacy_is_absent() {
        let dir = unique_tmpdir("db-noop");
        let old = dir.join("opencode.db");
        let new = dir.join("unifia.db");

        migrate_legacy_db(&new, &old).expect("migration ok");

        assert!(!new.exists(), "new file is not created without a source");
        assert!(!old.exists(), "nothing to migrate");

        fs::remove_dir_all(&dir).ok();
    }
}
