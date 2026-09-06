<!--
SPDX-License-Identifier: MIT
Card: DA-SEC-01 (mobile secret separation)
Plan source: 4.0 plan §9.4 (Lane D4 / secret separation)
ADR: ADR-1042 (three-secrets-separation)
M9 follow-up: card D12 / `integration/secrets.md` §3
-->

# Mobile runtime — secrets on the wire

## The two values the mobile Rust host produces

The mobile sidecar receives two env vars from the Tauri shell:

| Env var                      | Brand (TS-side)         | Wire format                 | Producer (this crate)                                              |
|------------------------------|-------------------------|------------------------------|---------------------------------------------------------------------|
| `UNIFIA_AUTH_ENCRYPTION_KEY` | `MobileEncryptionKey`   | 32 raw bytes, base64 (44c)  | `getAuthStorageKey()` in `gen/android/.../MainActivity.kt:50-120`  |
| `UNIFIA_WORKBENCH_BEARER`    | `WorkbenchIpcBearer`    | 32 raw bytes, hex (64c)      | `bearer::derive_workbench_bearer()` in `runtime/bearer.rs`         |

The two are derived from the same 32-byte cipher key, but in
**different roles** — cipher key vs. IPC bearer. They MUST be
different strings on the wire. §9.4 step 4 (4.0 plan) states:
"Interdire cle de chiffrement comme bearer IPC et inversement."

## How the bearer is derived

```text
bearer = HKDF-SHA256(
    ikm  = base64_decode(UNIFIA_AUTH_ENCRYPTION_KEY),   // 32 raw bytes
    salt = per-process random 16 bytes (lazily generated
            on first use, stable for the lifetime of the
            Tauri app process, NOT persisted),
    info = "unifia.ipc-bearer.v1",
)[0..32]
UNIFIA_WORKBENCH_BEARER = hex_encode(bearer)           // 64 lowercase hex chars
```

The construction is `runtime::bearer::derive_workbench_bearer`. It is
the single source of truth for "what is a mobile Workbench bearer?".
Both `start_embedded_server` (env-var write) and
`workbench_native_request` (header write) call it, so the two
surfaces always agree within a single Tauri app boot.

## Salt handling

- The salt is a `OnceLock<[u8; 16]>` filled from the OS CSPRNG
  (`getrandom::getrandom`). Generated on first use, stable for the
  rest of the process.
- The salt is **not persisted**. Persisting it would let a snapshot
  of the encrypted-auth file alone (no AndroidKeyStore) be enough to
  forge the IPC bearer, defeating the workbench private surface.
- The salt is process-scoped, so a Tauri app restart rotates the
  salt and therefore the bearer. The consumer side
  (`packages/unifia/src/server/workbench.ts:75-85`) does not pin a
  particular bearer value — it reads whatever the sidecar env
  provides — so the rotation is transparent to the bridge.
- Bumping the Tauri app version is a salt rotation, which is a
  bearer rotation. Existing leases on the workbench (HMAC-SHA256 JWT
  per ADR-1034) become unreachable; the WebView re-issues them on
  the next native action. This is the intended migration window.

## Why the legacy `UNIFIA_KEYCHAIN_TOKEN` is gone from the mobile side

Before this card (`packages/mobile/src-tauri/src/runtime/server.rs:267,
340-341`), the mobile Rust host wrote
`UNIFIA_KEYCHAIN_TOKEN={auth_key}` — i.e., the same string as
`UNIFIA_AUTH_ENCRYPTION_KEY`. The TypeScript-side brand types in
`@unifia/contracts/secrets.ts` (commit `4b8bce83fc` on
`agent/.../secrets`) reject that value at the typed boundary
(`tryDecodeWorkbenchIpcBearer` requires 64 lowercase hex chars;
`tryDecodeMobileEncryptionKey` requires 32-byte base64), so the
workbench bridge refuses to mount and the sidecar fails loud.

The desktop consumer (`packages/unifia/src/server/workbench.ts:75-85`)
still tolerates `UNIFIA_KEYCHAIN_TOKEN` with a one-shot
`console.warn` deprecation message, scheduled for deletion on
**2026-12-31**. After that date the legacy env var is read by
nothing. The mobile side stops emitting it now (one-way transition)
to avoid the F1 footgun: if the mobile side keeps writing
`UNIFIA_KEYCHAIN_TOKEN={auth_key}` and the desktop eventually flips
the warning into a hard reject, the mobile bug resurrects silently.
Better to fix the producer now and let the consumer sunset on its
own schedule.

## F1 follow-up: the `x-unifia-keychain-token` header

`workbench_native_request` (in `runtime/server.rs:75-96`) used to
send the same `auth_key` on the `x-unifia-keychain-token` header. It
now derives the bearer the same way as the env-var writer
(`bearer::derive_workbench_bearer(&auth_key)`) and sends the
bearer. The two surfaces (env-var writer and request header)
share the same per-process salt, so the sidecar's
`UNIFIA_WORKBENCH_BEARER` and the request header carry the same
value within a single Tauri app boot.

## Files

- `runtime/bearer.rs` — `derive_workbench_bearer`, `process_salt`, `HKDF_INFO`, unit tests
- `runtime/server.rs` — `bearer_env_lines` (the env-var block), the
  `start_embedded_server` and `workbench_native_request` call sites,
  and the integration tests
- `runtime.rs` — `mod bearer;` + `pub use bearer::derive_workbench_bearer;`

## Tests

Run from the worktree root:

```bash
cd packages/mobile/src-tauri
cargo test --release
```

Two test surfaces cover DA-SEC-01:

1. **`runtime::bearer::tests`** (7 cases) — pure-crypto invariants:
   - `bearer_is_64_lowercase_hex_chars`
   - `bearer_is_deterministic_within_a_process`
   - `bearer_is_distinct_from_cipher_key`
   - `different_ikm_produces_different_bearer`
   - `rejects_non_base64_input`
   - `rejects_wrong_length_key`
   - `salt_is_16_bytes`
   - `bearer_is_stable_across_test_runs`

2. **`runtime::server::tests`** (2 new cases for DA-SEC-01) —
   env-var shape:
   - `bearer_env_lines_writes_workbench_bearer_and_drops_legacy_keychain_token`
   - `bearer_env_lines_emits_both_cipher_key_and_bearer_lines_in_order`

## Follow-ups

- The desktop producer (`packages/desktop/src-tauri/src/auth_storage.rs:282-283`)
  still uses a bare 64-hex token as the `WorkbenchIpcBearer` and
  happens to also use it as the localhost keychain endpoint bearer.
  The desktop is not in scope for this card (no `MobileEncryptionKey`
  on desktop), but a future card may want to formalize the desktop
  producer as `makeDesktopKeychainToken` (from
  `@unifia/contracts/secrets.ts:108-114`) at the type level, and to
  emit `UNIFIA_WORKBENCH_BEARER` in addition to (or instead of)
  `UNIFIA_KEYCHAIN_TOKEN` to align with the 2026-12-31 migration
  window.
