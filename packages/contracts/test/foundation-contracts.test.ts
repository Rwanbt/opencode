/* SPDX-License-Identifier: MIT */
import { describe, expect, test } from "bun:test"
import {
  AnyCredentialRefSchema,
  ArtifactRefSchema,
  ArtifactWriteRequestSchema,
  AtRestProtectionEnvelopeSchema,
  CapabilityGrantSchema,
  EnforcementResultSchema,
  WorkerIdSchema,
} from "../src/index.ts"

const scope = { organizationId: "org-1", workspaceId: "workspace-1" }

const digest = {
  version: 1,
  domain: "artifact-bytes",
  canonicalizationAlgorithm: "JCS-v1",
  hashAlgorithm: "SHA-256",
  value: "a".repeat(64),
} as const

describe("A1 foundation contracts", () => {
  test("keeps credentials as scoped, discriminated references", () => {
    expect(
      AnyCredentialRefSchema.parse({
        kind: "oauth",
        connectionId: "connection-1",
        provider: "github",
        scope,
      }),
    ).toMatchObject({ kind: "oauth", scope })
    expect(() => AnyCredentialRefSchema.parse({ kind: "oauth", scope })).toThrow()
  })

  test("defaults a legacy worker identity to no authorized scopes", () => {
    const worker = WorkerIdSchema.parse({
      workerId: "worker-1",
      identityProof: "proof",
      version: "1",
      platform: "win32-x64",
      capabilities: [],
      executionProfiles: [],
      resourceClass: "small",
    })
    expect(worker.scopes).toEqual([])
  })

  test("binds artifact records to artifact-byte digests", () => {
    expect(ArtifactRefSchema.parse({ artifactId: "artifact-1", contentDigest: digest })).toMatchObject({
      contentDigest: { domain: "artifact-bytes" },
    })
    expect(() => ArtifactRefSchema.parse({ ...digest, artifactId: "artifact-1" })).toThrow()
    expect(() => ArtifactRefSchema.parse({ artifactId: "artifact-1", contentDigest: { ...digest, domain: "policy" } })).toThrow()
  })

  test("keeps store-owned artifact metadata out of write requests", () => {
    expect(
      ArtifactWriteRequestSchema.parse({
        bytes: new Uint8Array([1]),
        mediaType: "application/octet-stream",
        origin: { kind: "workflow", ref: "workflow-1" },
        ownershipScope: scope,
      }),
    ).not.toHaveProperty("classification")
  })

  test("validates protection metadata and exhaustive enforcement outcomes", () => {
    expect(
      AtRestProtectionEnvelopeSchema.parse({
        version: 1,
        protectionScheme: "envelope",
        encryptionAlgorithm: "AES-256-GCM",
        keyRef: "key-1",
        nonceOrIV: "nonce",
        aadDomain: "artifact-content",
      }),
    ).toMatchObject({ protectionScheme: "envelope" })

    const grant = CapabilityGrantSchema.parse({
      capability: "workflow.run",
      scope: { ownershipScope: scope, environmentId: "production" },
      grantedAt: 1,
      expiresAt: 2,
      bindingDigest: "digest",
    })
    expect(EnforcementResultSchema.parse({ kind: "grant", grant })).toMatchObject({ kind: "grant" })
    expect(EnforcementResultSchema.parse({ kind: "deny", reason: "MANIFEST_REVOKED" })).toMatchObject({ kind: "deny" })
  })
})
