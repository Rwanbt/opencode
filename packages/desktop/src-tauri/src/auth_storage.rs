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
use tauri::{AppHandle, Manager};

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
