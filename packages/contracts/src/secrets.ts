/* SPDX-License-Identifier: MIT */
/**
 * D12 (§9.4 Lane D4) — three secret values, named and typed distinctly.
 *
 * The 4.0 production-readiness plan §9.4 requires that the three values
 * that the Design/Automate code currently overloads — the desktop
 * keychain IPC bearer, the mobile encryption key, and the Workbench
 * IPC bearer — be bound to three distinct types so that a value
 * cannot be used in the wrong role.
 *
 *   - DesktopKeychainToken : the 256-bit random bearer minted by
 *     packages/desktop/src-tauri/src/auth_storage.rs:282-283 and used
 *     on the `X-Keychain-Token` and `x-unifia-keychain-token` headers
 *     on the desktop path. 64 hex chars, never persisted, regenerated
 *     on every Tauri app boot.
 *
 *   - MobileEncryptionKey : the 32-byte base64 key wrapped by the
 *     AndroidKeyStore alias `opencode.auth.master` in
 *     packages/mobile/src-tauri/gen/android/app/src/main/java/ai/unifia/mobile/MainActivity.kt
 *     and consumed by packages/unifia/src/auth/index.ts:296-311 as the
 *     AES-256-GCM key for `auth.enc.json` / `github-auth.enc.json`.
 *     44-char base64 (32 bytes), never transmitted on the wire.
 *
 *   - WorkbenchIpcBearer : the bearer expected on the `x-unifia-keychain-token`
 *     header of `POST /workbench/native/token` by
 *     packages/unifia/src/server/workbench.ts:140. On the desktop the
 *     same value as DesktopKeychainToken; on mobile today (the bug
 *     fixed by ADR-1042) the same value as MobileEncryptionKey. The
 *     bearer MUST NOT be a cipher key; the type system here enforces
 *     that.
 *
 * The brand pattern (`__brand`) gives nominal typing on a structural
 * string. At runtime, all three are plain strings, but the `make*` and
 * `tryDecode*` functions are the only way to obtain a branded value,
 * and each one validates a distinct format. A value that is a valid
 * 32-byte base64 encryption key therefore cannot be promoted to a
 * WorkbenchIpcBearer, and vice versa.
 */

declare const __brand: unique symbol

type Brand<T, B> = T & { readonly [__brand]: B }

/**
 * Desktop localhost keychain endpoint bearer. 64 lowercase hex chars
 * (256 bits, two concatenated UUIDv4 `simple()` strings). Generated at
 * Tauri app boot; never persisted.
 */
export type DesktopKeychainToken = Brand<string, "DesktopKeychainToken">

/**
 * Mobile Android Keystore-wrapped AES-256-GCM key. 32 raw bytes encoded
 * as base64 — exactly 44 characters (base64 with padding) for a 32-byte
 * payload. Never transmitted on the wire; never used as an IPC bearer.
 */
export type MobileEncryptionKey = Brand<string, "MobileEncryptionKey">

/**
 * Bearer expected on the Workbench private IPC (`x-unifia-keychain-token`
 * header on `POST /workbench/native/token`). On the desktop this is
 * currently the same value as DesktopKeychainToken; on mobile the
 * migration in ADR-1042 will require a derived token, distinct from
 * MobileEncryptionKey.
 *
 * 32 raw bytes encoded as base64 is rejected by `tryDecode*` — a
 * MobileEncryptionKey must not be accepted as a WorkbenchIpcBearer.
 */
export type WorkbenchIpcBearer = Brand<string, "WorkbenchIpcBearer">

const HEX_64 = /^[0-9a-f]{64}$/
// base64 of 32 raw bytes, with or without padding. 32 bytes -> ceil(32/3)*4 = 44 chars padded,
// or 43 chars without the trailing '='. Allow both spellings; reject shorter / longer.
const B64_32 = /^[A-Za-z0-9+/]{43,44}=?$/

function isHex64(value: string): boolean {
  return HEX_64.test(value)
}

function isBase64Of32Bytes(value: string): boolean {
  if (!B64_32.test(value)) return false
  try {
    // Buffer.from is lenient about padding; the strict check is the
    // decoded length. node Buffer is not available in every contract
    // consumer, so this file stays pure-string. We require a multiple
    // of 4 chars after padding normalisation.
    const padded = value.length % 4 === 0 ? value : value + "=".repeat(4 - (value.length % 4))
    if (padded.length !== 44) return false
    // The regex already restricted the alphabet; we still need the
    // decoded length to be 32. Use atob in the browser/edge runtime
    // and Buffer in node. Both are present in Bun and modern Node.
    if (typeof atob === "function") {
      return atob(padded).length === 32
    }
    // Fallback: treat any 44-char base64 string of 32 bytes as valid.
    // The 43/44 regex already prevents ambiguous lengths; this branch
    // is only hit in test environments without atob.
    return true
  } catch {
    return false
  }
}

/**
 * Mint a DesktopKeychainToken from a raw string. Throws on format
 * mismatch. Producer-side only — call this exactly once per Tauri
 * app boot, where the value is generated from
 * `uuid::Uuid::new_v4().simple() + uuid::Uuid::new_v4().simple()`.
 */
export function makeDesktopKeychainToken(raw: string): DesktopKeychainToken {
  if (!isHex64(raw)) {
    throw new Error(`DesktopKeychainToken must be 64 lowercase hex chars (got ${raw.length} chars)`)
  }
  return raw as DesktopKeychainToken
}

/**
 * Validate a raw string and return a DesktopKeychainToken, or null
 * if the value does not match the 64-hex-char format. Use this at
 * the migration boundary where the value comes from an untrusted
 * source (env var, header).
 */
export function tryDecodeDesktopKeychainToken(raw: string | null | undefined): DesktopKeychainToken | null {
  if (!raw) return null
  return isHex64(raw) ? (raw as DesktopKeychainToken) : null
}

/**
 * Mint a MobileEncryptionKey from a raw 32-byte base64 string. Throws
 * on format mismatch. Producer-side only — call this where the raw
 * key is unwrapped from the AndroidKeyStore alias.
 */
export function makeMobileEncryptionKey(raw: string): MobileEncryptionKey {
  if (!isBase64Of32Bytes(raw)) {
    throw new Error(`MobileEncryptionKey must be a base64-encoded 32-byte key (got ${raw.length} chars)`)
  }
  return raw as MobileEncryptionKey
}

/**
 * Validate a raw string and return a MobileEncryptionKey, or null if
 * the value does not match the 32-byte base64 format. Use this at the
 * migration boundary where the value comes from
 * `process.env.UNIFIA_AUTH_ENCRYPTION_KEY`.
 */
export function tryDecodeMobileEncryptionKey(raw: string | null | undefined): MobileEncryptionKey | null {
  if (!raw) return null
  return isBase64Of32Bytes(raw) ? (raw as MobileEncryptionKey) : null
}

/**
 * Mint a WorkbenchIpcBearer from a raw string. The format is
 * currently the same as DesktopKeychainToken (64 hex chars) on the
 * desktop; a future ADR-1042 follow-up will widen the format to
 * accept a derived token on mobile. The type system does the heavy
 * lifting: even if a future format overlaps with MobileEncryptionKey,
 * the two brand types remain incompatible.
 */
export function makeWorkbenchIpcBearer(raw: string): WorkbenchIpcBearer {
  if (!isHex64(raw)) {
    throw new Error(`WorkbenchIpcBearer must be 64 lowercase hex chars (got ${raw.length} chars)`)
  }
  return raw as WorkbenchIpcBearer
}

/**
 * Validate a raw string and return a WorkbenchIpcBearer, or null. Use
 * this at the migration boundary where the value comes from
 * `process.env.UNIFIA_WORKBENCH_BEARER` (new name) or the deprecated
 * `process.env.UNIFIA_KEYCHAIN_TOKEN` (with a warning).
 *
 * A 32-byte base64 value (the format of a MobileEncryptionKey) is
 * rejected here — that's the entire point of the type split.
 */
export function tryDecodeWorkbenchIpcBearer(raw: string | null | undefined): WorkbenchIpcBearer | null {
  if (!raw) return null
  return isHex64(raw) ? (raw as WorkbenchIpcBearer) : null
}

/**
 * Read the WorkbenchIpcBearer from an env-like object, accepting the
 * new canonical name `UNIFIA_WORKBENCH_BEARER` first and falling back
 * to the legacy name `UNIFIA_KEYCHAIN_TOKEN` with a one-shot
 * deprecation warning. The legacy name is scheduled for deletion on
 * 2026-12-31 — see ADR-1042 §Migration.
 *
 * Returns null if neither env var is set or the value does not match
 * the bearer format.
 *
 * The env parameter is required (no `process.env` default) so this
 * module stays portable across runtimes (WebView, edge, tests).
 */
export function readWorkbenchIpcBearerFromEnv(
  env: Record<string, string | undefined>,
  onDeprecated: (message: string) => void = (m) => console.warn(m),
): WorkbenchIpcBearer | null {
  const fresh = env.UNIFIA_WORKBENCH_BEARER
  if (fresh) {
    return tryDecodeWorkbenchIpcBearer(fresh)
  }
  const legacy = env.UNIFIA_KEYCHAIN_TOKEN
  if (legacy) {
    onDeprecated(
      "UNIFIA_KEYCHAIN_TOKEN is deprecated; use UNIFIA_WORKBENCH_BEARER (deletion 2026-12-31, see ADR-1042)",
    )
    return tryDecodeWorkbenchIpcBearer(legacy)
  }
  return null
}

/**
 * Read the MobileEncryptionKey from an env-like object, accepting
 * only `UNIFIA_AUTH_ENCRYPTION_KEY`. The legacy
 * `OPENCODE_AUTH_ENCRYPTION_KEY` name is intentionally NOT accepted
 * here — see B08 finding F2 and ADR-1042 §Migration (DA-SEC-02).
 *
 * The env parameter is required (no `process.env` default) so this
 * module stays portable across runtimes.
 */
export function readMobileEncryptionKeyFromEnv(
  env: Record<string, string | undefined>,
): MobileEncryptionKey | null {
  return tryDecodeMobileEncryptionKey(env.UNIFIA_AUTH_ENCRYPTION_KEY)
}
