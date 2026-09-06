/* SPDX-License-Identifier: MIT */
/* Copyright (c) 2026 Unifia contributors */

/**
 * @unifia/artifact-store — bun:test suite.
 *
 * Covers the M1-06 / C-M1-06 acceptance criteria from
 * `docs/automation-v2/M1-IMPLEMENTATION-PLAN.md` §3.6 + §5.4:
 *
 *   (a) `create({...}, scopeA)` with `principalScope: scopeA` succeeds
 *       and returns a valid `ArtifactRecord`.
 *   (b) `create({...}, scopeB)` with `principalScope: scopeA` throws
 *       `TenantMismatchError` (TM-T-01, ADR-020).
 *   (c) Caller's `req` lacks `classification` / `taint` /
 *       `ownershipScope` mutation — store derives them (plan §71).
 *   (d) `mediaType: "application/x-sh"` → store assigns
 *       `classification: "restricted"` (auto-promu).
 *   (e) Bytes starting with `-----BEGIN RSA PRIVATE KEY-----` →
 *       store assigns `taint: ["secret"]`.
 *   (f) Size > 64 KiB → store still works (LARGE PAYLOAD RULE is
 *       a UI concern, not a store one).
 *   (g) `read(artifactId, scopeA)` returns the same record (round-trip).
 *   (h) `read(artifactId, scopeB)` throws `TenantMismatchError`.
 *   (i) `contentDigest.value` is 64 hex chars (SHA-256).
 *   (j) `protectionEnvelope.aadDomain === "artifact-content"`.
 *
 * Plus structural coverage: classification matrix, taint sniff
 * rules, retention default, defensive copy, and the explicit
 * invariant from plan §71 (caller cannot fix classification/taint/
 * ownership/environment).
 */
import { describe, expect, test } from "bun:test"

import {
  ARTIFACT_INLINE_THRESHOLD_BYTES,
  type ArtifactWriteRequest,
  type OwnershipScope,
} from "@unifia/contracts"
import { TenantMismatchError } from "@unifia/secret-broker"

import {
  ArtifactNotFoundError,
  createInMemoryArtifactStore,
  deriveClassificationFromMediaType,
  sniffTaintsFromBytes,
  type ArtifactStore,
} from "../src/index.js"

const SCOPE_A: OwnershipScope = { organizationId: "org-A", projectId: "p-1", workspaceId: "ws-1" }
const SCOPE_B: OwnershipScope = { organizationId: "org-B", workspaceId: "ws-2" }
const SCOPE_A_PROJ2: OwnershipScope = { organizationId: "org-A", projectId: "p-2", workspaceId: "ws-1" }
const SCOPE_A_WS2: OwnershipScope = { organizationId: "org-A", projectId: "p-1", workspaceId: "ws-2" }

function utf8(s: string): Uint8Array<ArrayBuffer> {
  return new TextEncoder().encode(s) as Uint8Array<ArrayBuffer>
}

function makeRequest(scope: OwnershipScope, overrides: Partial<ArtifactWriteRequest> = {}): ArtifactWriteRequest {
  return {
    bytes: utf8("hello artifact\n"),
    mediaType: "text/plain",
    origin: { kind: "user", ref: "user-1" },
    ownershipScope: scope,
    ...overrides,
  }
}

describe("@unifia/artifact-store", () => {
  test("(a) create with matching principalScope returns a valid ArtifactRecord", async () => {
    const store: ArtifactStore = createInMemoryArtifactStore()
    const req = makeRequest(SCOPE_A)
    const record = await store.create(req, SCOPE_A)

    expect(record.artifactId).toMatch(/^art_[0-9a-f]{16}$/)
    expect(record.ownershipScope).toEqual(SCOPE_A)
    expect(record.mediaType).toBe("text/plain")
    expect(record.size).toBe(utf8("hello artifact\n").byteLength)
    expect(record.classification).toBe("confidential")
    expect(record.storageClass).toBe("hot")
    expect(record.retentionPolicy.ttlSeconds).toBe(7 * 24 * 3600)
    expect(typeof record.createdAt).toBe("number")
    expect(record.createdAt).toBeGreaterThan(0)
  })

  test("(b) create with cross-tenant principalScope throws TenantMismatchError (TM-T-01)", async () => {
    const store = createInMemoryArtifactStore()
    const req = makeRequest(SCOPE_A)
    // SCOPE_B is a different org + workspace: the store must refuse.
    await expect(store.create(req, SCOPE_B)).rejects.toBeInstanceOf(TenantMismatchError)

    // Same-org, different-workspace must also be refused.
    await expect(store.create(makeRequest(SCOPE_A), SCOPE_A_WS2)).rejects.toBeInstanceOf(TenantMismatchError)

    // Same-org, same-workspace, different-project must be refused
    // (project drift — M1-03 finding).
    await expect(store.create(makeRequest(SCOPE_A), SCOPE_A_PROJ2)).rejects.toBeInstanceOf(TenantMismatchError)
  })

  test("(c) caller cannot fix classification / taint / ownership / environment (plan §71)", async () => {
    const store = createInMemoryArtifactStore()
    // Build a request and pass an *extended* object that pretends
    // to set classification + taint, the way a malicious caller
    // would if they bypassed Zod with `as unknown as ...`. The
    // store must ignore those fields and use its own derivation.
    const sneaky = {
      bytes: utf8("plain content"),
      mediaType: "text/plain",
      origin: { kind: "user", ref: "user-1" },
      ownershipScope: SCOPE_A,
      // attacker-supplied:
      classification: "public" as const,
      taints: [] as const,
      environment: "production",
    } as unknown as ArtifactWriteRequest
    const record = await store.create(sneaky, SCOPE_A)

    // Store-derived, not caller-supplied.
    expect(record.classification).toBe("confidential") // text/plain → confidential
    expect(record.classification).not.toBe("public")
    expect(record.taints).toEqual([]) // no PEM / cookie header in the bytes
    expect(record.ownershipScope).toEqual(SCOPE_A) // not a foreign scope
    // The store never had an `environment` field on the
    // ArtifactRecord anyway — `environmentId` is on
    // `DeploymentScope`, which is also caller-supplied. We
    // check that the store did not invent one.
    expect(record.deploymentScope).toBeUndefined()
  })

  test("(d) mediaType 'application/x-sh' auto-promu to classification 'restricted'", async () => {
    const store = createInMemoryArtifactStore()
    const req = makeRequest(SCOPE_A, {
      mediaType: "application/x-sh",
      bytes: utf8("#!/bin/sh\necho hi\n"),
    })
    const record = await store.create(req, SCOPE_A)
    expect(record.classification).toBe("restricted")
  })

  test("(d') classification matrix — exhaustive per M1-06-EVIDENCE.md §3.1", () => {
    expect(deriveClassificationFromMediaType("application/x-sh")).toBe("restricted")
    expect(deriveClassificationFromMediaType("application/x-shellscript")).toBe("restricted")
    expect(deriveClassificationFromMediaType("application/x-executable")).toBe("restricted")
    expect(deriveClassificationFromMediaType("application/zip")).toBe("restricted")
    expect(deriveClassificationFromMediaType("application/x-tar")).toBe("restricted")
    expect(deriveClassificationFromMediaType("text/plain")).toBe("confidential")
    expect(deriveClassificationFromMediaType("text/plain; charset=utf-8")).toBe("confidential")
    expect(deriveClassificationFromMediaType("text/html")).toBe("confidential")
    expect(deriveClassificationFromMediaType("application/json")).toBe("confidential")
    expect(deriveClassificationFromMediaType("application/x-yaml")).toBe("confidential")
    expect(deriveClassificationFromMediaType("secrets/env")).toBe("confidential")
    // Default → internal (store does not invent a public classification).
    expect(deriveClassificationFromMediaType("application/octet-stream")).toBe("internal")
    expect(deriveClassificationFromMediaType("")).toBe("internal")
    // `text/*; charset=...` must be stripped before matching.
    expect(deriveClassificationFromMediaType("text/html; charset=ISO-8859-1")).toBe("confidential")
  })

  test("(e) bytes starting with '-----BEGIN ...' are auto-tainted 'secret'", async () => {
    const store = createInMemoryArtifactStore()
    const pem = utf8("-----BEGIN RSA PRIVATE KEY-----\nMIIEowIBAAK...lots of base64...==\n-----END RSA PRIVATE KEY-----\n")
    const record = await store.create(makeRequest(SCOPE_A, { bytes: pem }), SCOPE_A)
    expect(record.taints).toContain("secret")
  })

  test("(e') taint sniff — exhaustive rules per M1-06-EVIDENCE.md §3.2", () => {
    expect(sniffTaintsFromBytes(utf8("-----BEGIN CERTIFICATE-----\nMIIB...==\n"))).toEqual(["secret"])
    expect(sniffTaintsFromBytes(utf8("Cookie: session=abc123; path=/\n"))).toEqual(["auth_session"])
    expect(sniffTaintsFromBytes(utf8("set-cookie: id=42\n"))).toEqual(["auth_session"])
    expect(sniffTaintsFromBytes(utf8("hello world"))).toEqual([])
    // Mixed markers: both taints.
    expect(sniffTaintsFromBytes(utf8("-----BEGIN PRIVATE KEY-----\nx\nCookie: a=b\n"))).toEqual([
      "secret",
      "auth_session",
    ])
    // Binary garbage — the taint sniff tolerates high bytes (they
    // are replaced by `.` before the lowercase compare).
    const withBinary = new Uint8Array([0xff, 0xfe, 0x00, ...utf8("Cookie: x=y\n")])
    expect(sniffTaintsFromBytes(withBinary)).toEqual(["auth_session"])
    // Empty bytes — no taint, no crash.
    expect(sniffTaintsFromBytes(new Uint8Array(0))).toEqual([])
  })

  test("(f) size > 64 KiB still works (LARGE PAYLOAD RULE is a UI concern)", async () => {
    const store = createInMemoryArtifactStore()
    // 100 KiB — the UI replaces this with an ArtifactRef, but the
    // store must still persist and digest it. The test pins the
    // contract so a future refactor cannot silently cap the
    // store at the inline threshold.
    const big = new Uint8Array(100 * 1024)
    for (let i = 0; i < big.length; i++) big[i] = i & 0xff
    const req = makeRequest(SCOPE_A, { bytes: big })
    const record = await store.create(req, SCOPE_A)
    expect(record.size).toBe(big.byteLength)
    expect(record.size).toBeGreaterThan(ARTIFACT_INLINE_THRESHOLD_BYTES)
    // Storage class is hot when size < 1 MiB; cold when >= 1 MiB.
    expect(record.storageClass).toBe("hot")
  })

  test("(f') size >= 1 MiB → storageClass 'cold'", async () => {
    const store = createInMemoryArtifactStore()
    const cold = new Uint8Array(2 * 1024 * 1024)
    const record = await store.create(makeRequest(SCOPE_A, { bytes: cold }), SCOPE_A)
    expect(record.storageClass).toBe("cold")
  })

  test("(g) read with matching principalScope returns the same record + bytes (round-trip)", async () => {
    const store = createInMemoryArtifactStore()
    const req = makeRequest(SCOPE_A, { bytes: utf8("round-trip") })
    const created = await store.create(req, SCOPE_A)
    const { record, bytes } = await store.read(created.artifactId, SCOPE_A)

    expect(record).toEqual(created)
    expect(new TextDecoder().decode(bytes)).toBe("round-trip")

    // Defensive copy: mutating the returned bytes must not affect
    // a subsequent read.
    bytes[0] = 0x00
    const reread = await store.read(created.artifactId, SCOPE_A)
    expect(new TextDecoder().decode(reread.bytes)).toBe("round-trip")
  })

  test("(h) read with cross-tenant principalScope throws TenantMismatchError", async () => {
    const store = createInMemoryArtifactStore()
    const record = await store.create(makeRequest(SCOPE_A), SCOPE_A)
    await expect(store.read(record.artifactId, SCOPE_B)).rejects.toBeInstanceOf(TenantMismatchError)
    // Missing id → 404, distinct from 403.
    await expect(store.read("art_doesnotexist", SCOPE_A)).rejects.toBeInstanceOf(ArtifactNotFoundError)
  })

  test("(i) contentDigest.value is a 64-char lowercase hex (SHA-256)", async () => {
    const store = createInMemoryArtifactStore()
    const record = await store.create(makeRequest(SCOPE_A, { bytes: utf8("hash me") }), SCOPE_A)
    expect(record.contentDigest.value).toMatch(/^[0-9a-f]{64}$/)
    expect(record.contentDigest.domain).toBe("artifact-bytes")
    expect(record.contentDigest.canonicalizationAlgorithm).toBe("JCS-v1")
    expect(record.contentDigest.hashAlgorithm).toBe("SHA-256")
    expect(record.contentDigest.version).toBe(1)
  })

  test("(j) protectionEnvelope.aadDomain === 'artifact-content'", async () => {
    const store = createInMemoryArtifactStore()
    const record = await store.create(makeRequest(SCOPE_A), SCOPE_A)
    expect(record.protectionEnvelope).toBeDefined()
    expect(record.protectionEnvelope!.aadDomain).toBe("artifact-content")
    expect(record.protectionEnvelope!.protectionScheme).toBe("OS-keyring")
    expect(record.protectionEnvelope!.encryptionAlgorithm).toBe("AES-256-GCM")
    expect(record.protectionEnvelope!.version).toBe(1)
    // nonceOrIV is a base64 string of 12 bytes (16 chars b64, no padding).
    const nonceBytes = Buffer.from(record.protectionEnvelope!.nonceOrIV, "base64")
    expect(nonceBytes.length).toBe(12)
  })

  test("structural — defensive copy on read: caller mutation does not leak", async () => {
    const store = createInMemoryArtifactStore()
    const original = utf8("do not mutate")
    const record = await store.create(makeRequest(SCOPE_A, { bytes: original }), SCOPE_A)
    const read = await store.read(record.artifactId, SCOPE_A)
    expect(read.bytes).not.toBe(original)
    // Mutate the caller's view.
    for (let i = 0; i < read.bytes.length; i++) read.bytes[i] = 0x00
    // Re-read: must still match the original.
    const reread = await store.read(record.artifactId, SCOPE_A)
    expect(new TextDecoder().decode(reread.bytes)).toBe("do not mutate")
  })

  test("structural — explicit retentionPolicy from the request is honored", async () => {
    const store = createInMemoryArtifactStore()
    const record = await store.create(
      makeRequest(SCOPE_A, {
        retentionPolicy: { ttlSeconds: 60, coldAfterSeconds: 30, purgeAfterSeconds: 90 },
      }),
      SCOPE_A,
    )
    expect(record.retentionPolicy).toEqual({
      ttlSeconds: 60,
      coldAfterSeconds: 30,
      purgeAfterSeconds: 90,
    })
  })

  test("structural — plan §71 invariant: ownershipScope cannot be 'fixed' by a foreign caller", async () => {
    const store = createInMemoryArtifactStore()
    // Caller declares `ownershipScope: SCOPE_A` and passes a
    // different `principalScope`. The store must:
    //   1. refuse the write (TenantMismatchError)
    //   2. never persist a record with `ownershipScope: SCOPE_B`
    //      just because the actor's principal is B.
    await expect(
      store.create(
        {
          bytes: utf8("x"),
          mediaType: "text/plain",
          origin: { kind: "user", ref: "u" },
          ownershipScope: SCOPE_A,
        },
        SCOPE_B,
      ),
    ).rejects.toBeInstanceOf(TenantMismatchError)
  })
})
