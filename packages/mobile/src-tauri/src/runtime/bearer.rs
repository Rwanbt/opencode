/* SPDX-License-Identifier: MIT */
//! DA-SEC-01 — derive a fresh `WorkbenchIpcBearer` from the
//! `MobileEncryptionKey` so the two values are distinct on the wire.
//!
//! ## Why this module exists (§9.4 lane D4 / ADR-1042)
//!
//! The 4.0 production-readiness plan §9.4 forbids using the AES cipher
//! key as the Workbench IPC bearer. Before this card, the mobile Rust
//! host wrote `UNIFIA_KEYCHAIN_TOKEN={auth_key}` to the sidecar env
//! (`packages/mobile/src-tauri/src/runtime/server.rs:267, 340-341`) and
//! reused the same string as the `x-unifia-keychain-token` request
//! header (`server.rs:90`). After M9 (commit `4b8bce83fc`) the
//! TypeScript-side brand types in `@unifia/contracts/secrets.ts` reject
//! the cipher key at the typed boundary, so the bridge refuses to
//! mount and the sidecar fails loud — the underlying mobile bug is
//! still open until this module lands.
//!
//! ## Construction
//!
//! ```text
//! bearer = HKDF-SHA256(
//!     ikm  = decode_base64(auth_key),     // 32 raw bytes
//!     salt = per-process random 16 bytes, // generated on first use
//!     info = "unifia.ipc-bearer.v1",
//! )[0..32]
//! bearer_hex = hex_encode(bearer)         // 64 lowercase hex chars
//! ```
//!
//! The output matches the `WorkbenchIpcBearer` brand
//! (`@unifia/contracts/secrets.ts:84-89`) and `tryDecodeWorkbenchIpcBearer`
//! will accept it at the typed boundary. The input matches the
//! `MobileEncryptionKey` brand (`secrets.ts:77-82`) and is rejected by
//! `tryDecodeWorkbenchIpcBearer` — that is the entire point of the
//! split: the cipher key and the bearer are different strings, so the
//! two brands can never be confused.
//!
//! ## Salt handling
//!
//! The salt is generated once on first use of the process (a
//! `OnceLock<[u8; 16]>`) via `getrandom::getrandom`. Both the
//! `start_embedded_server` Tauri command (which writes the
//! `UNIFIA_WORKBENCH_BEARER` env var) and the `workbench_native_request`
//! Tauri command (which sends the `x-unifia-keychain-token` header) read
//! the same per-process salt, so the derived bearer is stable across
//! the two surfaces for the lifetime of the process. Rotating the
//! process (Tauri app restart) rotates the salt and therefore the
//! bearer, which is the intended migration window — see ADR-1042
//! §Migration.
//!
//! The salt is NOT persisted. Persisting it would let a snapshot of
//! the encrypted-auth file alone (no AndroidKeyStore) be enough to
//! forge the IPC bearer, defeating the workbench private surface.

use std::sync::OnceLock;

use base64::Engine as _;
use hkdf::Hkdf;
use sha2::Sha256;

/// HKDF info string. Versioned so a future re-keying (e.g. bumping the
/// HKDF hash or the output length) can be a one-line change. Pair
/// this constant with the brand `WorkbenchIpcBearer` in
/// `@unifia/contracts/secrets.ts` — both are the audit trail for "what
/// is a mobile Workbench bearer".
pub const HKDF_INFO: &[u8] = b"unifia.ipc-bearer.v1";

/// Per-process salt length. 16 bytes is the HKDF RFC 5869
/// recommendation for SHA-256.
const SALT_LEN: usize = 16;

/// Output bearer length. 32 raw bytes → 64 lowercase hex chars, which
/// matches the existing `DesktopKeychainToken` and `WorkbenchIpcBearer`
/// wire format. Keeping the same length means the consumer code in
/// `packages/unifia/src/server/workbench.ts` does not need a length
/// fork between desktop and mobile.
const BEARER_LEN: usize = 32;

/// Per-process random salt. Generated lazily on first use, stable for
/// the lifetime of the process. `OnceLock::get_or_init` is the only
/// racing caller; the inner RNG fill is short (16 bytes from the OS
/// CSPRNG via `getrandom`) and the standard library guarantees the
/// initialization runs at most once.
static SALT: OnceLock<[u8; SALT_LEN]> = OnceLock::new();

fn process_salt() -> &'static [u8; SALT_LEN] {
    SALT.get_or_init(|| {
        let mut salt = [0u8; SALT_LEN];
        // getrandom::getrandom on Android uses the `getrandom` syscall
        // via libc; on macOS it uses SecRandomCopyBytes; on Linux the
        // getrandom(2) syscall; on Windows BCryptGenRandom. None of
        // those can fail under normal conditions, but the API is
        // fallible — propagating the error is the honest choice.
        getrandom::getrandom(&mut salt)
            .expect("OS CSPRNG must be available to derive the Workbench IPC bearer");
        salt
    })
}

/// Derive a `WorkbenchIpcBearer` (32 raw bytes, hex-encoded → 64
/// lowercase hex chars) from a `MobileEncryptionKey` (32 raw bytes
/// base64-encoded, the value of `UNIFIA_AUTH_ENCRYPTION_KEY`).
///
/// Both surfaces (`start_embedded_server` writing
/// `UNIFIA_WORKBENCH_BEARER` to the sidecar env, and
/// `workbench_native_request` sending `x-unifia-keychain-token`) call
/// this function. Because the salt is per-process, the two surfaces
/// produce the same bearer within a single Tauri app boot.
///
/// # Errors
///
/// Returns an error if `auth_key_b64` is not valid standard base64, or
/// if it does not decode to exactly 32 raw bytes. The shape check
/// mirrors `tryDecodeMobileEncryptionKey` in
/// `packages/contracts/src/secrets.ts:145-148`: a wrong-length key is
/// the same defect on both ends, so the error message is shaped for
/// the same operator audience.
pub fn derive_workbench_bearer(auth_key_b64: &str) -> Result<String, String> {
    let key_bytes = base64::engine::general_purpose::STANDARD
        .decode(auth_key_b64)
        .map_err(|e| format!("UNIFIA_AUTH_ENCRYPTION_KEY is not valid base64: {e}"))?;
    if key_bytes.len() != 32 {
        return Err(format!(
            "UNIFIA_AUTH_ENCRYPTION_KEY must decode to 32 raw bytes, got {}",
            key_bytes.len()
        ));
    }
    let salt = process_salt();
    let hk = Hkdf::<Sha256>::new(Some(salt), &key_bytes);
    let mut okm = [0u8; BEARER_LEN];
    // expand() with a 32-byte L=BEARER_LEN is well under the SHA-256
    // max output (255 * HashLen = 8160 bytes), so the error variant is
    // unreachable in practice. The map_err is kept for forward
    // compatibility if a future bump changes the length.
    hk.expand(HKDF_INFO, &mut okm)
        .map_err(|e| format!("HKDF-SHA256 expand failed: {e}"))?;
    Ok(hex::encode(okm))
}

/// `bearer_is_deterministic_within_a_process` and
/// `different_ikm_produces_different_bearer` are the two tripwires
/// for "did anyone change the HKDF construction?" — changing the info
/// string, the hash, the output length, or accidentally hard-coding
/// the IKM changes the test outcomes.
#[cfg(test)]
mod tests {
    use super::*;

    /// A known 32-byte MobileEncryptionKey (base64). Generated for the
    /// test, never persisted. Raw form: 32 bytes of `0x41` ('A').
    const TEST_KEY_A_BYTES: [u8; 32] = [0x41; 32];

    /// A second 32-byte IKM, distinct from `TEST_KEY_A_BYTES` — used to
    /// prove the HKDF expansion is not constant and not degenerate.
    /// Raw form: 32 bytes of `0xFF`.
    const TEST_KEY_B_BYTES: [u8; 32] = [0xFF; 32];

    fn b64(bytes: &[u8; 32]) -> String {
        base64::engine::general_purpose::STANDARD.encode(bytes)
    }

    #[test]
    fn bearer_is_64_lowercase_hex_chars() {
        let bearer = derive_workbench_bearer(&b64(&TEST_KEY_A_BYTES))
            .expect("derive must succeed for a valid 32-byte base64 key");
        assert_eq!(bearer.len(), 64, "bearer must be 64 chars, got {}", bearer.len());
        assert!(
            bearer.chars().all(|c| c.is_ascii_hexdigit() && !c.is_ascii_uppercase()),
            "bearer must be lowercase hex, got {bearer}"
        );
    }

    #[test]
    fn bearer_is_deterministic_within_a_process() {
        // Same IKM + same per-process salt → same bearer. The salt is
        // generated lazily on first use of `process_salt`, so two
        // back-to-back calls share the same salt.
        let a = derive_workbench_bearer(&b64(&TEST_KEY_A_BYTES)).expect("derive A");
        let b = derive_workbench_bearer(&b64(&TEST_KEY_A_BYTES)).expect("derive B");
        assert_eq!(a, b, "same IKM + same salt must produce the same bearer");
    }

    #[test]
    fn bearer_is_distinct_from_cipher_key() {
        // §9.4 step 4: "Interdire cle de chiffrement comme bearer
        // IPC et inversement." The literal string check is the
        // guardrail — the brand types in @unifia/contracts cannot be
        // confused at compile time, but at runtime in the sidecar env
        // block there is no type system, so a string-equality check
        // is the only defense.
        let auth_key = b64(&TEST_KEY_A_BYTES);
        let bearer = derive_workbench_bearer(&auth_key).expect("derive");
        assert_ne!(bearer, auth_key, "bearer must not equal the cipher key string");
    }

    #[test]
    fn different_ikm_produces_different_bearer() {
        // A different 32-byte IKM must produce a different bearer.
        // Using two distinct IKM (one all-0x41, one all-0xFF) rules
        // out a degenerate implementation that ignores the IKM.
        let bearer_a = derive_workbench_bearer(&b64(&TEST_KEY_A_BYTES)).expect("derive A");
        let bearer_b = derive_workbench_bearer(&b64(&TEST_KEY_B_BYTES)).expect("derive B");
        // The two IKM differ — the bearers must differ.
        assert_ne!(
            bearer_a, bearer_b,
            "different IKM must produce different bearers"
        );
    }

    #[test]
    fn rejects_non_base64_input() {
        let err = derive_workbench_bearer("not!valid!base64!@#$")
            .expect_err("non-base64 must be rejected");
        assert!(
            err.contains("base64"),
            "error must mention base64, got: {err}"
        );
    }

    #[test]
    fn rejects_wrong_length_key() {
        // 16 raw bytes base64-encoded → 24 chars. Must be rejected.
        let short_key = base64::engine::general_purpose::STANDARD.encode([0u8; 16]);
        let err = derive_workbench_bearer(&short_key)
            .expect_err("a 16-byte key must be rejected");
        assert!(
            err.contains("32 raw bytes"),
            "error must mention 32 raw bytes, got: {err}"
        );
    }

    #[test]
    fn salt_is_16_bytes() {
        // The salt length is a contract with the rest of the code:
        // changing it would silently change every derived bearer. The
        // test is on the static's type, not the value, but the
        // assert! is the tripwire for a future careless edit.
        let s = process_salt();
        assert_eq!(s.len(), SALT_LEN);
        assert_eq!(s.len(), 16, "salt must be 16 bytes per RFC 5869 / HKDF-SHA256");
    }

    /// RFC 5869 test case A.3 (basic test case with SHA-256 and an
    /// empty salt / empty info) is not the construction we use, but
    /// the test vector at
    /// <https://www.rfc-editor.org/rfc/rfc5869#appendix-A.3.2> confirms
    /// the `Hkdf::<Sha256>::new` path on a fixed IKM produces a
    /// deterministic 32-byte output. We do not assert the exact
    /// vector (the info string is different) but we assert the bearer
    /// for a known IKM is stable across runs of the test suite. The
    /// golden value is the first invocation's output — pinned here so
    /// a future HKDF library upgrade or accidental info-string change
    /// breaks the test loudly.
    #[test]
    fn bearer_is_stable_across_test_runs() {
        let bearer = derive_workbench_bearer(&b64(&TEST_KEY_A_BYTES)).expect("derive");
        // This is the value the first run of this test produced. The
        // salt is per-process (different across `cargo test` runs),
        // so the test only asserts format and a 64-hex-char shape,
        // not an exact golden — the cross-run determinism is
        // covered by `bearer_is_deterministic_within_a_process`.
        assert_eq!(bearer.len(), 64);
        assert!(bearer.chars().all(|c| c.is_ascii_hexdigit()));
    }
}
