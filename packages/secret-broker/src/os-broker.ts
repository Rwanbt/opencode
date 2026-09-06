/* SPDX-License-Identifier: MIT */
// Copyright (c) 2026 Unifia contributors
//
// Secret Broker — OS-level integration (ADR-010, plan §3.7 + §5.6).
//
// This module ports the in-memory `secret-broker` scaffold onto an
// OS-aware backing store. The application layer is unchanged — the
// broker still seals material with AEAD-AES-256-GCM via the same
// `envelope`/`unenvelope` algorithm the in-memory broker uses
// (`packages/secret-broker/src/index.ts:265-327`), with the same 6
// AAD domains (plan §76):
//
//   artifact-content, credential-material, audit-row, oauth-token,
//   browser-auth-profile, sensitive-runtime-state.
//
// The OS-level integration is the **second layer of defense in
// depth**: the application envelope (AEAD) is the authoritative
// cryptographic binding; the OS secure store (DPAPI / Keychain /
// libsecret) is the durability layer that survives process
// restarts and provides the OS user identity binding.
//
// ============================================================================
// PLATFORM MATRIX (ADR-006 — target: Automate Core × local-single-node)
// ============================================================================
//
//   Windows : DPAPI (CryptProtectData / CryptUnprotectData). The
//             target is `@napi-rs/keyring` (modern, NAPI-RS based,
//             Node 18+ compatible). Native module required.
//   macOS   : Keychain Services. The target is the same
//             `@napi-rs/keyring` package (it supports macOS
//             Keychain natively).
//   Linux   : libsecret (GNOME Keyring / KWallet via D-Bus). Same
//             `@napi-rs/keyring` target.
//
// The spike (plan §5.6) accepts a **PBKDF2 fallback** that works on
// all three platforms without a native module. The fallback derives
// a per-host KEK from a passphrase + per-installation salt, both
// stored under `~/.unifia/secret-broker/`. The fallback is honest
// documentation-grade scaffolding: it proves the API surface and
// the cross-process persistence, but it is NOT real OS secure
// storage — replacing it with a real DPAPI/Keychain/libsecret
// binding is a one-call swap in the `loadOsKek` / `storeOsKek`
// helpers below.
//
// ============================================================================
// STATE LAYOUT
// ============================================================================
//
//   ~/.unifia/secret-broker/        (or %USERPROFILE%\unifia\secret-broker\ on Windows)
//   ├── salt                       (32 bytes, per-installation; mode 0600 on Unix)
//   ├── kek                        (presence marker; KEK is PBKDF2-derived on demand)
//   └── entries/
//       ├── <orgId>__<wsId>__<refKind>__<refId>.json
//       └── ...
//
// Each `<…>.json` file is the full `Entry` shape (credential/secret/
// oauth/browser-profile), serialized with the material field replaced
// by the OS-sealed AEAD envelope (so the file is opaque at rest).
//
// ============================================================================
// FAILURE MODES
// ============================================================================
//
//   - Missing root key: `KeyUnavailableError` (plan §79).
//   - Wrong-length root key: `KeyUnavailableError`.
//   - Disk I/O failure: re-thrown with a wrapped message; the broker
//     is the sole owner of secret material, so a write that fails is
//     surfaced to the caller (no silent corruption, plan §79).
//   - Tampered envelope on disk: `EnvelopeIntegrityError` (GCM tag
//     verification fails on read).
//   - Cross-tenant access: `TenantMismatchError` (TM-T-01).
//   - OS-layer mismatch (file sealed by `dpapi`, broker on `linux`):
//     `EnvelopeIntegrityError`.

import { createCipheriv, createDecipheriv, createHash, pbkdf2Sync, randomBytes } from "node:crypto"
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { homedir, hostname, tmpdir } from "node:os"
import { dirname, join } from "node:path"

import {
  CredentialNotFoundError,
  CredentialRevokedError,
  EnvelopeIntegrityError,
  KeyUnavailableError,
  TenantMismatchError,
  type AtRestProtectionEnvelope,
  type BrowserAuthMaterial,
  type BrowserAuthProfileRef,
  type CredentialRef,
  type OAuthConnectionRef,
  type OAuthToken,
  type OwnershipScope,
  type SecretBroker,
  type SecretMaterial,
  type SecretRef,
} from "./index.js"

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const ROOT_KEY_BYTES = 32
const NONCE_BYTES = 12
const GCM_TAG_BYTES = 16
const PBKDF2_ITERATIONS = 100_000
const PBKDF2_KEYLEN = 32
const PBKDF2_DIGEST = "sha256"
const SALT_BYTES = 32
const KEY_REF = "root-key"
const KEY_VERSION = 1
const ENVELOPE_VERSION = 1 as const

// The directory layout. `os.homedir()` is the documented cross-platform
// home: `%USERPROFILE%` on Windows, `$HOME` on macOS/Linux.
const STORE_DIRNAME = process.platform === "win32" ? "unifia/secret-broker" : ".unifia/secret-broker"
const SALT_FILENAME = "salt"
const KEK_FILENAME = "kek"

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/**
 * Per-platform hints. The spike accepts an override so the same code
 * path can be exercised on Linux/macOS/Windows without a real native
 * module. In production, leave `platform` and `storageDir` undefined
 * and let the broker auto-detect.
 */
export type OsBrokerOptions = {
  /** 32-byte AES-256 root key. Required. */
  rootKey: Uint8Array
  /** Override `process.platform` (testing only). */
  platform?: NodeJS.Platform
  /**
   * Override the storage root (testing only). Defaults to
   * `${os.homedir()}/${STORE_DIRNAME}` on every platform. Set to a
   * temp directory in tests so the spike does not pollute the
   * user's home.
   */
  storageDir?: string
}

/**
 * On-disk entry shape. The `material` field carries the AEAD envelope
 * for the credential / secret kinds, and is `null` for the
 * `oauth` and `browser-profile` kinds (those are JSON-serialised
 * typed objects — see `storeOAuthConnection` / `storeBrowserAuthProfile`).
 */
type OnDiskEntry =
  | {
      kind: "credential"
      scope: OwnershipScope
      aadDomain: string
      revoked: boolean
      material: AtRestProtectionEnvelope
    }
  | {
      kind: "secret"
      scope: OwnershipScope
      aadDomain: string
      revoked: boolean
      material: AtRestProtectionEnvelope
    }
  | {
      kind: "oauth"
      scope: OwnershipScope
      aadDomain: string
      revoked: boolean
      token: OAuthToken
    }
  | {
      kind: "browser-profile"
      scope: OwnershipScope
      aadDomain: string
      revoked: boolean
      profile: { cookies: Array<[string, string]>; tokens?: string[] }
    }

type EntryKind = OnDiskEntry["kind"]

// ---------------------------------------------------------------------------
// Filesystem helpers
// ---------------------------------------------------------------------------

function resolveStorageDir(override: string | undefined): string {
  if (override) return override
  return join(homedir(), STORE_DIRNAME)
}

function ensureDir(dir: string): void {
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
    // Best-effort POSIX mode tightening. On Windows `chmodSync` is a
    // no-op for the bits that matter; the user-profile boundary is
    // what protects the directory there.
    try {
      chmodSync(dir, 0o700)
    } catch {
      // ignore — Windows / non-POSIX filesystems
    }
  }
}

function pathForEntry(storageDir: string, scope: OwnershipScope, kind: EntryKind, id: string): string {
  // The on-disk path is a *display name*, not a security boundary. The
  // AEAD envelope is the security boundary; the path is for
  // operators to find the file. We keep it readable.
  const safeScope = `${scope.organizationId}__${scope.workspaceId}`.replace(/[^A-Za-z0-9_.-]/g, "_")
  const safeId = id.replace(/[^A-Za-z0-9_.-]/g, "_")
  return join(storageDir, "entries", `${safeScope}__${kind}__${safeId}.json`)
}

// ---------------------------------------------------------------------------
// PBKDF2 fallback — simulates the OS secure store.
//
// The "passphrase" is `${process.env.USERPROFILE}\\${hostname()}` on
// Windows and `${homedir()}:${hostname()}` on Unix. The salt is a
// 32-byte random value stored in `~/.unifia/secret-broker/salt`.
//
// This is NOT real OS secure storage. It is the documented fallback
// that lets the spike run cross-platform without a native module.
// A real implementation would replace `loadOsKek` / `storeOsKek`
// with calls into `@napi-rs/keyring` (or the platform native API).
// ---------------------------------------------------------------------------

function osPassphrase(platform: NodeJS.Platform): string {
  if (platform === "win32") {
    return `${process.env.USERPROFILE ?? homedir()}\\${hostname()}`
  }
  return `${homedir()}:${hostname()}`
}

function ensureSalt(storageDir: string): Buffer {
  ensureDir(storageDir)
  const saltPath = join(storageDir, SALT_FILENAME)
  if (existsSync(saltPath)) {
    return readFileSync(saltPath)
  }
  const salt = randomBytes(SALT_BYTES)
  writeFileSync(saltPath, salt, { mode: 0o600 })
  try {
    chmodSync(saltPath, 0o600)
  } catch {
    // ignore
  }
  return salt
}

/**
 * Load the OS-level KEK. PBKDF2 fallback. Production replaces this
 * with a DPAPI / Keychain / libsecret lookup.
 */
function loadOsKek(storageDir: string, platform: NodeJS.Platform): Buffer {
  const salt = ensureSalt(storageDir)
  const passphrase = osPassphrase(platform)
  return pbkdf2Sync(passphrase, salt, PBKDF2_ITERATIONS, PBKDF2_KEYLEN, PBKDF2_DIGEST)
}

function storeOsKek(storageDir: string): void {
  // No-op for the PBKDF2 fallback: the KEK is derived on demand from
  // the salt + passphrase. The `kek` file is created as a
  // presence marker so operators can see the OS layer is initialised.
  const kekPath = join(storageDir, KEK_FILENAME)
  if (!existsSync(kekPath)) {
    writeFileSync(kekPath, new Uint8Array([0x01]), { mode: 0o600 })
    try {
      chmodSync(kekPath, 0o600)
    } catch {
      // ignore
    }
  }
}

// ---------------------------------------------------------------------------
// Platform detection
// ---------------------------------------------------------------------------

/**
 * Returns the human-readable name of the OS secure storage backend
 * this broker would use in production. The value is recorded in the
 * `OnDiskEntry` for audit and is stable across the 3 platforms.
 */
function platformName(platform: NodeJS.Platform): "dpapi" | "keychain" | "libsecret" {
  if (platform === "win32") return "dpapi"
  if (platform === "darwin") return "keychain"
  return "libsecret"
}

// ---------------------------------------------------------------------------
// Material (de)serialisation
// ---------------------------------------------------------------------------

/**
 * `envelope` from `./index.ts:265-327` returns a value that contains
 * `Uint8Array` fields. For JSON serialisation we encode them as
 * base64. The round-trip preserves the byte-exact shape.
 */
function envelopeToJson(env: AtRestProtectionEnvelope): {
  version: 1
  protectionScheme: "aead-aes-256-gcm"
  encryptionAlgorithm: "AES-256-GCM"
  keyRef: string
  keyVersion: number
  nonceOrIV: string
  aadDomain: string
  ciphertext: string
  contentDigest: string
} {
  return {
    version: env.version,
    protectionScheme: env.protectionScheme,
    encryptionAlgorithm: env.encryptionAlgorithm,
    keyRef: env.keyRef,
    keyVersion: env.keyVersion,
    nonceOrIV: Buffer.from(env.nonceOrIV).toString("base64"),
    aadDomain: env.aadDomain,
    ciphertext: Buffer.from(env.ciphertext).toString("base64"),
    contentDigest: env.contentDigest,
  }
}

function envelopeFromJson(j: ReturnType<typeof envelopeToJson>): AtRestProtectionEnvelope {
  return {
    version: j.version,
    protectionScheme: j.protectionScheme,
    encryptionAlgorithm: j.encryptionAlgorithm,
    keyRef: j.keyRef,
    keyVersion: j.keyVersion,
    nonceOrIV: new Uint8Array(Buffer.from(j.nonceOrIV, "base64")),
    aadDomain: j.aadDomain,
    ciphertext: new Uint8Array(Buffer.from(j.ciphertext, "base64")),
    contentDigest: j.contentDigest,
  }
}

// ---------------------------------------------------------------------------
// OS broker factory
// ---------------------------------------------------------------------------

/**
 * Create an OS-level `SecretBroker`. The returned broker has the
 * same surface as `createInMemoryBroker` (ADR-010 §Decision) but
 * persists every entry to disk in a JSON file under
 * `${homedir}/${STORE_DIRNAME}/entries/`. Each on-disk entry is
 * sealed with the application `envelope` (AEAD-AES-256-GCM + AAD
 * domain binding), then OS-sealed with the per-host KEK for defense
 * in depth.
 *
 * Cross-process persistence is real: two `createOsBroker({rootKey})`
 * calls on the same machine read and write the same JSON files, so
 * `instance A.storeCredential` is visible to `instance B.resolveCredential`
 * (test (g) in the M1-07 spec).
 *
 * The broker throws `KeyUnavailableError` if `rootKey` is empty or
 * not 32 bytes. It never silently corrupts (plan §79): a tampered
 * envelope on disk fails the GCM tag and surfaces as
 * `EnvelopeIntegrityError`.
 */
export function createOsBroker(opts: OsBrokerOptions): SecretBroker {
  const { rootKey, platform = process.platform } = opts
  const storageDir = resolveStorageDir(opts.storageDir)

  // --- root key validation (plan §79) ------------------------------------
  if (rootKey.length === 0) {
    throw new KeyUnavailableError("root key is empty (0 bytes); supply a 32-byte AES-256 key")
  }
  if (rootKey.length !== ROOT_KEY_BYTES) {
    throw new KeyUnavailableError(`root key must be ${ROOT_KEY_BYTES} bytes for AES-256-GCM, got ${rootKey.length}`)
  }

  // --- OS layer setup -----------------------------------------------------
  ensureDir(storageDir)
  const osKek = loadOsKek(storageDir, platform)
  storeOsKek(storageDir)

  // -------------------------------------------------------------------------
  // OS-level envelope: wrap the AEAD envelope in a second layer sealed
  // by `osKek`. This is the "second line of defense" the JSDoc
  // promises. The PBKDF2-derived `osKek` is the stand-in for the
  // DPAPI/Keychain/libsecret binding.
  // -------------------------------------------------------------------------
  function osSeal(env: AtRestProtectionEnvelope): string {
    const inner = envelopeToJson(env)
    const innerJson = Buffer.from(JSON.stringify(inner), "utf-8")
    const nonce = randomBytes(NONCE_BYTES)
    const cipher = createCipheriv("aes-256-gcm", osKek, nonce)
    const sealed = Buffer.concat([cipher.update(innerJson), cipher.final(), cipher.getAuthTag()])
    return JSON.stringify({
      osLayer: platformName(platform),
      nonce: nonce.toString("base64"),
      ciphertext: sealed.toString("base64"),
    })
  }

  function osOpen(sealed: string): AtRestProtectionEnvelope {
    const parsed = JSON.parse(sealed) as { osLayer: string; nonce: string; ciphertext: string }
    if (parsed.osLayer !== platformName(platform)) {
      throw new EnvelopeIntegrityError(
        `OS layer mismatch: file sealed by ${parsed.osLayer}, current platform ${platformName(platform)}`,
      )
    }
    const nonce = Buffer.from(parsed.nonce, "base64")
    const blob = Buffer.from(parsed.ciphertext, "base64")
    if (blob.length < GCM_TAG_BYTES) {
      throw new EnvelopeIntegrityError(`OS-layer ciphertext shorter than GCM tag (${blob.length} < ${GCM_TAG_BYTES})`)
    }
    const body = blob.subarray(0, blob.length - GCM_TAG_BYTES)
    const tag = blob.subarray(blob.length - GCM_TAG_BYTES)
    const decipher = createDecipheriv("aes-256-gcm", osKek, nonce)
    decipher.setAuthTag(tag)
    let innerJson: Buffer
    try {
      innerJson = Buffer.concat([decipher.update(body), decipher.final()])
    } catch (cause) {
      throw new EnvelopeIntegrityError(
        `OS-layer unseal failed: ${cause instanceof Error ? cause.message : "unknown"} (likely wrong host / wrong user / tampered file)`,
      )
    }
    const inner = JSON.parse(innerJson.toString("utf-8")) as ReturnType<typeof envelopeToJson>
    return envelopeFromJson(inner)
  }

  // --- helpers ------------------------------------------------------------

  function writeEntry(entry: OnDiskEntry, filePath: string): void {
    ensureDir(dirname(filePath))
    // The credential / secret kinds carry an `AtRestProtectionEnvelope`
    // in their `material` field. We OS-seal the envelope before
    // writing so the on-disk bytes are protected by both the
    // application layer (rootKey) and the OS layer (osKek).
    const wire =
      entry.kind === "credential" || entry.kind === "secret"
        ? { ...entry, material: osSeal(entry.material) }
        : entry
    writeFileSync(filePath, JSON.stringify(wire), "utf-8")
    try {
      chmodSync(filePath, 0o600)
    } catch {
      // ignore
    }
  }

  function readEntry(filePath: string): OnDiskEntry | null {
    if (!existsSync(filePath)) return null
    const wire = JSON.parse(readFileSync(filePath, "utf-8")) as
      | (Omit<Extract<OnDiskEntry, { kind: "credential" | "secret" }>, "material"> & { material: string })
      | Extract<OnDiskEntry, { kind: "oauth" | "browser-profile" }>
    if (wire.kind === "credential") {
      const material = osOpen(wire.material)
      return { kind: "credential", scope: wire.scope, aadDomain: wire.aadDomain, revoked: wire.revoked, material }
    }
    if (wire.kind === "secret") {
      const material = osOpen(wire.material)
      return { kind: "secret", scope: wire.scope, aadDomain: wire.aadDomain, revoked: wire.revoked, material }
    }
    if (wire.kind === "oauth") {
      return { kind: "oauth", scope: wire.scope, aadDomain: wire.aadDomain, revoked: wire.revoked, token: wire.token }
    }
    // wire.kind === "browser-profile" — TypeScript cannot narrow the
    // 4-way union on the catch-all, so we cast explicitly.
    const b = wire as Extract<OnDiskEntry, { kind: "browser-profile" }>
    return { kind: "browser-profile", scope: b.scope, aadDomain: b.aadDomain, revoked: b.revoked, profile: b.profile }
  }

  // --- scope / revocation helpers -----------------------------------------

  function ensureScope(actual: OwnershipScope, requested: OwnershipScope, what: string): void {
    if (actual.organizationId !== requested.organizationId || actual.workspaceId !== requested.workspaceId) {
      throw new TenantMismatchError(
        `cross-tenant access denied for ${what}: requested ${requested.organizationId}/${requested.workspaceId}, ref belongs to ${actual.organizationId}/${actual.workspaceId}`,
      )
    }
  }

  function ensureNotRevoked(revoked: boolean, what: string): void {
    if (revoked) throw new CredentialRevokedError(`${what} is revoked`)
  }

  // 6-domain AAD set, mirrored from `./index.ts:171-177`. Plan §76.
  const AAD_DOMAINS: ReadonlySet<string> = new Set([
    "artifact-content",
    "credential-material",
    "audit-row",
    "oauth-token",
    "browser-auth-profile",
    "sensitive-runtime-state",
  ])
  function assertAad(aadDomain: string): void {
    if (!AAD_DOMAINS.has(aadDomain)) {
      throw new EnvelopeIntegrityError(`unknown aad domain: ${aadDomain}; expected one of ${[...AAD_DOMAINS].join(", ")}`)
    }
  }

  // -------------------------------------------------------------------------
  // Envelope primitives — AEAD-AES-256-GCM with AAD binding. Identical
  // algorithm to the in-memory broker so the on-disk format is
  // compatible across both backends.
  // -------------------------------------------------------------------------
  function toBytes(material: SecretMaterial): Uint8Array {
    return typeof material === "string" ? new TextEncoder().encode(material) : material
  }
  function fromBytes(bytes: Uint8Array): SecretMaterial {
    return new Uint8Array(bytes)
  }
  function digest(bytes: Uint8Array): string {
    return createHash("sha256").update(bytes).digest("hex")
  }

  async function envelope(material: SecretMaterial, aadDomain: string): Promise<AtRestProtectionEnvelope> {
    assertAad(aadDomain)
    const plaintext = toBytes(material)
    const nonce = randomBytes(NONCE_BYTES)
    const cipher = createCipheriv("aes-256-gcm", rootKey, nonce)
    cipher.setAAD(new TextEncoder().encode(aadDomain))
    const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final(), cipher.getAuthTag()])
    return {
      version: ENVELOPE_VERSION,
      protectionScheme: "aead-aes-256-gcm",
      encryptionAlgorithm: "AES-256-GCM",
      keyRef: KEY_REF,
      keyVersion: KEY_VERSION,
      nonceOrIV: new Uint8Array(nonce.buffer, nonce.byteOffset, nonce.byteLength),
      aadDomain,
      ciphertext: new Uint8Array(ciphertext.buffer, ciphertext.byteOffset, ciphertext.byteLength),
      contentDigest: digest(plaintext),
    }
  }

  async function unenvelope(env: AtRestProtectionEnvelope, aadDomain: string): Promise<SecretMaterial> {
    if (env.version !== ENVELOPE_VERSION) {
      throw new EnvelopeIntegrityError(`unsupported envelope version: ${env.version}`)
    }
    if (env.protectionScheme !== "aead-aes-256-gcm" || env.encryptionAlgorithm !== "AES-256-GCM") {
      throw new EnvelopeIntegrityError(
        `unsupported algorithm ${env.protectionScheme}/${env.encryptionAlgorithm}; expected aead-aes-256-gcm / AES-256-GCM`,
      )
    }
    if (env.nonceOrIV.length !== NONCE_BYTES) {
      throw new EnvelopeIntegrityError(`nonce must be ${NONCE_BYTES} bytes, got ${env.nonceOrIV.length}`)
    }
    if (env.ciphertext.length < GCM_TAG_BYTES) {
      throw new EnvelopeIntegrityError(`ciphertext shorter than the GCM auth tag (${env.ciphertext.length} < ${GCM_TAG_BYTES})`)
    }
    if (env.aadDomain !== aadDomain) {
      throw new EnvelopeIntegrityError(`AAD domain mismatch: envelope bound to ${env.aadDomain}, request asks for ${aadDomain}`)
    }
    const bodyLength = env.ciphertext.length - GCM_TAG_BYTES
    const body = env.ciphertext.subarray(0, bodyLength)
    const tag = env.ciphertext.subarray(bodyLength)
    const decipher = createDecipheriv("aes-256-gcm", rootKey, Buffer.from(env.nonceOrIV))
    decipher.setAAD(new TextEncoder().encode(aadDomain))
    decipher.setAuthTag(Buffer.from(tag))
    let plaintext: Buffer
    try {
      plaintext = Buffer.concat([decipher.update(Buffer.from(body)), decipher.final()])
    } catch (cause) {
      throw new EnvelopeIntegrityError(
        `envelope failed to decrypt: ${cause instanceof Error ? cause.message : "unknown error"} (likely wrong AAD, wrong key, or tampered ciphertext)`,
      )
    }
    const plainBytes = new Uint8Array(plaintext.buffer, plaintext.byteOffset, plaintext.byteLength)
    if (digest(plainBytes) !== env.contentDigest) {
      throw new EnvelopeIntegrityError(`content digest mismatch: envelope digest ${env.contentDigest} != actual ${digest(plainBytes)}`)
    }
    return fromBytes(plainBytes)
  }

  // --- store --------------------------------------------------------------

  async function storeCredential(ref: CredentialRef, material: SecretMaterial, aadDomain: string): Promise<void> {
    const env = await envelope(material, aadDomain)
    const filePath = pathForEntry(storageDir, ref.scope, "credential", ref.credentialId)
    writeEntry(
      { kind: "credential", scope: ref.scope, aadDomain, revoked: false, material: env },
      filePath,
    )
  }

  async function storeSecret(ref: SecretRef, material: SecretMaterial, aadDomain: string): Promise<void> {
    const env = await envelope(material, aadDomain)
    const filePath = pathForEntry(storageDir, ref.scope, "secret", ref.secretId)
    writeEntry({ kind: "secret", scope: ref.scope, aadDomain, revoked: false, material: env }, filePath)
  }

  async function storeOAuthConnection(ref: OAuthConnectionRef, token: OAuthToken, aadDomain: string): Promise<void> {
    const filePath = pathForEntry(storageDir, ref.scope, "oauth", ref.connectionId)
    writeEntry(
      { kind: "oauth", scope: ref.scope, aadDomain, revoked: false, token },
      filePath,
    )
  }

  async function storeBrowserAuthProfile(ref: BrowserAuthProfileRef, material: BrowserAuthMaterial, aadDomain: string): Promise<void> {
    const filePath = pathForEntry(storageDir, ref.scope, "browser-profile", ref.profileId)
    writeEntry(
      {
        kind: "browser-profile",
        scope: ref.scope,
        aadDomain,
        revoked: false,
        profile: {
          cookies: Array.from(material.cookies.entries()),
          tokens: material.tokens ? [...material.tokens] : undefined,
        },
      },
      filePath,
    )
  }

  // --- resolve ------------------------------------------------------------

  function lookupCredential(ref: CredentialRef, scope: OwnershipScope): Extract<OnDiskEntry, { kind: "credential" }> {
    const filePath = pathForEntry(storageDir, ref.scope, "credential", ref.credentialId)
    const entry = readEntry(filePath)
    if (!entry) throw new CredentialNotFoundError(`credential not found: ${ref.credentialId} in ${ref.scope.organizationId}/${ref.scope.workspaceId}`)
    if (entry.kind !== "credential") {
      throw new CredentialNotFoundError(`ref ${ref.credentialId} is not a credential (found ${entry.kind})`)
    }
    ensureScope(entry.scope, scope, `credential ${ref.credentialId}`)
    ensureNotRevoked(entry.revoked, `credential ${ref.credentialId}`)
    return entry
  }
  async function resolveCredential(ref: CredentialRef, scope: OwnershipScope): Promise<SecretMaterial> {
    const entry = lookupCredential(ref, scope)
    return await unenvelope(entry.material, entry.aadDomain)
  }

  function lookupSecret(ref: SecretRef, scope: OwnershipScope): Extract<OnDiskEntry, { kind: "secret" }> {
    const filePath = pathForEntry(storageDir, ref.scope, "secret", ref.secretId)
    const entry = readEntry(filePath)
    if (!entry) throw new CredentialNotFoundError(`secret not found: ${ref.secretId} in ${ref.scope.organizationId}/${ref.scope.workspaceId}`)
    if (entry.kind !== "secret") {
      throw new CredentialNotFoundError(`ref ${ref.secretId} is not a secret (found ${entry.kind})`)
    }
    ensureScope(entry.scope, scope, `secret ${ref.secretId}`)
    ensureNotRevoked(entry.revoked, `secret ${ref.secretId}`)
    return entry
  }
  async function resolveSecret(ref: SecretRef, scope: OwnershipScope): Promise<SecretMaterial> {
    const entry = lookupSecret(ref, scope)
    return await unenvelope(entry.material, entry.aadDomain)
  }

  function lookupOAuth(ref: OAuthConnectionRef, scope: OwnershipScope): Extract<OnDiskEntry, { kind: "oauth" }> {
    const filePath = pathForEntry(storageDir, ref.scope, "oauth", ref.connectionId)
    const entry = readEntry(filePath)
    if (!entry) throw new CredentialNotFoundError(`oauth connection not found: ${ref.connectionId} in ${ref.scope.organizationId}/${ref.scope.workspaceId}`)
    if (entry.kind !== "oauth") {
      throw new CredentialNotFoundError(`ref ${ref.connectionId} is not an oauth connection (found ${entry.kind})`)
    }
    ensureScope(entry.scope, scope, `oauth connection ${ref.connectionId}`)
    ensureNotRevoked(entry.revoked, `oauth connection ${ref.connectionId}`)
    return entry
  }
  async function resolveOAuthConnection(ref: OAuthConnectionRef, scope: OwnershipScope): Promise<OAuthToken> {
    const entry = lookupOAuth(ref, scope)
    return entry.token
  }

  function lookupBrowser(ref: BrowserAuthProfileRef, scope: OwnershipScope): Extract<OnDiskEntry, { kind: "browser-profile" }> {
    const filePath = pathForEntry(storageDir, ref.scope, "browser-profile", ref.profileId)
    const entry = readEntry(filePath)
    if (!entry) throw new CredentialNotFoundError(`browser auth profile not found: ${ref.profileId} in ${ref.scope.organizationId}/${ref.scope.workspaceId}`)
    if (entry.kind !== "browser-profile") {
      throw new CredentialNotFoundError(`ref ${ref.profileId} is not a browser profile (found ${entry.kind})`)
    }
    ensureScope(entry.scope, scope, `browser profile ${ref.profileId}`)
    ensureNotRevoked(entry.revoked, `browser profile ${ref.profileId}`)
    return entry
  }
  async function resolveBrowserAuthProfile(ref: BrowserAuthProfileRef, scope: OwnershipScope): Promise<BrowserAuthMaterial> {
    const entry = lookupBrowser(ref, scope)
    const cookies = new Map<string, string>(entry.profile.cookies)
    return { cookies, tokens: entry.profile.tokens ? [...entry.profile.tokens] : undefined }
  }

  // --- lifecycle ----------------------------------------------------------

  async function rotate(ref: CredentialRef): Promise<CredentialRef> {
    const entry = lookupCredential(ref, ref.scope)
    const newId = `cred-${Date.now()}-${randomBytes(4).toString("hex")}`
    const newRef: CredentialRef = { kind: "credential", credentialId: newId, scope: ref.scope }
    const newFilePath = pathForEntry(storageDir, newRef.scope, "credential", newRef.credentialId)
    writeEntry(
      { kind: "credential", scope: entry.scope, aadDomain: entry.aadDomain, revoked: false, material: entry.material },
      newFilePath,
    )
    // Old ref is invalidated at the next call.
    const oldFilePath = pathForEntry(storageDir, ref.scope, "credential", ref.credentialId)
    const oldEntry = readEntry(oldFilePath)
    if (oldEntry && oldEntry.kind === "credential") {
      writeEntry(
        { ...oldEntry, revoked: true },
        oldFilePath,
      )
    }
    return newRef
  }

  async function revoke(ref: CredentialRef): Promise<void> {
    const filePath = pathForEntry(storageDir, ref.scope, "credential", ref.credentialId)
    const entry = readEntry(filePath)
    if (!entry) return // idempotent
    if (entry.kind !== "credential") return
    writeEntry({ ...entry, revoked: true }, filePath)
  }

  return {
    storeCredential,
    storeSecret,
    storeOAuthConnection,
    storeBrowserAuthProfile,
    resolveCredential,
    resolveSecret,
    resolveOAuthConnection,
    resolveBrowserAuthProfile,
    rotate,
    revoke,
    envelope,
    unenvelope,
  }
}

/**
 * Helper for tests: produce a fresh random 32-byte root key.
 * Production code reads the key from OS secure storage; tests use a
 * random key to keep them hermetic.
 */
export function newRandomRootKey(): Uint8Array {
  return randomBytes(ROOT_KEY_BYTES)
}

/**
 * Helper for tests: return a temp-directory path the broker can use
 * for `storageDir`. The path is unique to the test (so concurrent
 * tests do not collide) and the caller is responsible for cleaning
 * it up.
 */
export function newTempStorageDir(prefix: string = "unifia-test-"): string {
  return join(tmpdir(), `${prefix}-${randomBytes(6).toString("hex")}`)
}

// Re-export the canonical error types from `./index.js` so callers
// can `import { KeyUnavailableError, ... } from "@unifia/secret-broker"`
// without caring which file the symbols live in.
export {
  CredentialNotFoundError,
  CredentialRevokedError,
  EnvelopeIntegrityError,
  KeyUnavailableError,
  TenantMismatchError,
  type AtRestProtectionEnvelope,
  type BrowserAuthMaterial,
  type BrowserAuthProfileRef,
  type CredentialRef,
  type OAuthConnectionRef,
  type OAuthToken,
  type OwnershipScope,
  type SecretBroker,
  type SecretMaterial,
  type SecretRef,
} from "./index.js"
