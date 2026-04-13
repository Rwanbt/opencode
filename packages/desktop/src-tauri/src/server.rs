use std::net::{IpAddr, Ipv4Addr, UdpSocket};
use std::time::{Duration, Instant};

use tauri::AppHandle;
use tauri_plugin_store::StoreExt;
use tokio::task::JoinHandle;

use crate::{
    cli,
    cli::CommandChild,
    constants::{DEFAULT_SERVER_URL_KEY, REMOTE_CONFIG_KEY, SETTINGS_STORE, WSL_ENABLED_KEY},
};

#[derive(Clone, serde::Serialize, serde::Deserialize, specta::Type, Debug, Default)]
pub struct WslConfig {
    pub enabled: bool,
}

/// Persisted configuration for exposing the local sidecar server outside
/// of loopback. The password is generated once and kept stable across app
/// launches so a paired client (e.g. a smartphone browser) keeps working.
///
/// TLS fields are intentionally commented out: they're part of the planned
/// Internet-mode upgrade and can be enabled without a struct refactor.
#[derive(Clone, serde::Serialize, serde::Deserialize, specta::Type, Debug)]
pub struct RemoteConfig {
    /// When true, the sidecar binds to 0.0.0.0 and is reachable on the LAN.
    pub enabled: bool,
    /// Stable UUID used for HTTP basic auth. Reset via `reset_remote_password`.
    pub password: String,
    // --- Reserved for the Internet/TLS upgrade ---
    // pub tls_enabled: bool,
    // pub tls_cert_path: Option<String>,
    // pub tls_key_path: Option<String>,
}

impl Default for RemoteConfig {
    fn default() -> Self {
        Self {
            enabled: false,
            password: uuid::Uuid::new_v4().to_string(),
        }
    }
}

/// Information the frontend needs to display connection instructions for
/// a paired client (QR code, banner, etc.).
#[derive(Clone, serde::Serialize, serde::Deserialize, specta::Type, Debug)]
#[serde(rename_all = "camelCase")]
pub struct RemoteConnectionInfo {
    pub enabled: bool,
    pub password: String,
    pub port: u32,
    /// Best-effort detected LAN address. None if no non-loopback interface is
    /// reachable (offline, all interfaces down, etc.).
    pub lan_ip: Option<String>,
}

pub fn load_remote_config(app: &AppHandle) -> RemoteConfig {
    let Ok(store) = app.store(SETTINGS_STORE) else {
        return RemoteConfig::default();
    };

    let existing = store
        .get(REMOTE_CONFIG_KEY)
        .and_then(|v| serde_json::from_value::<RemoteConfig>(v).ok());

    if let Some(config) = existing {
        return config;
    }

    // First launch — generate and persist a fresh default so the password
    // stays stable on subsequent runs.
    let config = RemoteConfig::default();
    if let Ok(value) = serde_json::to_value(&config) {
        store.set(REMOTE_CONFIG_KEY, value);
        let _ = store.save();
    }
    config
}

fn save_remote_config(app: &AppHandle, config: &RemoteConfig) -> Result<(), String> {
    let store = app
        .store(SETTINGS_STORE)
        .map_err(|e| format!("Failed to open settings store: {e}"))?;
    let value = serde_json::to_value(config)
        .map_err(|e| format!("Failed to serialize remote config: {e}"))?;
    store.set(REMOTE_CONFIG_KEY, value);
    store
        .save()
        .map_err(|e| format!("Failed to save settings: {e}"))?;
    Ok(())
}

/// Best-effort LAN IP discovery. We open a UDP socket and ask the OS which
/// local address it would use to reach a public IP — this resolves the
/// routing table without actually sending any packet, so it works offline
/// on a private LAN as long as there's a default route.
fn detect_lan_ip() -> Option<IpAddr> {
    let sock = UdpSocket::bind((Ipv4Addr::UNSPECIFIED, 0)).ok()?;
    sock.connect(("8.8.8.8", 80)).ok()?;
    let addr = sock.local_addr().ok()?.ip();
    if addr.is_unspecified() || addr.is_loopback() {
        return None;
    }
    Some(addr)
}

#[tauri::command]
#[specta::specta]
pub fn get_remote_config(app: AppHandle) -> RemoteConnectionInfo {
    let config = load_remote_config(&app);
    RemoteConnectionInfo {
        enabled: config.enabled,
        password: config.password,
        port: crate::runtime_sidecar_port(),
        lan_ip: detect_lan_ip().map(|ip| ip.to_string()),
    }
}

/// Toggles remote access. The change is persisted immediately but only
/// takes effect on the next app launch — restarting the sidecar at runtime
/// would invalidate every open PTY WebSocket and SSE stream, which is a
/// worse UX than asking the user to relaunch once.
#[tauri::command]
#[specta::specta]
pub fn set_remote_enabled(app: AppHandle, enabled: bool) -> Result<RemoteConnectionInfo, String> {
    let mut config = load_remote_config(&app);
    config.enabled = enabled;
    save_remote_config(&app, &config)?;
    Ok(RemoteConnectionInfo {
        enabled: config.enabled,
        password: config.password,
        port: crate::runtime_sidecar_port(),
        lan_ip: detect_lan_ip().map(|ip| ip.to_string()),
    })
}

#[tauri::command]
#[specta::specta]
pub fn reset_remote_password(app: AppHandle) -> Result<RemoteConnectionInfo, String> {
    let mut config = load_remote_config(&app);
    config.password = uuid::Uuid::new_v4().to_string();
    save_remote_config(&app, &config)?;
    Ok(RemoteConnectionInfo {
        enabled: config.enabled,
        password: config.password,
        port: crate::runtime_sidecar_port(),
        lan_ip: detect_lan_ip().map(|ip| ip.to_string()),
    })
}

#[tauri::command]
#[specta::specta]
pub fn get_default_server_url(app: AppHandle) -> Result<Option<String>, String> {
    let store = app
        .store(SETTINGS_STORE)
        .map_err(|e| format!("Failed to open settings store: {}", e))?;

    let value = store.get(DEFAULT_SERVER_URL_KEY);
    match value {
        Some(v) => Ok(v.as_str().map(String::from)),
        None => Ok(None),
    }
}

#[tauri::command]
#[specta::specta]
pub async fn set_default_server_url(app: AppHandle, url: Option<String>) -> Result<(), String> {
    let store = app
        .store(SETTINGS_STORE)
        .map_err(|e| format!("Failed to open settings store: {}", e))?;

    match url {
        Some(u) => {
            store.set(DEFAULT_SERVER_URL_KEY, serde_json::Value::String(u));
        }
        None => {
            store.delete(DEFAULT_SERVER_URL_KEY);
        }
    }

    store
        .save()
        .map_err(|e| format!("Failed to save settings: {}", e))?;

    Ok(())
}

#[tauri::command]
#[specta::specta]
pub fn get_wsl_config(_app: AppHandle) -> Result<WslConfig, String> {
    // let store = app
    //     .store(SETTINGS_STORE)
    //     .map_err(|e| format!("Failed to open settings store: {}", e))?;

    // let enabled = store
    //     .get(WSL_ENABLED_KEY)
    //     .as_ref()
    //     .and_then(|v| v.as_bool())
    //     .unwrap_or(false);

    Ok(WslConfig { enabled: false })
}

#[tauri::command]
#[specta::specta]
pub fn set_wsl_config(app: AppHandle, config: WslConfig) -> Result<(), String> {
    let store = app
        .store(SETTINGS_STORE)
        .map_err(|e| format!("Failed to open settings store: {}", e))?;

    store.set(WSL_ENABLED_KEY, serde_json::Value::Bool(config.enabled));

    store
        .save()
        .map_err(|e| format!("Failed to save settings: {}", e))?;

    Ok(())
}

pub fn spawn_local_server(
    app: AppHandle,
    hostname: String,
    port: u32,
    password: String,
) -> (CommandChild, HealthCheck) {
    let (child, exit) = cli::serve(&app, &hostname, port, &password);

    let health_check = HealthCheck(tokio::spawn(async move {
        let url = format!("http://127.0.0.1:{port}");
        let timestamp = Instant::now();

        let ready = async {
            loop {
                tokio::time::sleep(Duration::from_millis(100)).await;

                if check_health(&url, Some(&password)).await {
                    tracing::info!(elapsed = ?timestamp.elapsed(), "Server ready");
                    return Ok(());
                }
            }
        };

        let terminated = async {
            match exit.await {
                Ok(payload) => Err(format!(
                    "Sidecar terminated before becoming healthy (code={:?} signal={:?})",
                    payload.code, payload.signal
                )),
                Err(_) => Err("Sidecar terminated before becoming healthy".to_string()),
            }
        };

        tokio::select! {
            res = ready => res,
            res = terminated => res,
        }
    }));

    (child, health_check)
}

pub struct HealthCheck(pub JoinHandle<Result<(), String>>);

async fn check_health(url: &str, password: Option<&str>) -> bool {
    let Ok(url) = reqwest::Url::parse(url) else {
        return false;
    };

    let mut builder = reqwest::Client::builder().timeout(Duration::from_secs(7));

    if url
        .host_str()
        .is_some_and(|host| {
            host.eq_ignore_ascii_case("localhost")
                || host
                    .parse::<std::net::IpAddr>()
                    .is_ok_and(|ip| ip.is_loopback())
        })
    {
        // Some environments set proxy variables (HTTP_PROXY/HTTPS_PROXY/ALL_PROXY) without
        // excluding loopback. reqwest respects these by default, which can prevent the desktop
        // app from reaching its own local sidecar server.
        builder = builder.no_proxy();
    }

    let Ok(client) = builder.build() else {
        return false;
    };
    let Ok(health_url) = url.join("/global/health") else {
        return false;
    };

    let mut req = client.get(health_url);

    if let Some(password) = password {
        req = req.basic_auth("opencode", Some(password));
    }

    req.send()
        .await
        .map(|r| r.status().is_success())
        .unwrap_or(false)
}
