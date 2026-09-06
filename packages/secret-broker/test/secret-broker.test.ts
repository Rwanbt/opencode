/* SPDX-License-Identifier: MIT */
// Copyright (c) 2026 Unifia contributors
//
// ADR-010 evidence tests for @unifia/secret-broker.
//
// These tests cover the contract that ADR-010 DECIDED commits to, no
// more. Production hardening (KEK/DEK hierarchy, OS keyring, grace
// periods, backup/restore E2E) is intentionally out of scope — those
// are the M1/M3 tests in plan §196/§201.

import { describe, expect, test } from "bun:test"
import {
  createInMemoryBroker,
  CredentialNotFoundError,
  CredentialRevokedError,
  EnvelopeIntegrityError,
  KeyUnavailableError,
  TenantMismatchError,
  type BrowserAuthProfileRef,
  type CredentialRef,
  type OAuthConnectionRef,
  type OwnershipScope,
  type SecretRef,
} from "../src/index.js"

const SCOPE_A: OwnershipScope = { organizationId: "org-A", workspaceId: "ws-1" }
const SCOPE_B: OwnershipScope = { organizationId: "org-B", workspaceId: "ws-2" }

function newKey(seed = 0x42): Uint8Array {
  // Deterministic non-zero key so a test failure is reproducible.
  return new Uint8Array(32).fill(seed)
}

function newBroker(seed = 0x42): ReturnType<typeof createInMemoryBroker> {
  return createInMemoryBroker(newKey(seed))
}

function credentialRef(scope: OwnershipScope, id: string): CredentialRef {
  return { kind: "credential", credentialId: id, scope }
}

function secretRef(scope: OwnershipScope, id: string): SecretRef {
  return { kind: "secret", secretId: id, scope }
}

function oauthRef(scope: OwnershipScope, id: string): OAuthConnectionRef {
  return { kind: "oauth", connectionId: id, scope }
}

function browserRef(scope: OwnershipScope, id: string): BrowserAuthProfileRef {
  return { kind: "browser-profile", profileId: id, scope }
}

// ---------------------------------------------------------------------------
// Storage and resolution
// ---------------------------------------------------------------------------

describe("createInMemoryBroker — storage and resolution", () => {
  test("resolves a credential after registration", async () => {
    const broker = newBroker()
    const ref = credentialRef(SCOPE_A, "cred-1")
    await broker.storeCredential(ref, "super-secret", "credential-material")
    const material = await broker.resolveCredential(ref, SCOPE_A)
    expect(material).toBeInstanceOf(Uint8Array)
    expect(new TextDecoder("utf-8", { fatal: true }).decode(material as Uint8Array)).toBe("super-secret")
  })

  test("resolves a secret (binary material) after registration", async () => {
    const broker = newBroker()
    const ref = secretRef(SCOPE_A, "sec-1")
    const raw = new Uint8Array([0, 1, 2, 3, 0xff, 0xfe])
    await broker.storeSecret(ref, raw, "sensitive-runtime-state")
    const material = await broker.resolveSecret(ref, SCOPE_A)
    expect(material).toBeInstanceOf(Uint8Array)
    expect(Array.from(material as Uint8Array)).toEqual(Array.from(raw))
  })

  test("resolveCredential throws when the ref is unknown", async () => {
    const broker = newBroker()
    const ref = credentialRef(SCOPE_A, "cred-missing")
    await expect(broker.resolveCredential(ref, SCOPE_A)).rejects.toBeInstanceOf(CredentialNotFoundError)
  })

  test("resolveCredential returns a defensive copy of the bytes (no aliasing)", async () => {
    const broker = newBroker()
    const ref = credentialRef(SCOPE_A, "cred-1")
    const raw = new Uint8Array([10, 20, 30])
    await broker.storeCredential(ref, raw, "credential-material")
    const first = (await broker.resolveCredential(ref, SCOPE_A)) as Uint8Array
    first[0] = 99
    const second = (await broker.resolveCredential(ref, SCOPE_A)) as Uint8Array
    expect(second[0]).toBe(10)
  })

  test("resolveOAuthConnection round-trips the typed token", async () => {
    const broker = newBroker()
    const ref = oauthRef(SCOPE_A, "gh-1")
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

  test("resolveBrowserAuthProfile rebuilds the cookie Map and returns a defensive copy", async () => {
    const broker = newBroker()
    const ref = browserRef(SCOPE_A, "profile-1")
    const cookies = new Map<string, string>([
      ["session", "abc"],
      ["csrf", "xyz"],
    ])
    await broker.storeBrowserAuthProfile(ref, { cookies, tokens: ["bearer-1"] }, "browser-auth-profile")
    const profile = await broker.resolveBrowserAuthProfile(ref, SCOPE_A)
    expect(profile.cookies.get("session")).toBe("abc")
    expect(profile.cookies.get("csrf")).toBe("xyz")
    expect(profile.tokens).toEqual(["bearer-1"])
    // Mutating the returned Map must not affect future resolves.
    ;(profile.cookies as Map<string, string>).set("session", "tampered")
    const again = await broker.resolveBrowserAuthProfile(ref, SCOPE_A)
    expect(again.cookies.get("session")).toBe("abc")
  })
})

// ---------------------------------------------------------------------------
// Multi-tenant isolation (REQ-14, ADR-020)
// ---------------------------------------------------------------------------

describe("createInMemoryBroker — multi-tenant isolation", () => {
  test("Tenant A cannot use B's credential (cross-tenant resolve throws)", async () => {
    const broker = newBroker()
    const refB = credentialRef(SCOPE_B, "cred-b")
    await broker.storeCredential(refB, "B's secret", "credential-material")
    await expect(broker.resolveCredential(refB, SCOPE_A)).rejects.toBeInstanceOf(TenantMismatchError)
  })

  test("the same id in two tenants does not collide", async () => {
    const broker = newBroker()
    await broker.storeCredential(credentialRef(SCOPE_A, "shared-id"), "A's value", "credential-material")
    await broker.storeCredential(credentialRef(SCOPE_B, "shared-id"), "B's value", "credential-material")
    expect(new TextDecoder("utf-8", { fatal: true }).decode((await broker.resolveCredential(credentialRef(SCOPE_A, "shared-id"), SCOPE_A)) as Uint8Array)).toBe("A's value")
    expect(new TextDecoder("utf-8", { fatal: true }).decode((await broker.resolveCredential(credentialRef(SCOPE_B, "shared-id"), SCOPE_B)) as Uint8Array)).toBe("B's value")
  })

  test("a mismatched scope on a stored ref throws TenantMismatchError", async () => {
    const broker = newBroker()
    const ref = credentialRef(SCOPE_A, "cred-1")
    await broker.storeCredential(ref, "value", "credential-material")
    const wrongWorkspace: OwnershipScope = { organizationId: "org-A", workspaceId: "ws-2" }
    await expect(broker.resolveCredential(ref, wrongWorkspace)).rejects.toBeInstanceOf(TenantMismatchError)
  })

  test("oauth and browser profile are also scope-isolated", async () => {
    const broker = newBroker()
    const refB = oauthRef(SCOPE_B, "gh-b")
    await broker.storeOAuthConnection(refB, { accessToken: "x", expiresAt: 0, scopes: [] }, "oauth-token")
    await expect(broker.resolveOAuthConnection(refB, SCOPE_A)).rejects.toBeInstanceOf(TenantMismatchError)

    const refBrowserB = browserRef(SCOPE_B, "prof-b")
    await broker.storeBrowserAuthProfile(refBrowserB, { cookies: new Map() }, "browser-auth-profile")
    await expect(broker.resolveBrowserAuthProfile(refBrowserB, SCOPE_A)).rejects.toBeInstanceOf(TenantMismatchError)
  })
})

// ---------------------------------------------------------------------------
// Revocation (plan §73, §78)
// ---------------------------------------------------------------------------

describe("createInMemoryBroker — revocation", () => {
  test("a revoked credential throws on resolve", async () => {
    const broker = newBroker()
    const ref = credentialRef(SCOPE_A, "cred-1")
    await broker.storeCredential(ref, "value", "credential-material")
    await broker.revoke(ref)
    await expect(broker.resolveCredential(ref, SCOPE_A)).rejects.toBeInstanceOf(CredentialRevokedError)
  })

  test("revoke is idempotent (revoking a missing ref is a no-op)", async () => {
    const broker = newBroker()
    await expect(broker.revoke(credentialRef(SCOPE_A, "ghost"))).resolves.toBeUndefined()
  })

  test("rotate returns a new ref and invalidates the old one", async () => {
    const broker = newBroker()
    const oldRef = credentialRef(SCOPE_A, "cred-1")
    await broker.storeCredential(oldRef, "value", "credential-material")
    const newRef = await broker.rotate(oldRef)
    expect(newRef.credentialId).not.toBe(oldRef.credentialId)
    expect(newRef.scope).toEqual(oldRef.scope)
    // New ref resolves to the same material the scaffold carried over.
    expect(new TextDecoder("utf-8", { fatal: true }).decode((await broker.resolveCredential(newRef, SCOPE_A)) as Uint8Array)).toBe("value")
    // Old ref is now revoked.
    await expect(broker.resolveCredential(oldRef, SCOPE_A)).rejects.toBeInstanceOf(CredentialRevokedError)
  })
})

// ---------------------------------------------------------------------------
// Envelope (AtRestProtectionEnvelope per ADR-010 §74 / plan §74)
// ---------------------------------------------------------------------------

describe("createInMemoryBroker — envelope and unenvelope", () => {
  test("envelope + unenvelope round-trip preserves string material", async () => {
    const broker = newBroker()
    const env = await broker.envelope("hello, world", "credential-material")
    const material = await broker.unenvelope(env, "credential-material")
    expect(material).toBeInstanceOf(Uint8Array)
    expect(new TextDecoder("utf-8", { fatal: true }).decode(material as Uint8Array)).toBe("hello, world")
  })

  test("envelope + unenvelope round-trip preserves binary material", async () => {
    const broker = newBroker()
    const raw = new Uint8Array([0, 0xff, 0x7f, 0x80, 0xfe, 0x01, 0x00])
    const env = await broker.envelope(raw, "sensitive-runtime-state")
    const material = await broker.unenvelope(env, "sensitive-runtime-state")
    expect(material).toBeInstanceOf(Uint8Array)
    expect(Array.from(material as Uint8Array)).toEqual(Array.from(raw))
  })

  test("envelope with wrong AAD throws (AAD domain binding)", async () => {
    const broker = newBroker()
    const env = await broker.envelope("secret", "credential-material")
    await expect(broker.unenvelope(env, "oauth-token")).rejects.toBeInstanceOf(EnvelopeIntegrityError)
  })

  test("envelope with an unknown AAD domain throws", async () => {
    const broker = newBroker()
    await expect(broker.envelope("secret", "made-up-domain")).rejects.toBeInstanceOf(EnvelopeIntegrityError)
  })

  test("two envelopes of the same material produce different ciphertext (fresh nonce)", async () => {
    const broker = newBroker()
    const first = await broker.envelope("same", "credential-material")
    const second = await broker.envelope("same", "credential-material")
    expect(Buffer.from(first.ciphertext).equals(Buffer.from(second.ciphertext))).toBe(false)
    expect(Buffer.from(first.nonceOrIV).equals(Buffer.from(second.nonceOrIV))).toBe(false)
  })

  test("tampered ciphertext fails the AEAD authentication", async () => {
    const broker = newBroker()
    const env = await broker.envelope("secret", "credential-material")
    const tampered = { ...env, ciphertext: new Uint8Array(env.ciphertext) }
    tampered.ciphertext[0] = (tampered.ciphertext[0] ?? 0) ^ 0x01
    await expect(broker.unenvelope(tampered, "credential-material")).rejects.toBeInstanceOf(EnvelopeIntegrityError)
  })

  test("a different root key cannot unenvelope a sealed envelope", async () => {
    const writer = newBroker(0x42)
    const reader = newBroker(0x99)
    const env = await writer.envelope("secret", "credential-material")
    await expect(reader.unenvelope(env, "credential-material")).rejects.toBeInstanceOf(EnvelopeIntegrityError)
  })

  test("the envelope records the bound AAD domain and key version", async () => {
    const broker = newBroker()
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

// ---------------------------------------------------------------------------
// KEY_UNAVAILABLE (plan §79)
// ---------------------------------------------------------------------------

describe("createInMemoryBroker — KEY_UNAVAILABLE", () => {
  test("an empty root key throws KEY_UNAVAILABLE", () => {
    expect(() => createInMemoryBroker(new Uint8Array(0))).toThrow(KeyUnavailableError)
    expect(() => createInMemoryBroker(new Uint8Array(0))).toThrow(/KEY_UNAVAILABLE/)
  })

  test("a non-32-byte root key throws KEY_UNAVAILABLE", () => {
    expect(() => createInMemoryBroker(new Uint8Array(16))).toThrow(KeyUnavailableError)
    expect(() => createInMemoryBroker(new Uint8Array(64))).toThrow(KeyUnavailableError)
  })
})
