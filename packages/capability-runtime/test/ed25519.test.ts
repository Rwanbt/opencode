/* SPDX-License-Identifier: MIT */
/**
 * Ed25519 sign/verify round-trip (M0-06) wired through the new
 * C-M1-08 enforcer (TM-CP-01). The M0-06 capability *registration*
 * (register/search) lives in `@unifia/contracts`'s `CapabilityRegistry`
 * — the runtime wrapper now exposes the enforcer path (check/revoke).
 * This test keeps the Ed25519 round-trip as the regression net for the
 * signing helpers.
 */
import { describe, expect, test } from "bun:test"
import { generateKeyPairSync } from "node:crypto"
import { capabilitySignaturePayload, type CapabilityManifest } from "@unifia/contracts"
import { createSecureCapabilityRegistry, Ed25519ManifestVerifier, signCapabilityManifest } from "../src/index.ts"

const { publicKey, privateKey } = generateKeyPairSync("ed25519")
const manifest: CapabilityManifest = {
  descriptor: { id: "prompt-pack/signed", name: "Signed", description: "signed", version: "1.0.0", author: "Unifia", license: "MIT", schema: {}, tags: ["signed"], trustLevel: "verified" },
  digest: "sha256:ed25519",
  sourceRepo: "local",
  sourceCommit: "abc",
  license: "MIT",
  remoteCode: false,
}
const privPem = privateKey.export({ type: "pkcs8", format: "pem" })
const pubPem = publicKey.export({ type: "spki", format: "pem" })
const signature = signCapabilityManifest(manifest, privPem)

describe("Ed25519ManifestVerifier — M0-06 sign/verify round-trip (TM-CP-01)", () => {
  test("the verifier accepts a manifest signed with the matching private key", () => {
    const verifier = new Ed25519ManifestVerifier(pubPem)
    expect(verifier.verify(capabilitySignaturePayload(manifest), signature)).toBe(true)
  })

  test("the verifier rejects a manifest signed with a different private key", () => {
    const other = generateKeyPairSync("ed25519")
    const otherSignature = signCapabilityManifest(manifest, other.privateKey.export({ type: "pkcs8", format: "pem" }))
    const verifier = new Ed25519ManifestVerifier(pubPem)
    expect(verifier.verify(capabilitySignaturePayload(manifest), otherSignature)).toBe(false)
  })

  test("createSecureCapabilityRegistry(verifier) returns a SecureCapabilityRegistry", () => {
    const verifier = new Ed25519ManifestVerifier(pubPem)
    const registry = createSecureCapabilityRegistry(verifier)
    expect(typeof registry.check).toBe("function")
    expect(typeof registry.revoke).toBe("function")
    expect(typeof registry.isRevoked).toBe("function")
  })
})
