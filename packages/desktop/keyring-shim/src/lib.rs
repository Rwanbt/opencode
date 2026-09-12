// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Unifia contributors
//
// Brand-prefixed OS-keychain helpers extracted from
// `packages/desktop/src-tauri/src/auth_storage.rs` so that the keyring
// migration logic can be unit-tested on a workstation that does not have
// the Tauri runtime (DirectML / WebView2) installed.
//
// The behaviour is identical to the original; this crate only owns the
// keyring calls and the prefix selection. A `KeyringBackend` trait lets
// tests substitute a `MockBackend` (HashMap-backed) for the real
// `keyring::Entry`-backed implementation — the `keyring` crate's own
// `mock` module does not persist data between `Entry::new` calls, so it
// cannot test the cross-entry migration logic on its own.
//
// See Runbook-Autonome-Independance-Unifia-2026-08-10 §4 (carte C8-B).

use std::collections::HashMap;
use std::sync::Mutex;

pub const KEYRING_PREFIX: &str = "unifia";
pub const LEGACY_KEYRING_PREFIX: &str = "opencode";

/// A swappable OS-keychain backend.
///
/// The real implementation (`RealKeyringBackend`) delegates to the
/// `keyring` crate, which talks to the platform Credential Manager.
/// Tests use `MockBackend`, a process-local HashMap, because the
/// `keyring` crate's own `mock` module does not persist values between
/// `Entry::new` calls.
pub trait KeyringBackend: Send + Sync {
    fn get(&self, service: &str, key: &str) -> Result<Option<String>, String>;
    fn set(&self, service: &str, key: &str, value: &str) -> Result<(), String>;
    fn delete(&self, service: &str, key: &str) -> Result<(), String>;
}

/// The production backend. Each call creates a fresh `keyring::Entry`.
pub struct RealKeyringBackend;

impl KeyringBackend for RealKeyringBackend {
    fn get(&self, service: &str, key: &str) -> Result<Option<String>, String> {
        let entry = keyring::Entry::new(service, key).map_err(|e| format!("entry: {e}"))?;
        match entry.get_password() {
            Ok(v) => Ok(Some(v)),
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(e) => Err(format!("keyring get: {e}")),
        }
    }

    fn set(&self, service: &str, key: &str, value: &str) -> Result<(), String> {
        let entry = keyring::Entry::new(service, key).map_err(|e| format!("entry: {e}"))?;
        entry
            .set_password(value)
            .map_err(|e| format!("keyring set: {e}"))
    }

    fn delete(&self, service: &str, key: &str) -> Result<(), String> {
        let entry = keyring::Entry::new(service, key).map_err(|e| format!("entry: {e}"))?;
        match entry.delete_credential() {
            Ok(()) => Ok(()),
            Err(keyring::Error::NoEntry) => Ok(()),
            Err(e) => Err(format!("keyring delete: {e}")),
        }
    }
}

/// In-process HashMap backend for tests. Thread-safe.
pub struct MockBackend {
    data: Mutex<HashMap<String, String>>,
}

impl MockBackend {
    pub fn new() -> Self {
        Self {
            data: Mutex::new(HashMap::new()),
        }
    }
}

impl Default for MockBackend {
    fn default() -> Self {
        Self::new()
    }
}

impl KeyringBackend for MockBackend {
    fn get(&self, service: &str, key: &str) -> Result<Option<String>, String> {
        let k = format!("{service}/{key}");
        Ok(self.data.lock().unwrap().get(&k).cloned())
    }

    fn set(&self, service: &str, key: &str, value: &str) -> Result<(), String> {
        let k = format!("{service}/{key}");
        self.data.lock().unwrap().insert(k, value.to_string());
        Ok(())
    }

    fn delete(&self, service: &str, key: &str) -> Result<(), String> {
        let k = format!("{service}/{key}");
        self.data.lock().unwrap().remove(&k);
        Ok(())
    }
}

struct NamespacedKey {
    new: String,
    legacy: String,
}

fn namespaced(service: &str) -> NamespacedKey {
    NamespacedKey {
        new: format!("{KEYRING_PREFIX}.{service}"),
        legacy: format!("{LEGACY_KEYRING_PREFIX}.{service}"),
    }
}

/// Read a credential. Tries the new prefix first, then falls back to the
/// legacy one. If a legacy entry is found, it is copied to the new prefix
/// (the legacy entry is left in place as a backup) so subsequent reads hit
/// the new namespace.
pub fn keyring_get(
    backend: &dyn KeyringBackend,
    service: &str,
    key: &str,
) -> Result<Option<String>, String> {
    let ns = namespaced(service);

    if let Some(v) = backend.get(&ns.new, key)? {
        return Ok(Some(v));
    }

    if let Some(v) = backend.get(&ns.legacy, key)? {
        // Rewrite under the new prefix. Failure here is non-fatal: the
        // caller still gets the value, and the next read will retry.
        let _ = backend.set(&ns.new, key, &v);
        return Ok(Some(v));
    }

    Ok(None)
}

/// Write a credential under the new prefix only.
pub fn keyring_set(
    backend: &dyn KeyringBackend,
    service: &str,
    key: &str,
    value: &str,
) -> Result<(), String> {
    let ns = namespaced(service);
    backend.set(&ns.new, key, value)
}

/// Delete a credential from BOTH prefixes.
///
/// A `logout` that only cleared the new namespace would leave a copy of
/// the credential readable under the legacy namespace on the next read —
/// the user would appear to be still logged in. This is the security
/// property the runbook's STOP C8-B-1 is protecting.
pub fn keyring_delete(
    backend: &dyn KeyringBackend,
    service: &str,
    key: &str,
) -> Result<(), String> {
    let ns = namespaced(service);
    backend.delete(&ns.new, key)?;
    backend.delete(&ns.legacy, key)?;
    Ok(())
}
