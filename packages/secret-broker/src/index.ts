/* SPDX-License-Identifier: MIT */
// Copyright (c) 2026 Unifia contributors
//
// Secret Broker — ADR-010.
// Reference resolution + key management + backup/restore per plan §72-80.
// Domain separation per plan §76 (5 domains): artifact-content,
// credential-material, oauth-token, browser-auth-profile,
// sensitive-runtime-state.
// AtRestProtectionEnvelope per plan §74.
//
// SCAFFOLD: this is evidence code for ADR-010 DECIDED, not a kernel
// modification. The production broker will use OS secure storage
// (DPAPI on Windows, Keychain on macOS, libsecret on Linux,
// Android Keystore on mobile) for the root key, plus a real
// KEK/DEK hierarchy derived via HKDF (plan §72-80). For the
// scaffold, the root key is held in process memory and storage is a
// Map — a process crash erases everything. That is acceptable here
// because the goal is to prove the surface area, not the durability.
//
// The typed refs (`CredentialRef`, `SecretRef`, `OAuthConnectionRef`,
// `BrowserAuthProfileRef`, `OwnershipScope`, `AtRestProtectionEnvelope`)
// are defined locally for now. ADR-010 §Consequences says they will
// live in `@unifia/contracts/src/secrets.ts`; that is out of scope
// for this scaffold. `@unifia/contracts` is declared as a
// workspace dependency so the migration is a one-line import swap.

import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto"

// ---------------------------------------------------------------------------
// OS-level broker (C-M1-07, ADR-010, plan §3.7 + §5.6).
//
// `createOsBroker` lives in `./os-broker.js`. It implements the same
// `SecretBroker` surface as the in-memory broker below, with two
// differences: (1) entries are persisted to disk in
// `${homedir()}/.unifia/secret-broker/entries/…` (or the
// `storageDir` override), and (2) the on-disk bytes are protected by
// two layers of AEAD-AES-256-GCM — the application layer is sealed
// with the root key, the OS layer is sealed with a per-host KEK
// derived from `${homedir()}:${hostname()}` (PBKDF2 fallback on all
// 3 platforms; DPAPI / Keychain / libsecret in production). The
// re-export is additive: the 23 in-memory tests are unchanged.
// ---------------------------------------------------------------------------

export { createOsBroker, newRandomRootKey, newTempStorageDir } from "./os-broker.js"

// ---------------------------------------------------------------------------
// Reference & envelope types — see ADR-010 §123, §74.
// ---------------------------------------------------------------------------

/**
 * Tenancy context a ref is bound to. A `CredentialRef` created in
 * `org-A/ws-1` is unreadable from `org-B/ws-2` even if the credential
 * id is guessed (REQ-14, ADR-020).
 */
export type OwnershipScope = { organizationId: string; workspaceId: string }

export type CredentialRef = { kind: "credential"; credentialId: string; scope: OwnershipScope }
export type SecretRef = { kind: "secret"; secretId: string; scope: OwnershipScope }
export type OAuthConnectionRef = { kind: "oauth"; connectionId: string; scope: OwnershipScope }
export type BrowserAuthProfileRef = { kind: "browser-profile"; profileId: string; scope: OwnershipScope }

/** Plaintext material the broker is asked to protect. Bytes for binary
 *  secrets, strings for human-readable ones (API keys, tokens). */
export type SecretMaterial = string | Uint8Array

/** A bound OAuth token set as returned by the IdP. */
export type OAuthToken = {
  accessToken: string
  refreshToken?: string
  expiresAt: number
  scopes: readonly string[]
}

/** Browser auth profile: cookie jar plus optional bearer tokens. The
 *  Map is rebuilt on read because `Map` is not JSON-serialisable. */
export type BrowserAuthMaterial = {
  cookies: ReadonlyMap<string, string>
  tokens?: readonly string[]
}

/**
 * At-rest envelope per ADR-010 §74 / plan §74.
 *
 *   version, protectionScheme, encryptionAlgorithm, keyRef, keyVersion,
 *   nonceOrIV, aadDomain
 *
 * Two fields extend the ADR schema for this scaffold:
 *  - `ciphertext` is the AEAD output (GCM ciphertext || authTag).
 *  - `contentDigest` is a SHA-256 of the plaintext, computed alongside
 *    the AEAD seal. AEAD already authenticates the plaintext, so this
 *    digest is an extra integrity hook used by the backup/restore
 *    test (plan §80) to detect silent corruption. Production replaces
 *    it with a HKDF-derived tag.
 */
export type AtRestProtectionEnvelope = {
  version: 1
  protectionScheme: "aead-aes-256-gcm"
  encryptionAlgorithm: "AES-256-GCM"
  keyRef: string
  keyVersion: number
  nonceOrIV: Uint8Array
  aadDomain: string
  ciphertext: Uint8Array
  contentDigest: string
}

// ---------------------------------------------------------------------------
// Error types. KEYS_UNAVAILABLE is the ADR-010 sentinel (plan §79):
//   "un key indisponible retourne KEY_UNAVAILABLE (pas de corruption
//    silencieuse)"
// Every other error type is named so a caller can branch on it without
// string-matching.
// ---------------------------------------------------------------------------

export class KeyUnavailableError extends Error {
  constructor(reason: string) {
    super(`KEY_UNAVAILABLE: ${reason}`)
    this.name = "KeyUnavailableError"
  }
}

export class TenantMismatchError extends Error {
  constructor(reason: string) {
    super(reason)
    this.name = "TenantMismatchError"
  }
}

export class CredentialNotFoundError extends Error {
  constructor(reason: string) {
    super(reason)
    this.name = "CredentialNotFoundError"
  }
}

export class CredentialRevokedError extends Error {
  constructor(reason: string) {
    super(reason)
    this.name = "CredentialRevokedError"
  }
}

export class EnvelopeIntegrityError extends Error {
  constructor(reason: string) {
    super(reason)
    this.name = "EnvelopeIntegrityError"
  }
}

// ---------------------------------------------------------------------------
// Public broker interface. Exactly the surface required by ADR-010
// §Decision + the storage/retrieve pair that makes the broker usable.
// ---------------------------------------------------------------------------

export interface SecretBroker {
  // --- Storage: the broker is the sole owner of secret material. ---
  storeCredential(ref: CredentialRef, material: SecretMaterial, aadDomain: string): Promise<void>
  storeSecret(ref: SecretRef, material: SecretMaterial, aadDomain: string): Promise<void>
  storeOAuthConnection(ref: OAuthConnectionRef, token: OAuthToken, aadDomain: string): Promise<void>
  storeBrowserAuthProfile(ref: BrowserAuthProfileRef, material: BrowserAuthMaterial, aadDomain: string): Promise<void>

  // --- Resolution. All four throw if scope mismatches, ref missing,
  //     ref revoked, or the root key is unavailable. ---
  resolveCredential(ref: CredentialRef, scope: OwnershipScope): Promise<SecretMaterial>
  resolveSecret(ref: SecretRef, scope: OwnershipScope): Promise<SecretMaterial>
  resolveOAuthConnection(ref: OAuthConnectionRef, scope: OwnershipScope): Promise<OAuthToken>
  resolveBrowserAuthProfile(ref: BrowserAuthProfileRef, scope: OwnershipScope): Promise<BrowserAuthMaterial>

  // --- Lifecycle. `rotate` returns a new ref; the old ref is
  //     invalidated at the next call (grace period not implemented
  //     in the scaffold — production tracks a per-credential TTL). ---
  rotate(ref: CredentialRef): Promise<CredentialRef>
  revoke(ref: CredentialRef): Promise<void>

  // --- Envelope. `envelope`/`unenvelope` are the at-rest primitives
  //     used by artifact storage (ADR-005), the audit pipeline, and
  //     the backup/restore path (plan §80). The AAD binds the
  //     ciphertext to one of the 5 domains (plan §76). ---
  envelope(material: SecretMaterial, aadDomain: string): Promise<AtRestProtectionEnvelope>
  unenvelope(envelope: AtRestProtectionEnvelope, aadDomain: string): Promise<SecretMaterial>
}

// ---------------------------------------------------------------------------
// Domain set per plan §76. Stored in code so a caller that typos a
// domain ("oauth-token " with a trailing space) is caught early.
// ---------------------------------------------------------------------------

const AAD_DOMAINS: ReadonlySet<string> = new Set([
  "artifact-content",
  "credential-material",
  "oauth-token",
  "browser-auth-profile",
  "sensitive-runtime-state",
])

function assertAad(aadDomain: string): void {
  if (!AAD_DOMAINS.has(aadDomain)) {
    throw new EnvelopeIntegrityError(`unknown aad domain: ${aadDomain}; expected one of ${[...AAD_DOMAINS].join(", ")}`)
  }
}

// AES-256-GCM wants a 12-byte nonce. 32-byte root key. The 16-byte
// GCM auth tag is appended to the ciphertext by the Node API.
const NONCE_BYTES = 12
const ROOT_KEY_BYTES = 32
const GCM_TAG_BYTES = 16
const KEY_REF = "root-key"
const KEY_VERSION = 1
const ENVELOPE_VERSION = 1 as const

function toBytes(material: SecretMaterial): Uint8Array {
  return typeof material === "string" ? new TextEncoder().encode(material) : material
}

function fromBytes(bytes: Uint8Array): SecretMaterial {
  // The broker normalises everything to bytes. A `SecretMaterial`
  // value is `string | Uint8Array`; the string form is input
  // convenience only. Returning a fresh `Uint8Array` (a
  // `SecretMaterial`) is consistent: the caller decodes if they
  // stored a string, and the returned buffer is always safe to
  // mutate without poisoning broker state.
  return new Uint8Array(bytes)
}

function digest(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex")
}

// ---------------------------------------------------------------------------
// In-memory broker. Internal types are private; only the SecretBroker
// surface is exported.
// ---------------------------------------------------------------------------

type CredentialKind = "credential" | "secret" | "oauth" | "browser-profile"

type CredentialEntry = { kind: "credential"; material: Uint8Array; scope: OwnershipScope; aadDomain: string; revoked: boolean }
type SecretEntry = { kind: "secret"; material: Uint8Array; scope: OwnershipScope; aadDomain: string; revoked: boolean }
type OAuthEntry = { kind: "oauth"; token: OAuthToken; scope: OwnershipScope; aadDomain: string; revoked: boolean }
type BrowserEntry = { kind: "browser-profile"; material: BrowserAuthMaterial; scope: OwnershipScope; aadDomain: string; revoked: boolean }

type Entry = CredentialEntry | SecretEntry | OAuthEntry | BrowserEntry

function refKey(kind: CredentialKind, scope: OwnershipScope, id: string): string {
  return `${kind}:${scope.organizationId}/${scope.workspaceId}:${id}`
}

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

/**
 * Scaffold broker. Holds the root key in process memory and stores
 * material in a Map. A process crash erases everything; that is
 * acceptable for ADR-010 evidence code and matches the task scope
 * (plan §193).
 *
 * The root key MUST be exactly 32 bytes (AES-256). An empty key —
 * including `new Uint8Array(0)` — is rejected up front with
 * `KeyUnavailableError` so a caller that forgot to pass a key fails
 * fast instead of producing a broken broker.
 */
export function createInMemoryBroker(rootKey: Uint8Array): SecretBroker {
  if (rootKey.length === 0) {
    throw new KeyUnavailableError("root key is empty (0 bytes); supply a 32-byte AES-256 key")
  }
  if (rootKey.length !== ROOT_KEY_BYTES) {
    throw new KeyUnavailableError(`root key must be ${ROOT_KEY_BYTES} bytes for AES-256-GCM, got ${rootKey.length}`)
  }

  const store = new Map<string, Entry>()

  // --- envelope / unenvelope -------------------------------------------------

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
    assertAad(aadDomain)
    if (env.aadDomain !== aadDomain) {
      throw new EnvelopeIntegrityError(`AAD domain mismatch: envelope bound to ${env.aadDomain}, request asks for ${aadDomain}`)
    }
    // GCM tag is the last 16 bytes; the rest is the ciphertext.
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
      // Belt-and-braces: AEAD already authenticated the plaintext,
      // but plan §80 requires an independent integrity hook for
      // the backup/restore path.
      throw new EnvelopeIntegrityError(`content digest mismatch: envelope digest ${env.contentDigest} != actual ${digest(plainBytes)}`)
    }
    return fromBytes(plainBytes)
  }

  // --- store ----------------------------------------------------------------

  async function storeCredential(ref: CredentialRef, material: SecretMaterial, aadDomain: string): Promise<void> {
    assertAad(aadDomain)
    store.set(refKey("credential", ref.scope, ref.credentialId), {
      kind: "credential",
      material: toBytes(material),
      scope: ref.scope,
      aadDomain,
      revoked: false,
    })
  }

  async function storeSecret(ref: SecretRef, material: SecretMaterial, aadDomain: string): Promise<void> {
    assertAad(aadDomain)
    store.set(refKey("secret", ref.scope, ref.secretId), {
      kind: "secret",
      material: toBytes(material),
      scope: ref.scope,
      aadDomain,
      revoked: false,
    })
  }

  async function storeOAuthConnection(ref: OAuthConnectionRef, token: OAuthToken, aadDomain: string): Promise<void> {
    assertAad(aadDomain)
    // Stash the typed token; resolve* JSON-encodes/decodes via the
    // envelope. The broker's plaintext storage in this scaffold
    // is in-memory only; production seals it via the OS keyring.
    store.set(refKey("oauth", ref.scope, ref.connectionId), {
      kind: "oauth",
      token,
      scope: ref.scope,
      aadDomain,
      revoked: false,
    })
  }

  async function storeBrowserAuthProfile(ref: BrowserAuthProfileRef, material: BrowserAuthMaterial, aadDomain: string): Promise<void> {
    assertAad(aadDomain)
    store.set(refKey("browser-profile", ref.scope, ref.profileId), {
      kind: "browser-profile",
      material,
      scope: ref.scope,
      aadDomain,
      revoked: false,
    })
  }

  // --- resolve --------------------------------------------------------------

  function lookupCredential(ref: CredentialRef, scope: OwnershipScope): CredentialEntry {
    const key = refKey("credential", ref.scope, ref.credentialId)
    const entry = store.get(key)
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
    return fromBytes(entry.material)
  }

  function lookupSecret(ref: SecretRef, scope: OwnershipScope): SecretEntry {
    const key = refKey("secret", ref.scope, ref.secretId)
    const entry = store.get(key)
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
    return fromBytes(entry.material)
  }

  function lookupOAuth(ref: OAuthConnectionRef, scope: OwnershipScope): OAuthEntry {
    const key = refKey("oauth", ref.scope, ref.connectionId)
    const entry = store.get(key)
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

  function lookupBrowser(ref: BrowserAuthProfileRef, scope: OwnershipScope): BrowserEntry {
    const key = refKey("browser-profile", ref.scope, ref.profileId)
    const entry = store.get(key)
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
    // Reconstruct a fresh Map so the caller cannot mutate broker state.
    const cookies = new Map<string, string>()
    for (const [name, value] of entry.material.cookies) cookies.set(name, value)
    return { cookies, tokens: entry.material.tokens ? [...entry.material.tokens] : undefined }
  }

  // --- lifecycle ------------------------------------------------------------

  async function rotate(ref: CredentialRef): Promise<CredentialRef> {
    const entry = lookupCredential(ref, ref.scope)
    // Reuse the existing material under a new ref id. Production
    // rotates the underlying secret (new key); the scaffold just
    // generates a new ref id and preserves the material until the
    // caller overwrites it.
    const newId = `cred-${Date.now()}-${randomBytes(4).toString("hex")}`
    const newRef: CredentialRef = { kind: "credential", credentialId: newId, scope: ref.scope }
    store.set(refKey("credential", newRef.scope, newRef.credentialId), {
      kind: "credential",
      material: entry.material,
      scope: entry.scope,
      aadDomain: entry.aadDomain,
      revoked: false,
    })
    // Old ref is invalidated at the next call. A grace period
    // (configurable, default 24h) belongs in the production broker.
    entry.revoked = true
    return newRef
  }

  async function revoke(ref: CredentialRef): Promise<void> {
    const key = refKey("credential", ref.scope, ref.credentialId)
    const entry = store.get(key)
    if (!entry) return // idempotent
    entry.revoked = true
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
