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
#[derive(Clone, serde::Serialize, serde::Deserialize, specta::Type, Debug)]
pub struct RemoteConfig {
    /// When true, the sidecar binds to 0.0.0.0 and is reachable on the LAN.
    pub enabled: bool,
    /// Stable UUID used for HTTP basic auth. Reset via `reset_remote_password`.
    pub password: String,
    /// Username for HTTP basic auth. Customisable via `set_remote_credentials`.
    #[serde(default = "default_username")]
    pub username: String,
    /// When true, the sidecar serves HTTPS/WSS (Internet mode). Requires enabled=true.
    #[serde(default)]
    pub tls_enabled: bool,
}

fn default_username() -> String {
    "opencode".to_string()
}

impl Default for RemoteConfig {
    fn default() -> Self {
        Self {
            enabled: false,
            password: uuid::Uuid::new_v4().to_string(),
            username: default_username(),
            tls_enabled: false,
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
    pub username: String,
    pub port: u32,
    /// Best-effort detected LAN address. None if no non-loopback interface is
    /// reachable (offline, all interfaces down, etc.).
    pub lan_ip: Option<String>,
    /// Whether TLS (Internet mode) is active.
    pub tls_enabled: bool,
    /// SHA-256 fingerprint of the self-signed cert (colon-separated hex).
    /// Only present when tls_enabled is true.
    pub tls_fingerprint: Option<String>,
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
/// local address it would use to reach a target — `connect` on a UDP socket
/// just resolves the routing table, no packet is sent, so it works offline
/// on a private LAN as long as there's any matching route.
///
/// We probe multiple targets so a mismatched network environment doesn't
/// silently leave `lan_ip = None`:
///   1. `8.8.8.8`      — default-route probe (works when the host has any
///                       internet gateway, even if offline/unreachable).
///   2. `192.168.1.1`  — typical home/SOHO RFC1918 Class C gateway.
///   3. `10.0.0.1`     — corp/vpn Class A.
///   4. `172.16.0.1`   — Class B.
/// The first probe that yields a non-loopback, non-link-local address wins.
fn detect_lan_ip() -> Option<IpAddr> {
    const PROBES: &[(u8, u8, u8, u8)] = &[
        (8, 8, 8, 8),
        (192, 168, 1, 1),
        (10, 0, 0, 1),
        (172, 16, 0, 1),
    ];
    for (a, b, c, d) in PROBES {
        let Ok(sock) = UdpSocket::bind((Ipv4Addr::UNSPECIFIED, 0)) else {
            continue;
        };
        if sock.connect((Ipv4Addr::new(*a, *b, *c, *d), 80)).is_err() {
            continue;
        }
        let Ok(local) = sock.local_addr() else { continue };
        let addr = local.ip();
        if addr.is_unspecified() || addr.is_loopback() {
            continue;
        }
        // Reject link-local IPv4 (169.254/16) — those are APIPA fallback
        // addresses that no other device on a real network will route to.
        if let IpAddr::V4(v4) = addr
            && v4.is_link_local()
        {
            continue;
        }
        return Some(addr);
    }
    None
}

#[tauri::command]
#[specta::specta]
pub fn get_remote_config(app: AppHandle) -> RemoteConnectionInfo {
    let config = load_remote_config(&app);
    let tls_fingerprint = if config.tls_enabled {
        crate::tls::ensure_cert(&app).ok().map(|c| c.fingerprint)
    } else {
        None
    };
    RemoteConnectionInfo {
        enabled: config.enabled,
        password: config.password,
        username: config.username,
        port: crate::runtime_sidecar_port(),
        lan_ip: detect_lan_ip().map(|ip| ip.to_string()),
        tls_enabled: config.tls_enabled,
        tls_fingerprint,
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
    // Disabling remote access also disables TLS mode.
    if !enabled {
        config.tls_enabled = false;
    }
    save_remote_config(&app, &config)?;
    Ok(RemoteConnectionInfo {
        enabled: config.enabled,
        password: config.password,
        username: config.username,
        port: crate::runtime_sidecar_port(),
        lan_ip: detect_lan_ip().map(|ip| ip.to_string()),
        tls_enabled: config.tls_enabled,
        tls_fingerprint: None,
    })
}

/// Enables or disables Internet (TLS) mode.
/// When enabling, ensures the self-signed certificate exists (generating it if needed).
/// When disabling, falls back to plain LAN mode (remote access stays enabled).
/// Change takes effect on next app launch.
#[tauri::command]
#[specta::specta]
pub fn set_internet_mode(app: AppHandle, enabled: bool) -> Result<RemoteConnectionInfo, String> {
    let mut config = load_remote_config(&app);
    config.tls_enabled = enabled;
    if enabled {
        // Internet mode implies remote access is on.
        config.enabled = true;
    }
    save_remote_config(&app, &config)?;

    let tls_fingerprint = if config.tls_enabled {
        Some(
            crate::tls::ensure_cert(&app)
                .map_err(|e| format!("Failed to generate TLS certificate: {e}"))?
                .fingerprint,
        )
    } else {
        None
    };

    Ok(RemoteConnectionInfo {
        enabled: config.enabled,
        password: config.password,
        username: config.username,
        port: crate::runtime_sidecar_port(),
        lan_ip: detect_lan_ip().map(|ip| ip.to_string()),
        tls_enabled: config.tls_enabled,
        tls_fingerprint,
    })
}

/// Exports the TLS certificate PEM to the user's Downloads folder.
/// Returns the full path to the exported file.
#[tauri::command]
#[specta::specta]
pub fn export_tls_cert(app: AppHandle) -> Result<String, String> {
    let pem = crate::tls::get_cert_pem(&app)?;

    let downloads = dirs::download_dir()
        .ok_or_else(|| "Could not locate Downloads folder".to_string())?;
    let dest = downloads.join("opencode-cert.pem");

    std::fs::write(&dest, pem).map_err(|e| format!("Failed to export certificate: {e}"))?;

    Ok(dest.to_string_lossy().to_string())
}

/// Rotates (regenerates) the TLS certificate.
/// Returns updated connection info with the new fingerprint.
/// Change takes effect on next app launch.
#[tauri::command]
#[specta::specta]
pub fn rotate_tls_cert(app: AppHandle) -> Result<RemoteConnectionInfo, String> {
    let certs = crate::tls::regenerate_cert(&app)
        .map_err(|e| format!("Failed to regenerate TLS certificate: {e}"))?;
    let config = load_remote_config(&app);
    Ok(RemoteConnectionInfo {
        enabled: config.enabled,
        password: config.password,
        username: config.username,
        port: crate::runtime_sidecar_port(),
        lan_ip: detect_lan_ip().map(|ip| ip.to_string()),
        tls_enabled: config.tls_enabled,
        tls_fingerprint: Some(certs.fingerprint),
    })
}

#[tauri::command]
#[specta::specta]
pub fn reset_remote_password(app: AppHandle) -> Result<RemoteConnectionInfo, String> {
    let mut config = load_remote_config(&app);
    config.password = uuid::Uuid::new_v4().to_string();
    save_remote_config(&app, &config)?;
    let tls_fingerprint = if config.tls_enabled {
        crate::tls::ensure_cert(&app).ok().map(|c| c.fingerprint)
    } else {
        None
    };
    Ok(RemoteConnectionInfo {
        enabled: config.enabled,
        password: config.password,
        username: config.username,
        port: crate::runtime_sidecar_port(),
        lan_ip: detect_lan_ip().map(|ip| ip.to_string()),
        tls_enabled: config.tls_enabled,
        tls_fingerprint,
    })
}

/// Updates the username and/or password used for HTTP basic auth.
/// Change takes effect on next app launch.
#[tauri::command]
#[specta::specta]
pub fn set_remote_credentials(
    app: AppHandle,
    username: String,
    password: String,
) -> Result<RemoteConnectionInfo, String> {
    let mut config = load_remote_config(&app);
    if !username.is_empty() {
        config.username = username;
    }
    if !password.is_empty() {
        config.password = password;
    }
    save_remote_config(&app, &config)?;
    let tls_fingerprint = if config.tls_enabled {
        crate::tls::ensure_cert(&app).ok().map(|c| c.fingerprint)
    } else {
        None
    };
    Ok(RemoteConnectionInfo {
        enabled: config.enabled,
        password: config.password,
        username: config.username,
        port: crate::runtime_sidecar_port(),
        lan_ip: detect_lan_ip().map(|ip| ip.to_string()),
        tls_enabled: config.tls_enabled,
        tls_fingerprint,
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
    username: String,
    password: String,
    tls_enabled: bool,
) -> (CommandChild, HealthCheck) {
    let (child, exit) = cli::serve(&app, &hostname, port, &username, &password, tls_enabled);

    let health_check = HealthCheck(tokio::spawn(async move {
        let scheme = if tls_enabled { "https" } else { "http" };
        let url = format!("{scheme}://127.0.0.1:{port}");
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

    let is_loopback = url.host_str().is_some_and(|host| {
        host.eq_ignore_ascii_case("localhost")
            || host
                .parse::<std::net::IpAddr>()
                .is_ok_and(|ip| ip.is_loopback())
    });

    let mut builder = reqwest::Client::builder().timeout(Duration::from_secs(7));

    if is_loopback {
        // Some environments set proxy variables (HTTP_PROXY/HTTPS_PROXY/ALL_PROXY) without
        // excluding loopback. reqwest respects these by default, which can prevent the desktop
        // app from reaching its own local sidecar server.
        builder = builder.no_proxy();
    }

    if url.scheme() == "https" && is_loopback {
        // SAFE: this is always loopback (127.0.0.1). The self-signed cert is generated
        // locally; no interception is possible on the loopback interface.
        builder = builder.danger_accept_invalid_certs(true);
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
