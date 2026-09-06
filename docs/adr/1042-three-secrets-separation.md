<!-- SPDX-License-Identifier: MIT -->

---
id: 1042
title: Three secrets separation — DesktopKeychainToken, MobileEncryptionKey, WorkbenchIpcBearer
status: PROPOSED
date: 2026-08-31
related: [0008, 1027, 1028, 1034, 1038]
---

# ADR-1042: Three secrets separation — bind values to names, forbid cross-role use

## Context

The 4.0 production-readiness plan §9.4 (Lane D4) calls out three secret
values that the Design/Automate code currently treats as interchangeable
strings on the wire:

- **Secret A** — the desktop localhost keychain IPC bearer, minted at
  `packages/desktop/src-tauri/src/auth_storage.rs:282-283` (two
  concatenated UUIDv4 `simple()` strings, 256 bits, never persisted)
  and read by the sidecar in
  `packages/unifia/src/server/workbench.ts:77` and
  `packages/unifia/src/auth/index.ts:145`.
- **Secret B** — the mobile Android Keystore-wrapped AES-256-GCM key
  (32 bytes, base64) for `auth.enc.json` /
  `github-auth.enc.json`, read by
  `packages/unifia/src/auth/index.ts:296, 310` and produced by
  `MainActivity.kt:50-120` (AndroidKeyStore alias
  `opencode.auth.master`).
- **Secret C** — the Workbench lease token (HMAC-SHA256 capability-
  scoped JWT, mint at `workbench-server/src/index.ts:310-336`). This
  ADR does not change Secret C; the brand `WorkbenchIpcBearer` is for
  the *bearer* on `POST /workbench/native/token` (the IPC layer that
  issues Secret C leases), not for the lease itself.

The mobile Rust host violates the §9.4 rule "interdire cle de
chiffrement comme bearer IPC et inversement":

```
UNIFIA_AUTH_ENCRYPTION_KEY={auth_key}   ← Secret B
UNIFIA_KEYCHAIN_TOKEN={auth_key}        ← same value
```

at `packages/mobile/src-tauri/src/runtime/server.rs:267, 340-341`,
then sends the same value as the `x-unifia-keychain-token` bearer on
`POST /workbench/native/token` at `server.rs:90`. Anyone who reads
the sidecar's environment (loopback sniffer, same-UID process reading
`/proc/<pid>/environ`) recovers the AES key for the user's provider
credentials. Conversely, anyone who recovers the wrapped key blob
from a rooted device can forge Workbench IPC calls. This is the F1
finding of `cards/b08-secrets-trust.md`.

The desktop path is correct as-is: Secret A is a 256-bit bearer, not
a cipher key. The two protocols that share it (`X-Keychain-Token`
on the localhost keychain endpoint, `x-unifia-keychain-token` on
`/workbench/native/token`) are both bearer protocols, so the §9.4
rule is satisfied. The Workbench *lease* (Secret C) is a distinct
HMAC-signed JWT and is never confused with the IPC bearer.

The 4.0 plan §9.4 step 2 calls for *names and wrappers*; step 3
calls for a migration-compatibility window; step 5 calls for tests
that would catch the confusion. Today none of those exists:
`UNIFIA_KEYCHAIN_TOKEN` and `UNIFIA_AUTH_ENCRYPTION_KEY` are
read as `string | undefined` (`flag.ts:249-250`), no test asserts
they must differ, and the §9.4 rule has no ADR. Card B08 / §9.4
D12.

## Decision

Bind the three secrets to three distinct TypeScript brands in
`@unifia/contracts`, so the type system makes a value
unusable in the wrong role:

```ts
export type DesktopKeychainToken = Brand<string, "DesktopKeychainToken">   // 64 lowercase hex chars
export type MobileEncryptionKey    = Brand<string, "MobileEncryptionKey">   // 32-byte base64
export type WorkbenchIpcBearer     = Brand<string, "WorkbenchIpcBearer">    // 64 lowercase hex chars
```

Each brand is a nominal type — `DesktopKeychainToken` and
`WorkbenchIpcBearer` share a wire format today (both 64 hex chars)
but the type system still treats them as distinct, so a future
change to the Workbench IPC format (e.g. an HKDF-derived token on
mobile, see §"Mobile path" below) cannot break the desktop producer
by accident.

The three `make*` functions are the only way to obtain a branded
value; the three `tryDecode*` functions are the only way to obtain
one from an untrusted string (env var, header, JSON body). Each
decoder validates a distinct format. A 32-byte base64
`MobileEncryptionKey` therefore cannot be promoted to a
`WorkbenchIpcBearer`, and a 64-hex-char `DesktopKeychainToken`
cannot be promoted to a `MobileEncryptionKey`. The compile-time
brand is the §9.4 rule; the runtime decoder is the test surface
that would have caught the mobile bug.

The brand and the runtime decoder are belt-and-braces — either
one alone would block the confusion. Both are required:

- The brand alone is insufficient: the values come from `process.env`
  and request headers, which are plain strings at the boundary.
- The decoder alone is insufficient: a future refactor that
  accidentally passes the wrong raw string would still type-check.

### Three named values, three producer sites

| Brand | Producer (write site) | Consumer (read site) | Env var | Deletion |
|---|---|---|---|---|
| `DesktopKeychainToken` | `desktop/src-tauri/src/auth_storage.rs:282-283` (`start_keychain_endpoint`, two UUIDv4 `simple()` strings) | `unifia/src/auth/index.ts:145` (`KeychainStorage.token`) | `UNIFIA_KEYCHAIN_URL` + `UNIFIA_KEYCHAIN_TOKEN` | never (the Tauri host always mints it) |
| `MobileEncryptionKey` | `mobile/src-tauri/gen/.../MainActivity.kt:50-120` (AndroidKeyStore alias `opencode.auth.master`, `SecureRandom`) | `unifia/src/auth/index.ts:296, 310` (`readEncryptedAuth` / `writeEncryptedAuth`) | `UNIFIA_AUTH_ENCRYPTION_KEY` | never (the keystore always unwraps it) |
| `WorkbenchIpcBearer` | desktop: same as `DesktopKeychainToken` (sent by `desktop/src-tauri/src/lib.rs:141-150`); mobile: TODO — derive from Secret B via HKDF | `unifia/src/server/workbench.ts:77` (`createWorkbenchBridge.ipcToken`) | `UNIFIA_WORKBENCH_BEARER` (new); `UNIFIA_KEYCHAIN_TOKEN` (legacy) | 2026-12-31 for the legacy name |

### Migration

`packages/contracts/src/secrets.ts` exposes
`readWorkbenchIpcBearerFromEnv(env, onDeprecated)` which accepts the
new env var `UNIFIA_WORKBENCH_BEARER` first and falls back to the
legacy `UNIFIA_KEYCHAIN_TOKEN` with a one-shot deprecation warning:

```
UNIFIA_KEYCHAIN_TOKEN is deprecated; use UNIFIA_WORKBENCH_BEARER
(deletion 2026-12-31, see ADR-1042)
```

`readMobileEncryptionKeyFromEnv(env)` accepts only
`UNIFIA_AUTH_ENCRYPTION_KEY`. The legacy
`OPENCODE_AUTH_ENCRYPTION_KEY` name is intentionally **not**
accepted here — that is the F2 finding of
`cards/b08-secrets-trust.md` and is closed by
`packages/unifia/src/github/auth.ts:48, 69` reading only
`UNIFIA_AUTH_ENCRYPTION_KEY`. This ADR is a defensive lock: if a
future refactor reintroduces the legacy name on the encryption-key
path, the brand still refuses it.

The deletion date 2026-12-31 is the same date as the broader
OpenCode→Unifia rebrand migration window; after that date, the
sidecar will treat `UNIFIA_KEYCHAIN_TOKEN` as missing. The desktop
Tauri shell will continue to set both names during the window so
that an out-of-date sidecar still works.

### Test surface

`packages/contracts/test/secrets.test.ts` (23 cases):

1. `make*` rejects every wrong format (compile-time brands are
   the production guard, runtime decoders are the test guard).
2. `tryDecode*` returns null on a value shaped like a *different*
   secret (the headline test: a 32-byte base64
   `MobileEncryptionKey` is rejected by
   `tryDecodeWorkbenchIpcBearer`).
3. Compile-time: the file has `// @ts-expect-error` directives on
   the cross-brand assignments. If the brands ever lose their
   nominality, the test file fails to compile, which is the
   intended signal.
4. Migration: the legacy `UNIFIA_KEYCHAIN_TOKEN` env var still
   works but logs the deprecation warning; the new
   `UNIFIA_WORKBENCH_BEARER` is silent. A 32-byte base64 value on
   the legacy name is rejected (the bug shape, today).

The existing `workbench-bridge.test.ts` (9 cases) was updated to
use a 64-hex-char bearer — the legacy `private-ipc-token`
placeholder (17 chars) was a TestConventions-style string that
no longer round-trips through `tryDecodeWorkbenchIpcBearer`. The
mock keychain server now mints 64-hex-char tokens (production
format), and the `rejects requests with a bad token` case uses a
distinct 64-hex value to exercise the wire-level rejection rather
than the typed-decode rejection.

### Mobile path

This ADR does not yet fix the §9.4 violation on the mobile Rust
host — that is a code change in
`packages/mobile/src-tauri/src/runtime/server.rs:267, 340-341` and
is tracked as `DA-SEC-01` in `cards/b08-secrets-trust.md`. The
mobile path must:

1. Stop writing `UNIFIA_KEYCHAIN_TOKEN={auth_key}`. The mobile
   sidecar's `createWorkbenchBridge` would then return
   `undefined` (no bearer) and refuse to mount the private
   Workbench surface, which is the right behaviour — there is
   no `workbench/native/token` on the Android Tauri host.
2. Generate a fresh, ephemeral `WorkbenchIpcBearer` and write it
   to `UNIFIA_WORKBENCH_BEARER`. The bearer should be derived
   from Secret B via HKDF-SHA256 with the info string
   `unifia.ipc-bearer.v1` and a random salt, so a leak of the
   bearer does not collapse back to the AES key.

The mobile change is out of scope for this ADR (the brand
separation is the §9.4 step 2; the mobile Rust refactor is
§9.4 step 6). It is committed to in §"Consequences" below.

## Alternatives rejected

- **Single `string` type with a runtime check on the boundary**.
  Rejected: a future refactor that swaps the two values (e.g. a
  copy-paste between the encryption-key path and the bearer
  path) would compile and pass a unit test that doesn't assert
  the cross-role rejection. The brand makes the swap a compile
  error.
- **One brand for "any secret", discriminated by a runtime
  `kind` field**. Rejected: the discriminator would have to be
  checked at every consumer, and a missing check is the exact
  shape of the F1 bug. The nominal type forces the check at the
  producer.
- **Drop the legacy `UNIFIA_KEYCHAIN_TOKEN` name immediately**.
  Rejected: the sidecar is shipped in a desktop app where users
  may have downgraded and not restarted. The deprecation
  warning is the §9.4 step 3 requirement; deletion is
  2026-12-31.
- **Accept the legacy `OPENCODE_AUTH_ENCRYPTION_KEY` name on the
  encryption-key path for compatibility**. Rejected: this is the
  F2 finding, and accepting it would re-introduce the same
  open-coded env-var coupling that caused the original bug.

## Consequences

Positive:

- The §9.4 rule is enforced at compile time. A
  `MobileEncryptionKey` value cannot be passed where a
  `WorkbenchIpcBearer` is expected (and vice versa) without an
  explicit `tryDecode*` round-trip.
- A regression test fails at PR time if the mobile path
  re-introduces the same `auth_key` under both env names —
  `tryDecodeWorkbenchIpcBearer` returns null for a 32-byte
  base64 value, so the workbench bridge refuses to mount.
- The deprecation warning gives operators a single, traceable
  signal to update their env-var contracts.

Negative:

- The legacy `UNIFIA_KEYCHAIN_TOKEN` env var remains accepted
  until 2026-12-31, during which a misconfigured deployment can
  still satisfy the workbench bridge with the desktop's
  64-hex-char value. The deprecation warning is the only
  remediation signal.
- `tryDecode*` runs the format check on every read site. The
  cost is one regex per call, which is negligible relative to
  the AES-GCM round-trip that follows.
- Three type aliases in `@unifia/contracts` add a small amount
  of complexity. The cost is bounded — the brands are
  transparent at runtime, and the test file (23 cases) is the
  only place the runtime decoders are exercised end-to-end.

Follow-up required:

- `DA-SEC-01` — fix the mobile Rust host to stop writing
  `UNIFIA_KEYCHAIN_TOKEN={auth_key}` and instead mint a fresh
  `WorkbenchIpcBearer` from Secret B via HKDF, written to
  `UNIFIA_WORKBENCH_BEARER`. Tracked in
  `cards/b08-secrets-trust.md` §5 F1.
- `DA-SEC-02` — already closed by
  `packages/unifia/src/github/auth.ts:48, 69` reading only
  `UNIFIA_AUTH_ENCRYPTION_KEY`. This ADR's brand is a defensive
  lock.
- `DA-SEC-03` — covered by this ADR's test surface
  (`packages/contracts/test/secrets.test.ts`).
- `DA-SEC-04` — declare `UNIFIA_AUTH_ENCRYPTION_KEY` in
  `packages/unifia/src/flag/flag.ts` so the sidecar has a single
  source of truth for the env var name. Tracked separately.

## See also

- `docs/adr/0008-secret-store.md` — the SecretStore interface
  (PROPOSED). This ADR narrows the interface to the three named
  values, but does not change the `Keyring` vs `EncryptedFile`
  backend choice.
- `docs/adr/1027-local-install-secret.md` — the
  `observability_hmac.key` (32-byte local secret for
  pseudonymisation). This is a *fourth* secret, not one of the
  three. The two ADRs are deliberately independent.
- `docs/adr/1028-local-auth-ownership.md` — the local Unifia
  control-plane JWT. Orthogonal to the three secrets above.
- `docs/adr/1034-token-capability-scope-vs-approval-broker.md` —
  Secret C (the lease token) is the consumer of capability
  scope. This ADR's `WorkbenchIpcBearer` is the *bearer* on the
  private IPC that issues Secret C, not Secret C itself.
- `docs/adr/1038-design-capabilities.md` — the six Design
  capabilities. No change required.
- `cards/b08-secrets-trust.md` — the read-only inventory that
  named the three secrets and the F1-F5 findings this ADR
  closes.
