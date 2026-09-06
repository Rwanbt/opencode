/* SPDX-License-Identifier: MIT */
// Copyright (c) 2026 Unifia contributors
//
// ADR-010 evidence tests for `createOsBroker` (C-M1-07, plan §3.7 + §5.6).
//
// These tests prove the OS broker surface — the same surface as
// `createInMemoryBroker`, but with disk persistence and a second
// layer of AEAD sealing (the "OS layer", simulated by PBKDF2 in the
// spike). Production swaps the PBKDF2 fallback for a real
// DPAPI / Keychain / libsecret binding; the on-disk format and the
// public API do not change.
//
// Each test uses a unique `storageDir` (under `os.tmpdir()`) so the
// test suite does not pollute the user's home and so two tests
// running in parallel do not collide on the same file path.

import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { randomBytes } from "node:crypto"
import { existsSync, rmSync } from "node:fs"

import {
  createOsBroker,
  newRandomRootKey,
  newTempStorageDir,
  type SecretBroker,
} from "../src/os-broker.js"
import {
  CredentialNotFoundError,
  CredentialRevokedError,
  EnvelopeIntegrityError,
  KeyUnavailableError,
  TenantMismatchError,
  type CredentialRef,
  type OwnershipScope,
  type SecretRef,
} from "../src/index.js"

const SCOPE_A: OwnershipScope = { organizationId: "org-A", workspaceId: "ws-1" }
const SCOPE_B: OwnershipScope = { organizationId: "org-B", workspaceId: "ws-2" }

function newKey(): Uint8Array {
  return newRandomRootKey()
}

function credentialRef(scope: OwnershipScope, id: string): CredentialRef {
  return { kind: "credential", credentialId: id, scope }
}

function secretRef(scope: OwnershipScope, id: string): SecretRef {
  return { kind: "secret", secretId: id, scope }
}

function utf8(s: string): Uint8Array {
  return new TextEncoder().encode(s)
}

function cleanup(storageDir: string): void {
  if (existsSync(storageDir)) {
    try {
      rmSync(storageDir, { recursive: true, force: true })
    } catch {
      // best-effort — tmpdir is GC'd by the OS
    }
  }
}

// ---------------------------------------------------------------------------
// Suite-local state: each test gets its own storage dir.
// ---------------------------------------------------------------------------

let storageDir: string
let broker: SecretBroker
const openedDirs: string[] = []

function makeBroker(platform: NodeJS.Platform = process.platform, rootKey?: Uint8Array): SecretBroker {
  const dir = newTempStorageDir("unifia-os-broker-")
  openedDirs.push(dir)
  return createOsBroker({ rootKey: rootKey ?? newKey(), platform, storageDir: dir })
}

beforeEach(() => {
  storageDir = newTempStorageDir("unifia-os-broker-suite-")
  openedDirs.push(storageDir)
  broker = createOsBroker({ rootKey: newKey(), storageDir })
})

afterEach(() => {
  for (const d of openedDirs.splice(0)) cleanup(d)
})

// ---------------------------------------------------------------------------
// (a) factory sanity
// ---------------------------------------------------------------------------

describe("createOsBroker — factory", () => {
  test("(a) returns a valid SecretBroker with a random 32-byte root key", () => {
    const b = makeBroker()
    expect(typeof b.storeCredential).toBe("function")
    expect(typeof b.resolveCredential).toBe("function")
    expect(typeof b.envelope).toBe("function")
    expect(typeof b.unenvelope).toBe("function")
    expect(typeof b.rotate).toBe("function")
    expect(typeof b.revoke).toBe("function")
  })

  test("the platform is recorded on disk (aadDomain trace, OS layer marker)", async () => {
    const dir = newTempStorageDir("unifia-os-broker-trace-")
    openedDirs.push(dir)
    const b = createOsBroker({ rootKey: newKey(), platform: "win32", storageDir: dir })
    const ref = credentialRef(SCOPE_A, "cred-trace")
    await b.storeCredential(ref, "trace-value", "credential-material")
    // The `kek` presence marker must exist.
    const { readFileSync: rfs } = await import("node:fs")
    const { join: j } = await import("node:path")
    expect(existsSync(j(dir, "kek"))).toBe(true)
    expect(existsSync(j(dir, "salt"))).toBe(true)
    // The entry file must exist under entries/. The `osLayer` is
    // recorded inside the OS-sealed `material` string (which is
    // itself a JSON document).
    const entries = rfs(j(dir, "entries", `org-A__ws-1__credential__cred-trace.json`), "utf-8")
    const parsed = JSON.parse(entries) as { material: string }
    const materialJson = JSON.parse(parsed.material) as { osLayer: string }
    expect(materialJson.osLayer).toBe("dpapi")
  })
})

// ---------------------------------------------------------------------------
// (b) + (c) round-trip: string and binary
// ---------------------------------------------------------------------------

describe("createOsBroker — round-trip", () => {
  test("(b) string round-trip: storeCredential → resolveCredential", async () => {
    const ref = credentialRef(SCOPE_A, "cred-1")
    await broker.storeCredential(ref, "super-secret", "credential-material")
    const material = await broker.resolveCredential(ref, SCOPE_A)
    expect(material).toBeInstanceOf(Uint8Array)
    expect(new TextDecoder("utf-8", { fatal: true }).decode(material as Uint8Array)).toBe("super-secret")
  })

  test("(c) binary round-trip: storeSecret → resolveSecret returns defensive copy", async () => {
    const ref = secretRef(SCOPE_A, "sec-1")
    const raw = new Uint8Array([0, 1, 2, 3, 0xff, 0xfe, 0x80])
    await broker.storeSecret(ref, raw, "artifact-content")
    const first = (await broker.resolveSecret(ref, SCOPE_A)) as Uint8Array
    expect(Array.from(first)).toEqual(Array.from(raw))
    // Mutate the returned bytes; the next resolve must not see the change.
    first[0] = 99
    const second = (await broker.resolveSecret(ref, SCOPE_A)) as Uint8Array
    expect(second[0]).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// (d) AAD binding
// ---------------------------------------------------------------------------

describe("createOsBroker — AAD binding (GCM tag)", () => {
  test("(d) envelope bound to one AAD cannot be unenveloped with another", async () => {
    const env = await broker.envelope("secret", "credential-material")
    await expect(broker.unenvelope(env, "oauth-token")).rejects.toBeInstanceOf(EnvelopeIntegrityError)
  })

  test("envelope with an unknown AAD domain throws at the broker boundary", async () => {
    await expect(broker.envelope("secret", "made-up-domain")).rejects.toBeInstanceOf(EnvelopeIntegrityError)
  })
})

// ---------------------------------------------------------------------------
// (e) KEY_UNAVAILABLE
// ---------------------------------------------------------------------------

describe("createOsBroker — KEY_UNAVAILABLE", () => {
  test("(e) empty root key throws KEY_UNAVAILABLE", () => {
    expect(() => createOsBroker({ rootKey: new Uint8Array(0), storageDir })).toThrow(KeyUnavailableError)
    expect(() => createOsBroker({ rootKey: new Uint8Array(0), storageDir })).toThrow(/KEY_UNAVAILABLE/)
  })

  test("a 16-byte root key throws KEY_UNAVAILABLE", () => {
    expect(() => createOsBroker({ rootKey: randomBytes(16), storageDir })).toThrow(KeyUnavailableError)
  })

  test("a 64-byte root key throws KEY_UNAVAILABLE", () => {
    expect(() => createOsBroker({ rootKey: randomBytes(64), storageDir })).toThrow(KeyUnavailableError)
  })
})

// ---------------------------------------------------------------------------
// (f) Tenant isolation
// ---------------------------------------------------------------------------

describe("createOsBroker — multi-tenant isolation", () => {
  test("(f) cross-tenant resolve throws TenantMismatchError", async () => {
    const refA = credentialRef(SCOPE_A, "cred-1")
    await broker.storeCredential(refA, "A's secret", "credential-material")
    await expect(broker.resolveCredential(refA, SCOPE_B)).rejects.toBeInstanceOf(TenantMismatchError)
  })

  test("the same id in two tenants does not collide", async () => {
    await broker.storeCredential(credentialRef(SCOPE_A, "shared"), "A", "credential-material")
    await broker.storeCredential(credentialRef(SCOPE_B, "shared"), "B", "credential-material")
    expect(new TextDecoder("utf-8", { fatal: true }).decode((await broker.resolveCredential(credentialRef(SCOPE_A, "shared"), SCOPE_A)) as Uint8Array)).toBe("A")
    expect(new TextDecoder("utf-8", { fatal: true }).decode((await broker.resolveCredential(credentialRef(SCOPE_B, "shared"), SCOPE_B)) as Uint8Array)).toBe("B")
  })
})

// ---------------------------------------------------------------------------
// (g) Persistence across instances (the OS broker's main value-add)
// ---------------------------------------------------------------------------

describe("createOsBroker — persistence across instances", () => {
  test("(g) instance A writes, instance B reads (same root key, same storage dir)", async () => {
    const sharedDir = newTempStorageDir("unifia-os-broker-shared-")
    openedDirs.push(sharedDir)
    const sharedKey = newKey()
    const a = createOsBroker({ rootKey: sharedKey, storageDir: sharedDir, platform: "linux" })
    const b = createOsBroker({ rootKey: sharedKey, storageDir: sharedDir, platform: "linux" })
    const ref = credentialRef(SCOPE_A, "cred-persisted")
    await a.storeCredential(ref, "shared-secret", "credential-material")
    const fromB = await b.resolveCredential(ref, SCOPE_A)
    expect(new TextDecoder("utf-8", { fatal: true }).decode(fromB as Uint8Array)).toBe("shared-secret")
  })

  test("a different root key on the same storage dir cannot read what instance A wrote (AEAD)", async () => {
    const sharedDir = newTempStorageDir("unifia-os-broker-mixed-")
    openedDirs.push(sharedDir)
    const a = createOsBroker({ rootKey: newKey(), storageDir: sharedDir, platform: "linux" })
    const b = createOsBroker({ rootKey: newKey(), storageDir: sharedDir, platform: "linux" })
    const ref = credentialRef(SCOPE_A, "cred-mixed")
    await a.storeCredential(ref, "A only", "credential-material")
    await expect(b.resolveCredential(ref, SCOPE_A)).rejects.toBeInstanceOf(EnvelopeIntegrityError)
  })
})

// ---------------------------------------------------------------------------
// (h) Revocation
// ---------------------------------------------------------------------------

describe("createOsBroker — revocation", () => {
  test("(h) revoke(ref) → resolveCredential throws CredentialRevokedError", async () => {
    const ref = credentialRef(SCOPE_A, "cred-1")
    await broker.storeCredential(ref, "value", "credential-material")
    await broker.revoke(ref)
    await expect(broker.resolveCredential(ref, SCOPE_A)).rejects.toBeInstanceOf(CredentialRevokedError)
  })

  test("revoke is idempotent (revoking a missing ref is a no-op)", async () => {
    await expect(broker.revoke(credentialRef(SCOPE_A, "ghost"))).resolves.toBeUndefined()
  })

  test("a missing ref throws CredentialNotFoundError on resolve", async () => {
    await expect(broker.resolveCredential(credentialRef(SCOPE_A, "ghost"), SCOPE_A)).rejects.toBeInstanceOf(CredentialNotFoundError)
  })
})

// ---------------------------------------------------------------------------
// (i) Rotation
// ---------------------------------------------------------------------------

describe("createOsBroker — rotation", () => {
  test("(i) rotate returns a new ref, old ref is invalidated", async () => {
    const oldRef = credentialRef(SCOPE_A, "cred-1")
    await broker.storeCredential(oldRef, "value", "credential-material")
    const newRef = await broker.rotate(oldRef)
    expect(newRef.credentialId).not.toBe(oldRef.credentialId)
    expect(newRef.scope).toEqual(oldRef.scope)
    // New ref resolves to the same material.
    expect(new TextDecoder("utf-8", { fatal: true }).decode((await broker.resolveCredential(newRef, SCOPE_A)) as Uint8Array)).toBe("value")
    // Old ref is now revoked.
    await expect(broker.resolveCredential(oldRef, SCOPE_A)).rejects.toBeInstanceOf(CredentialRevokedError)
  })
})

// ---------------------------------------------------------------------------
// Typed material: OAuth + browser profile
// ---------------------------------------------------------------------------

describe("createOsBroker — typed material", () => {
  test("OAuth token round-trips", async () => {
    const ref = { kind: "oauth" as const, connectionId: "gh-1", scope: SCOPE_A }
    await broker.storeOAuthConnection(
      ref,
      { accessToken: "gh-access", refreshToken: "gh-refresh", expiresAt: 1_900_000_000, scopes: ["repo", "read:user"] },
      "oauth-token",
    )
    const token = await broker.resolveOAuthConnection(ref, SCOPE_A)
    expect(token.accessToken).toBe("gh-access")
    expect(token.refreshToken).toBe("gh-refresh")
    expect(token.expiresAt).toBe(1_900_000_000)
    expect(token.scopes).toEqual(["repo", "read:user"])
  })

  test("browser auth profile rebuilds the cookie Map", async () => {
    const ref = { kind: "browser-profile" as const, profileId: "profile-1", scope: SCOPE_A }
    const cookies = new Map<string, string>([
      ["session", "abc"],
      ["csrf", "xyz"],
    ])
    await broker.storeBrowserAuthProfile(ref, { cookies, tokens: ["bearer-1"] }, "browser-auth-profile")
    const profile = await broker.resolveBrowserAuthProfile(ref, SCOPE_A)
    expect(profile.cookies.get("session")).toBe("abc")
    expect(profile.cookies.get("csrf")).toBe("xyz")
    expect(profile.tokens).toEqual(["bearer-1"])
    // Defensive copy: mutating the returned Map does not poison the broker.
    ;(profile.cookies as Map<string, string>).set("session", "tampered")
    const again = await broker.resolveBrowserAuthProfile(ref, SCOPE_A)
    expect(again.cookies.get("session")).toBe("abc")
  })
})

// ---------------------------------------------------------------------------
// Cross-platform fallback (PBKDF2)
// ---------------------------------------------------------------------------

describe("createOsBroker — PBKDF2 fallback", () => {
  test("the same broker is reconstructed on Windows, macOS, and Linux", async () => {
    for (const platform of ["win32", "darwin", "linux"] as const) {
      const dir = newTempStorageDir(`unifia-os-broker-${platform}-`)
      openedDirs.push(dir)
      const sharedKey = newKey()
      const a = createOsBroker({ rootKey: sharedKey, platform, storageDir: dir })
      const b = createOsBroker({ rootKey: sharedKey, platform, storageDir: dir })
      const ref = credentialRef(SCOPE_A, "cred-cross-platform")
      await a.storeCredential(ref, `secret-on-${platform}`, "credential-material")
      const fromB = await b.resolveCredential(ref, SCOPE_A)
      expect(new TextDecoder("utf-8", { fatal: true }).decode(fromB as Uint8Array)).toBe(`secret-on-${platform}`)
    }
  })

  test("the same storage dir with two different platform markers refuses to open (OS layer mismatch)", async () => {
    const dir = newTempStorageDir("unifia-os-broker-mismatch-")
    openedDirs.push(dir)
    const sharedKey = newKey()
    const writer = createOsBroker({ rootKey: sharedKey, platform: "win32", storageDir: dir })
    const ref = credentialRef(SCOPE_A, "cred-mismatch")
    await writer.storeCredential(ref, "windows-only", "credential-material")
    // A reader claiming to be on Linux refuses the dpapi-sealed file.
    const reader = createOsBroker({ rootKey: sharedKey, platform: "linux", storageDir: dir })
    await expect(reader.resolveCredential(ref, SCOPE_A)).rejects.toBeInstanceOf(EnvelopeIntegrityError)
  })
})

// ---------------------------------------------------------------------------
// Envelope-level round-trip
// ---------------------------------------------------------------------------

describe("createOsBroker — envelope / unenvelope", () => {
  test("envelope + unenvelope round-trip preserves string material", async () => {
    const env = await broker.envelope("hello, world", "credential-material")
    const material = await broker.unenvelope(env, "credential-material")
    expect(new TextDecoder("utf-8", { fatal: true }).decode(material as Uint8Array)).toBe("hello, world")
  })

  test("two envelopes of the same material produce different ciphertext (fresh nonce)", async () => {
    const first = await broker.envelope("same", "credential-material")
    const second = await broker.envelope("same", "credential-material")
    expect(Buffer.from(first.ciphertext).equals(Buffer.from(second.ciphertext))).toBe(false)
  })

  test("the envelope records the bound AAD domain and key version", async () => {
    const env = await broker.envelope("secret", "artifact-content")
    expect(env.aadDomain).toBe("artifact-content")
    expect(env.protectionScheme).toBe("aead-aes-256-gcm")
    expect(env.encryptionAlgorithm).toBe("AES-256-GCM")
    expect(env.keyRef).toBe("root-key")
    expect(env.keyVersion).toBe(1)
    expect(env.version).toBe(1)
    expect(env.nonceOrIV.length).toBe(12)
    expect(typeof env.contentDigest).toBe("string")
    expect(env.contentDigest).toMatch(/^[0-9a-f]{64}$/)
  })
})

// Sanity: the helper `newTempStorageDir` returns a unique path.
describe("test helpers", () => {
  test("newTempStorageDir returns unique paths", () => {
    const a = newTempStorageDir()
    const b = newTempStorageDir()
    expect(a).not.toBe(b)
  })

  test("utf8 round-trips a string", () => {
    expect(new TextDecoder("utf-8", { fatal: true }).decode(utf8("hi"))).toBe("hi")
  })
})
