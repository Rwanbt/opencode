// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Unifia contributors
//
// Integration tests for carte C8-B of the
// Runbook-Autonome-Independance-Unifia-2026-08-10. They use the
// `MockBackend` (HashMap) defined in the shim, which behaves like a
// real key-value store — unlike the `keyring` crate's own `mock` module,
// which does not persist data between `Entry::new` calls.

use unifia_keyring_shim::{
    keyring_delete, keyring_get, keyring_set, KeyringBackend, MockBackend,
};

fn new_prefix(service: &str) -> String {
    format!("{}.{service}", unifia_keyring_shim::KEYRING_PREFIX)
}

fn legacy_prefix(service: &str) -> String {
    format!("{}.{service}", unifia_keyring_shim::LEGACY_KEYRING_PREFIX)
}

#[test]
fn get_falls_back_to_legacy_and_rewrites_under_new() {
    let backend = MockBackend::new();
    let service = "anthropic-rewrite";
    let key = "user-1";

    backend.set(&legacy_prefix(service), key, "legacy-secret").unwrap();

    let value = keyring_get(&backend, service, key).expect("get");
    assert_eq!(value.as_deref(), Some("legacy-secret"));

    // After the read, the new prefix now holds the same value.
    let new_value = backend.get(&new_prefix(service), key).expect("new present");
    assert_eq!(new_value.as_deref(), Some("legacy-secret"));

    // The legacy entry is NOT deleted — the runbook explicitly keeps it
    // so a concurrent upstream install keeps working.
    let legacy_value = backend.get(&legacy_prefix(service), key).expect("legacy kept");
    assert_eq!(legacy_value.as_deref(), Some("legacy-secret"));
}

#[test]
fn get_prefers_new_when_both_prefixes_have_an_entry() {
    let backend = MockBackend::new();
    let service = "anthropic-prefer";
    let key = "user-1";

    backend.set(&new_prefix(service), key, "new-secret").unwrap();
    backend.set(&legacy_prefix(service), key, "old-secret").unwrap();

    let value = keyring_get(&backend, service, key).expect("get");
    assert_eq!(value.as_deref(), Some("new-secret"));
}

#[test]
fn set_writes_only_to_new_prefix() {
    let backend = MockBackend::new();
    let service = "anthropic-setonly";
    let key = "user-1";

    keyring_set(&backend, service, key, "fresh").expect("set");

    assert_eq!(
        backend.get(&new_prefix(service), key).unwrap().as_deref(),
        Some("fresh")
    );
    assert_eq!(
        backend.get(&legacy_prefix(service), key).unwrap(),
        None,
        "legacy prefix must remain empty after a set",
    );
}

#[test]
fn delete_removes_both_prefixes() {
    let backend = MockBackend::new();
    let service = "anthropic-logout";
    let key = "user-1";

    // Pre-populate both prefixes, like an install that has been
    // running for a while and still has a legacy entry around.
    backend.set(&new_prefix(service), key, "new-secret").unwrap();
    backend.set(&legacy_prefix(service), key, "old-secret").unwrap();

    keyring_delete(&backend, service, key).expect("delete");

    assert_eq!(
        backend.get(&new_prefix(service), key).unwrap(),
        None,
        "new prefix is cleared",
    );
    assert_eq!(
        backend.get(&legacy_prefix(service), key).unwrap(),
        None,
        "legacy prefix is also cleared — no phantom credential after logout",
    );
}

#[test]
fn delete_is_safe_when_neither_prefix_has_an_entry() {
    let backend = MockBackend::new();
    // A no-op logout must not error — the TS layer treats this path
    // as a normal "not signed in" state.
    keyring_delete(&backend, "never-set", "nobody").expect("delete is a no-op");
}

#[test]
fn get_returns_none_when_neither_prefix_has_an_entry() {
    let backend = MockBackend::new();
    let value = keyring_get(&backend, "never-set", "nobody").expect("get");
    assert!(value.is_none());
}

#[test]
fn second_get_after_legacy_rewrite_uses_new_prefix() {
    // After the first read rewrites the legacy entry into the new
    // namespace, subsequent reads must hit the new prefix and return
    // the same value. The legacy entry is still there, but it is not
    // read.
    let backend = MockBackend::new();
    let service = "anthropic-second-read";
    let key = "user-1";

    backend.set(&legacy_prefix(service), key, "old-secret").unwrap();

    // First read rewrites into the new namespace.
    let v1 = keyring_get(&backend, service, key).unwrap();
    assert_eq!(v1.as_deref(), Some("old-secret"));

    // Manually overwrite the legacy entry to a different value to
    // prove the second read uses the new prefix and not the legacy
    // one. (In a real keychain the legacy entry would be untouched;
    // this test only exercises the read-path preference.)
    backend.set(&legacy_prefix(service), key, "poisoned").unwrap();

    let v2 = keyring_get(&backend, service, key).unwrap();
    assert_eq!(
        v2.as_deref(),
        Some("old-secret"),
        "second read must prefer the rewritten new prefix",
    );
}
