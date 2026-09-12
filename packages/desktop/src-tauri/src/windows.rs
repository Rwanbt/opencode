use crate::{
    constants::{UPDATER_ENABLED, window_state_flags},
    server::get_wsl_config,
};
use std::sync::Mutex;
use std::{ops::Deref, time::Duration};
use std::collections::hash_map::DefaultHasher;
use std::hash::{Hash, Hasher};
use tauri::{AppHandle, Manager, Runtime, WebviewUrl, WebviewWindow, WebviewWindowBuilder};
use tauri_plugin_window_state::AppHandleExt;
use tokio::sync::mpsc;

#[cfg(target_os = "linux")]
use std::sync::OnceLock;

#[cfg(target_os = "linux")]
fn use_decorations() -> bool {
    static DECORATIONS: OnceLock<bool> = OnceLock::new();
    *DECORATIONS.get_or_init(|| {
        crate::linux_windowing::use_decorations(&crate::linux_windowing::SessionEnv::capture())
    })
}

#[cfg(not(target_os = "linux"))]
fn use_decorations() -> bool {
    true
}

pub struct MainWindow(WebviewWindow);

impl Deref for MainWindow {
    type Target = WebviewWindow;

    fn deref(&self) -> &Self::Target {
        &self.0
    }
}

impl MainWindow {
    pub const LABEL: &str = "main";

    pub fn create(app: &AppHandle) -> Result<Self, tauri::Error> {
        if let Some(window) = app.get_webview_window(Self::LABEL) {
            let _ = window.set_focus();
            let _ = window.unminimize();
            return Ok(Self(window));
        }

        let wsl_enabled = get_wsl_config(app.clone())
            .ok()
            .map(|v| v.enabled)
            .unwrap_or(false);
        let decorations = use_decorations();
        let window_builder = base_window_config(
            WebviewWindowBuilder::new(app, Self::LABEL, WebviewUrl::App("/".into())),
            app,
            decorations,
        )
        // Read from the bundle's productName rather than written out: the
        // literal here still said "OpenCode" after the rebrand, so the running
        // window announced the upstream product in its title bar, its taskbar
        // entry and its Alt-Tab card. Deriving it also keeps the per-channel
        // names ("Unifia Dev" / "Unifia Beta" / "Unifia") correct for free.
        .title(&app.package_info().name)
        .disable_drag_drop_handler()
        .zoom_hotkeys_enabled(false)
        .visible(true)
        .maximized(true)
        .initialization_script(format!(
            r#"
            window.__OPENCODE__ ??= {{}};
            window.__OPENCODE__.updaterEnabled = {UPDATER_ENABLED};
            window.__OPENCODE__.wsl = {wsl_enabled};
          "#
        ));

        let window = window_builder.build()?;

        // Ensure window is focused after creation (e.g., after update/relaunch)
        let _ = window.set_focus();

        setup_window_state_listener(app, &window);

        Ok(Self(window))
    }
}

/// How many Design browser WebViews stay alive at once. Each one is a full
/// WebView2/WKWebView process; without a cap, memory grows linearly with the
/// number of URLs the user ever visited in the workshop.
const DESIGN_BROWSER_CAP: usize = 3;

/// Labels of the live Design browser WebViews, oldest first.
static DESIGN_BROWSER_LRU: Mutex<Vec<String>> = Mutex::new(Vec::new());

fn touch_design_browser(label: &str) -> Vec<String> {
    let mut lru = match DESIGN_BROWSER_LRU.lock() {
        Ok(guard) => guard,
        // A panic in another thread poisoned the list. The labels themselves are
        // still valid, so recover them rather than leaking every open WebView.
        Err(poisoned) => poisoned.into_inner(),
    };
    lru.retain(|item| item != label);
    lru.push(label.to_string());
    if lru.len() <= DESIGN_BROWSER_CAP {
        return Vec::new();
    }
    let overflow = lru.len() - DESIGN_BROWSER_CAP;
    lru.drain(..overflow).collect()
}

fn forget_design_browser(label: &str) {
    let mut lru = match DESIGN_BROWSER_LRU.lock() {
        Ok(guard) => guard,
        Err(poisoned) => poisoned.into_inner(),
    };
    lru.retain(|item| item != label);
}

fn design_browser_label(address: &str) -> String {
    let mut hasher = DefaultHasher::new();
    address.hash(&mut hasher);
    format!("design-browser-{:x}", hasher.finish())
}

/// Opens a browser tab as a real Tauri WebView window.
/// WHY: the Design surface is a SolidJS WebView; embedding a second browser
/// with an iframe would not exercise the native WebView2/WKWebView path and
/// would inherit the host document's security boundary.
///
/// Returns the window label so the caller can drive and later close this exact
/// WebView — the Design tab owns its window's lifetime.
pub fn open_design_browser<R: Runtime>(app: &AppHandle<R>, address: &str) -> Result<String, String> {
    let parsed = url::Url::parse(address).map_err(|error| format!("invalid browser URL: {error}"))?;
    if parsed.scheme() != "http" && parsed.scheme() != "https" {
        return Err("browser tabs only accept http(s) URLs".into());
    }
    let label = design_browser_label(address);
    if let Some(window) = app.get_webview_window(&label) {
        let _ = window.set_focus();
        evict_design_browsers(app, touch_design_browser(&label));
        return Ok(label);
    }
    WebviewWindowBuilder::new(app, &label, WebviewUrl::External(parsed))
        .title("Unifia Browser")
        .inner_size(1200.0, 800.0)
        .resizable(true)
        .build()
        .map_err(|error| format!("failed to open browser WebView: {error}"))?;
    evict_design_browsers(app, touch_design_browser(&label));
    Ok(label)
}

fn evict_design_browsers<R: Runtime>(app: &AppHandle<R>, labels: Vec<String>) {
    for label in labels {
        if let Some(window) = app.get_webview_window(&label) {
            let _ = window.close();
        }
    }
}

/// Drives history on an open Design browser WebView.
///
/// WHY `eval` rather than a Tauri navigation API: `WebviewWindow::navigate`
/// replaces the URL outright, which loses the entry the user wants to go back
/// to. Back/forward only exist inside the page's own history object.
pub fn navigate_design_browser<R: Runtime>(app: &AppHandle<R>, label: &str, action: &str) -> Result<(), String> {
    let script = match action {
        "back" => "history.back()",
        "forward" => "history.forward()",
        "reload" => "location.reload()",
        other => return Err(format!("unsupported browser action: {other}")),
    };
    let window = app
        .get_webview_window(label)
        .ok_or_else(|| format!("no open browser WebView for {label}"))?;
    window.eval(script).map_err(|error| format!("browser navigation failed: {error}"))
}

/// Closes a Design browser WebView and drops it from the keep-alive list.
/// Idempotent: closing a window that is already gone is not an error, because
/// the user can close it from its own title bar before the tab does.
pub fn close_design_browser<R: Runtime>(app: &AppHandle<R>, label: &str) -> Result<(), String> {
    forget_design_browser(label);
    if let Some(window) = app.get_webview_window(label) {
        window.close().map_err(|error| format!("failed to close browser WebView: {error}"))?;
    }
    Ok(())
}

fn setup_window_state_listener(app: &AppHandle, window: &WebviewWindow) {
    let (tx, mut rx) = mpsc::channel::<()>(1);

    window.on_window_event(move |event| {
        use tauri::WindowEvent;
        if !matches!(event, WindowEvent::Moved(_) | WindowEvent::Resized(_)) {
            return;
        }
        let _ = tx.try_send(());
    });

    tokio::spawn({
        let app = app.clone();

        async move {
            let save = || {
                let handle = app.clone();
                let app = app.clone();
                let _ = handle.run_on_main_thread(move || {
                    let _ = app.save_window_state(window_state_flags());
                });
            };

            while rx.recv().await.is_some() {
                tokio::time::sleep(Duration::from_millis(200)).await;

                save();
            }
        }
    });
}

pub struct LoadingWindow(WebviewWindow);

impl Deref for LoadingWindow {
    type Target = WebviewWindow;

    fn deref(&self) -> &Self::Target {
        &self.0
    }
}

impl LoadingWindow {
    pub const LABEL: &str = "loading";

    pub fn create(app: &AppHandle) -> Result<Self, tauri::Error> {
        let decorations = use_decorations();

        let window_builder = base_window_config(
            WebviewWindowBuilder::new(app, Self::LABEL, tauri::WebviewUrl::App("/loading".into())),
            app,
            decorations,
        )
        .center()
        .resizable(false)
        .inner_size(640.0, 480.0)
        .visible(true);

        Ok(Self(window_builder.build()?))
    }
}

fn base_window_config<'a, R: Runtime, M: Manager<R>>(
    window_builder: WebviewWindowBuilder<'a, R, M>,
    _app: &AppHandle,
    decorations: bool,
) -> WebviewWindowBuilder<'a, R, M> {
    let window_builder = window_builder.decorations(decorations);

    #[cfg(windows)]
    let window_builder = {
        // Pin the self-signed loopback cert for WebView2 via SPKI list, ONLY
        // when the sidecar is configured to serve TLS (Internet mode). Without
        // this, `wss://127.0.0.1:PORT` upgrades for the terminal + WS clients
        // fail with ERR_CERT_AUTHORITY_INVALID — Chromium has no equivalent
        // of reqwest's `danger_accept_invalid_certs`. SPKI pinning is
        // narrower than `--ignore-certificate-errors`: only this exact public
        // key is trusted, other cert errors still bubble up. Rotate the cert
        // → the hash changes automatically via ensure_cert.
        let remote = crate::server::load_remote_config(_app);
        let spki_arg = if remote.tls_enabled {
            match crate::tls::ensure_cert(_app) {
                Ok(certs) => format!(" --ignore-certificate-errors-spki-list={}", certs.spki_hash_b64),
                Err(err) => {
                    tracing::warn!(%err, "Failed to load TLS cert for WebView2 SPKI pinning; WS upgrades to wss://127.0.0.1 will fail");
                    String::new()
                }
            }
        } else {
            String::new()
        };

        // Some VPNs set a global/system proxy that WebView2 applies even for loopback
        // connections, which breaks the app's localhost sidecar server.
        // Note: when setting additional args, we must re-apply wry's default
        // `--disable-features=...` flags.
        window_builder
            .additional_browser_args(&format!(
                "--proxy-bypass-list=<-loopback> --disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection{}",
                spki_arg
            ))
            .data_directory(_app.path().config_dir().expect("Failed to get config dir").join(_app.config().product_name.clone().unwrap()))
            .decorations(false)
    };

    #[cfg(target_os = "macos")]
    let window_builder = window_builder
        .title_bar_style(tauri::TitleBarStyle::Overlay)
        .hidden_title(true)
        .traffic_light_position(tauri::LogicalPosition::new(12.0, 18.0));

    window_builder
}
