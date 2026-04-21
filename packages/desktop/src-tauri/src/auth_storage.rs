//! OS keychain-backed credential storage for OpenCode (B1 — Sprint 4).
//!
//! Exposes four Tauri commands consumed by the TypeScript sidecar's
//! `KeychainStorage` adapter (see `packages/opencode/src/auth/index.ts`).
//!
//! Backends (via the `keyring` crate v3):
//!   - Windows : Credential Manager (wincred)
//!   - macOS   : Keychain
//!   - Linux   : Secret Service (libsecret — falls back to kwallet)
//!
//! The `service` argument is namespaced to `opencode.<service>` so that test
//! runs and local dev do not collide with a production install on the same
//! user profile. The `key` argument is typically the provider ID
//! (e.g. "anthropic", "openai", "copilot").
//!
//! Error handling:
//!   - `NoEntry` (key missing) is NOT an error for `get` — returns None so
//!     the TS layer can fall through to legacy auth.json and trigger the
//!     migration path.
//!   - All other errors return a `String` (Tauri serialises as `Err`).
//!
//! `list` enumerates the *logical* keys that have been written via this
//! module. The underlying `keyring` crate does not expose a cross-platform
//! enumeration API — Windows wincred has prefix search, macOS keychain
//! supports `SecItemCopyMatching`, libsecret has `secret_service_search`,
//! but the semantics differ. We sidestep that by maintaining a JSON
//! registry file at `<data_dir>/auth.keychain-index.json` that records the
//! set of (service, key) tuples owned by OpenCode. Listing reads the
//! registry and verifies each entry is still readable (drops stale ones).

use keyring::Entry;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::io;
use std::path::PathBuf;
use std::sync::OnceLock;
use tauri::{AppHandle, Manager};
use tokio::io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, BufReader};
use tokio::net::TcpListener;

#[derive(Default, Serialize, Deserialize)]
struct KeychainIndex {
    /// service -> ordered list of keys known to OpenCode.
    entries: HashMap<String, Vec<String>>,
}

fn index_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("app_data_dir: {e}"))?;
    fs::create_dir_all(&dir).map_err(|e| format!("mkdir {dir:?}: {e}"))?;
    Ok(dir.join("auth.keychain-index.json"))
}

fn load_index(app: &AppHandle) -> KeychainIndex {
    let Ok(p) = index_path(app) else {
        return KeychainIndex::default();
    };
    match fs::read(&p) {
        Ok(bytes) => serde_json::from_slice(&bytes).unwrap_or_default(),
        Err(e) if e.kind() == io::ErrorKind::NotFound => KeychainIndex::default(),
        Err(_) => KeychainIndex::default(),
    }
}

fn save_index(app: &AppHandle, index: &KeychainIndex) -> Result<(), String> {
    let p = index_path(app)?;
    let bytes = serde_json::to_vec_pretty(index).map_err(|e| format!("serialise: {e}"))?;
    fs::write(&p, bytes).map_err(|e| format!("write {p:?}: {e}"))
}

fn namespaced(service: &str) -> String {
    format!("opencode.{service}")
}

/// Fetch a credential. Returns `Ok(None)` when the entry does not exist.
#[tauri::command]
#[specta::specta]
pub fn auth_storage_get(service: String, key: String) -> Result<Option<String>, String> {
    let ns = namespaced(&service);
    let entry = Entry::new(&ns, &key).map_err(|e| format!("entry: {e}"))?;
    match entry.get_password() {
        Ok(v) => Ok(Some(v)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(format!("keyring get: {e}")),
    }
}

#[tauri::command]
#[specta::specta]
pub fn auth_storage_set(
    app: AppHandle,
    service: String,
    key: String,
    value: String,
) -> Result<(), String> {
    let ns = namespaced(&service);
    let entry = Entry::new(&ns, &key).map_err(|e| format!("entry: {e}"))?;
    entry
        .set_password(&value)
        .map_err(|e| format!("keyring set: {e}"))?;

    // Update the logical-keys index so `auth_storage_list` can enumerate.
    let mut index = load_index(&app);
    let keys = index.entries.entry(service).or_default();
    if !keys.contains(&key) {
        keys.push(key);
    }
    save_index(&app, &index)
}

#[tauri::command]
#[specta::specta]
pub fn auth_storage_delete(app: AppHandle, service: String, key: String) -> Result<(), String> {
    let ns = namespaced(&service);
    let entry = Entry::new(&ns, &key).map_err(|e| format!("entry: {e}"))?;
    match entry.delete_credential() {
        Ok(()) => {}
        Err(keyring::Error::NoEntry) => {}
        Err(e) => return Err(format!("keyring delete: {e}")),
    }
    let mut index = load_index(&app);
    if let Some(keys) = index.entries.get_mut(&service) {
        keys.retain(|k| k != &key);
        if keys.is_empty() {
            index.entries.remove(&service);
        }
    }
    save_index(&app, &index)
}

#[tauri::command]
#[specta::specta]
pub fn auth_storage_list(app: AppHandle, service: String) -> Result<Vec<String>, String> {
    let mut index = load_index(&app);
    let Some(keys) = index.entries.get(&service).cloned() else {
        return Ok(Vec::new());
    };
    // Filter stale entries: verify the credential is still readable.
    let ns = namespaced(&service);
    let mut alive: Vec<String> = Vec::new();
    let mut changed = false;
    for k in keys {
        let entry = match Entry::new(&ns, &k) {
            Ok(e) => e,
            Err(_) => {
                changed = true;
                continue;
            }
        };
        match entry.get_password() {
            Ok(_) => alive.push(k),
            Err(keyring::Error::NoEntry) => {
                changed = true;
            }
            Err(_) => {
                // Transient error — keep the key in the index, user can retry.
                alive.push(k);
            }
        }
    }
    if changed {
        if alive.is_empty() {
            index.entries.remove(&service);
        } else {
            index.entries.insert(service, alive.clone());
        }
        let _ = save_index(&app, &index);
    }
    Ok(alive)
}

// ─── Sidecar-facing localhost endpoint (Sprint 5 — item 4) ───────────────────
//
// The sidecar (Bun process) does not have a Tauri `invoke` channel. To let it
// reach the four `auth_storage_*` commands above, we expose a small HTTP/1.1
// server bound to 127.0.0.1 on a random port. At boot we:
//
//   1. Generate a 128-bit token (UUID v4, hex).
//   2. Bind a TcpListener on 127.0.0.1:0 and stash (url, token) in statics.
//   3. Export them to the sidecar via `OPENCODE_KEYCHAIN_URL` and
//      `OPENCODE_KEYCHAIN_TOKEN` env vars at spawn time (see cli.rs).
//
// Security:
//   - Bound to 127.0.0.1 only — not reachable off-box.
//   - Every request must carry `X-Keychain-Token: <token>`; body length is
//     bounded to 32 KiB to avoid OOMs.
//   - Rate limit: a naive global token bucket (60 req / 60 s). Rejected
//     requests return 429 with no body. This protects against a local process
//     running under the same UID from brute-forcing the token (1/s is already
//     astronomically larger than the token's 128 bits of entropy, so 60/min is
//     plenty of safety margin).
//   - Lifetime: tied to the Tauri app process; the OS reaps the socket on
//     exit. No persistence.
//
// Routes (all require header auth):
//   GET    /kc/:service/:key   -> 200 {"value": "..."}  or 404
//   PUT    /kc/:service/:key   -> body = raw value;     204
//   DELETE /kc/:service/:key   -> 204
//   GET    /kc/:service        -> 200 ["key1", "key2"]
//
// Status: this module starts the listener and exports the url/token statics.
// Wiring into cli.rs (env injection) is done separately so that a compile
// failure in one does not break the other.

pub struct KeychainEndpoint {
    pub url: String,
    pub token: String,
}

static KEYCHAIN_ENDPOINT: OnceLock<KeychainEndpoint> = OnceLock::new();

pub fn endpoint() -> Option<&'static KeychainEndpoint> {
    KEYCHAIN_ENDPOINT.get()
}

const MAX_BODY_BYTES: usize = 32 * 1024;

/// Naive fixed-window rate limiter: 60 requests per 60 s, global.
/// Good enough because the endpoint is localhost-only and single-client.
struct RateLimiter {
    window_start: std::sync::Mutex<std::time::Instant>,
    count: std::sync::atomic::AtomicU32,
}

impl RateLimiter {
    fn new() -> Self {
        Self {
            window_start: std::sync::Mutex::new(std::time::Instant::now()),
            count: std::sync::atomic::AtomicU32::new(0),
        }
    }

    fn check(&self) -> bool {
        let mut start = self.window_start.lock().unwrap();
        if start.elapsed().as_secs() >= 60 {
            *start = std::time::Instant::now();
            self.count
                .store(0, std::sync::atomic::Ordering::Relaxed);
        }
        let c = self
            .count
            .fetch_add(1, std::sync::atomic::Ordering::Relaxed);
        c < 60
    }
}

/// Boot the keychain endpoint. Must be called from a Tokio runtime context.
/// Idempotent — subsequent calls return the existing endpoint.
pub async fn start_keychain_endpoint(app: AppHandle) -> Result<&'static KeychainEndpoint, String> {
    if let Some(e) = KEYCHAIN_ENDPOINT.get() {
        return Ok(e);
    }
    let listener = TcpListener::bind("127.0.0.1:0")
        .await
        .map_err(|e| format!("bind: {e}"))?;
    let local = listener
        .local_addr()
        .map_err(|e| format!("local_addr: {e}"))?;
    let token = uuid::Uuid::new_v4().simple().to_string()
        + &uuid::Uuid::new_v4().simple().to_string(); // 256 bits total
    let url = format!("http://127.0.0.1:{}", local.port());
    let endpoint = KeychainEndpoint {
        url: url.clone(),
        token: token.clone(),
    };
    let _ = KEYCHAIN_ENDPOINT.set(endpoint);

    let limiter = std::sync::Arc::new(RateLimiter::new());
    let token_owned = token.clone();
    tokio::spawn(async move {
        loop {
            let (socket, _) = match listener.accept().await {
                Ok(v) => v,
                Err(_) => continue,
            };
            let app = app.clone();
            let token = token_owned.clone();
            let limiter = limiter.clone();
            tokio::spawn(async move {
                let _ = serve_connection(socket, app, token, limiter).await;
            });
        }
    });
    Ok(KEYCHAIN_ENDPOINT.get().unwrap())
}

async fn serve_connection(
    socket: tokio::net::TcpStream,
    app: AppHandle,
    token: String,
    limiter: std::sync::Arc<RateLimiter>,
) -> std::io::Result<()> {
    let (read_half, mut write_half) = socket.into_split();
    let mut reader = BufReader::new(read_half);
    let mut request_line = String::new();
    if reader.read_line(&mut request_line).await? == 0 {
        return Ok(());
    }
    let parts: Vec<&str> = request_line.trim().split(' ').collect();
    if parts.len() < 2 {
        return write_simple(&mut write_half, 400, "bad request").await;
    }
    let method = parts[0].to_string();
    let path = parts[1].to_string();

    let mut content_length: usize = 0;
    let mut supplied_token: Option<String> = None;
    loop {
        let mut header = String::new();
        if reader.read_line(&mut header).await? == 0 {
            break;
        }
        let trimmed = header.trim();
        if trimmed.is_empty() {
            break;
        }
        if let Some((k, v)) = trimmed.split_once(':') {
            let k = k.trim().to_ascii_lowercase();
            let v = v.trim();
            if k == "content-length" {
                content_length = v.parse::<usize>().unwrap_or(0);
                if content_length > MAX_BODY_BYTES {
                    return write_simple(&mut write_half, 413, "payload too large").await;
                }
            } else if k == "x-keychain-token" {
                supplied_token = Some(v.to_string());
            }
        }
    }

    if !limiter.check() {
        return write_simple(&mut write_half, 429, "rate limited").await;
    }
    if supplied_token.as_deref() != Some(token.as_str()) {
        return write_simple(&mut write_half, 401, "unauthorized").await;
    }

    let mut body = vec![0u8; content_length];
    if content_length > 0 {
        reader.read_exact(&mut body).await?;
    }

    // Path: /kc/:service or /kc/:service/:key
    let trimmed = path.trim_start_matches('/');
    let mut segments = trimmed.splitn(3, '/');
    let scope = segments.next().unwrap_or("");
    let service_enc = segments.next().unwrap_or("");
    let key_enc = segments.next().unwrap_or("");
    if scope != "kc" {
        return write_simple(&mut write_half, 404, "not found").await;
    }
    let service = urldecode(service_enc);
    let key = urldecode(key_enc);

    let result: Result<(u16, String), String> = match (method.as_str(), key.is_empty()) {
        ("GET", true) => {
            // List
            match auth_storage_list(app, service) {
                Ok(keys) => serde_json::to_string(&keys)
                    .map(|body| (200, body))
                    .map_err(|e| format!("serialise: {e}")),
                Err(e) => Err(e),
            }
        }
        ("GET", false) => match auth_storage_get(service, key) {
            Ok(Some(v)) => {
                let body = serde_json::json!({ "value": v }).to_string();
                Ok((200, body))
            }
            Ok(None) => Ok((404, String::new())),
            Err(e) => Err(e),
        },
        ("PUT", false) => {
            let value = String::from_utf8_lossy(&body).into_owned();
            match auth_storage_set(app, service, key, value) {
                Ok(()) => Ok((204, String::new())),
                Err(e) => Err(e),
            }
        }
        ("DELETE", false) => match auth_storage_delete(app, service, key) {
            Ok(()) => Ok((204, String::new())),
            Err(e) => Err(e),
        },
        _ => Ok((405, String::new())),
    };

    match result {
        Ok((status, body)) => write_response(&mut write_half, status, &body).await,
        Err(e) => write_response(&mut write_half, 500, &e).await,
    }
}

async fn write_simple<W: AsyncWriteExt + Unpin>(w: &mut W, status: u16, msg: &str) -> io::Result<()> {
    write_response(w, status, msg).await
}

async fn write_response<W: AsyncWriteExt + Unpin>(
    w: &mut W,
    status: u16,
    body: &str,
) -> io::Result<()> {
    let reason = match status {
        200 => "OK",
        204 => "No Content",
        400 => "Bad Request",
        401 => "Unauthorized",
        404 => "Not Found",
        405 => "Method Not Allowed",
        413 => "Payload Too Large",
        429 => "Too Many Requests",
        500 => "Internal Server Error",
        _ => "Error",
    };
    let head = format!(
        "HTTP/1.1 {} {}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
        status,
        reason,
        body.len()
    );
    w.write_all(head.as_bytes()).await?;
    if !body.is_empty() {
        w.write_all(body.as_bytes()).await?;
    }
    w.shutdown().await?;
    Ok(())
}

fn urldecode(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let bytes = s.as_bytes();
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            let hex = std::str::from_utf8(&bytes[i + 1..i + 3]).unwrap_or("");
            if let Ok(v) = u8::from_str_radix(hex, 16) {
                out.push(v as char);
                i += 3;
                continue;
            }
        }
        out.push(bytes[i] as char);
        i += 1;
    }
    out
}
