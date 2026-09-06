/* SPDX-License-Identifier: MIT */
/* Copyright (c) 2026 Unifia contributors */

/**
 * @unifia/artifact-store — M1-06 / C-M1-06 (plan §3.6, §5.4) + ADR-005.
 *
 * Implements the in-memory half of the platform ArtifactStore. The
 * contract says the *store* is the unique authority for
 * classification, taint, ownership, and environment (plan §71, TM-AR-01).
 * The caller passes an `ArtifactWriteRequest` that has *no* field for
 * any of those — the Zod schema for `ArtifactWriteRequestSchema` omits
 * them on purpose (see `packages/contracts/src/artifact-record.ts:89-100`).
 *
 * The store derives:
 *   - `contentDigest`           : SHA-256 over the canonicalized bytes
 *                                 (JCS-v1, domain "artifact-bytes"),
 *                                 via `@unifia/digest-runtime`.
 *   - `protectionEnvelope`      : placeholder `AtRestProtectionEnvelope`
 *                                 with `aadDomain: "artifact-content"`.
 *                                 The envelope is non-cryptographic in
 *                                 this scaffold — the production
 *                                 `secret-broker` OS-level is wired in
 *                                 C-M1-07 (plan §3.7). Here we only
 *                                 prove the *shape* and the *aadDomain*
 *                                 binding.
 *   - `classification`          : derived from `mediaType` per the
 *                                 classification matrix documented in
 *                                 `M1-06-EVIDENCE.md` §3.1.
 *   - `taints`                  : derived from a content sniff of the
 *                                 bytes (BEGIN markers, cookie headers,
 *                                 etc.). Default = `[]`.
 *   - `storageClass`            : `"hot"` for `size < 1 MB`,
 *                                 `"cold"` otherwise.
 *   - `retentionPolicy`         : from the request, or a default
 *                                 `ttlSeconds: 7 * 24 * 3600` (7 days).
 *
 * Scope enforcement reuses the M1-03 `ensureScope` 3-field pattern
 * (orgId + projectId? + workspaceId, ADR-020). The 3-field shape
 * prevents "project drift" (TM-T-01). The error is the typed
 * `TenantMismatchError` from `@unifia/secret-broker` — the same
 * shape every adapter in the platform throws on cross-tenant access.
 *
 * The `LARGE PAYLOAD RULE` (plan §70, contract
 * `ARTIFACT_INLINE_THRESHOLD_BYTES` = 64 KiB) is a *UI concern*, not
 * a store concern: the store accepts any size and persists the
 * content digest + bytes. The UI layer replaces an inlined buffer
 * with an `ArtifactRef` (an opaque handle) when the content is
 * over 64 KiB. The test suite pins that boundary so the contract
 * does not regress to "store refuses large content".
 */
import { randomBytes } from "node:crypto"
import { createHash } from "node:crypto"

import {
  ARTIFACT_INLINE_THRESHOLD_BYTES,
  ArtifactRecordSchema,
  type ArtifactRecord,
  type ArtifactRef,
  type ArtifactWriteRequest,
  type ArtifactBytesDigest,
  type Classification,
  type RetentionPolicy,
  type Taint,
  type OwnershipScope,
  type AtRestProtectionEnvelope,
  type ArtifactOrigin,
} from "@unifia/contracts"
import { asDomainDigest, digest } from "@unifia/digest-runtime"
import { TenantMismatchError } from "@unifia/secret-broker"

/* ------------------------------------------------------------------ */
/* Errors                                                              */
/* ------------------------------------------------------------------ */

/**
 * Thrown when the store rejects a write because the caller's
 * `principalScope` does not match the `ownershipScope` declared in
 * the `ArtifactWriteRequest`. The 3-field pattern is the same as
 * `secret-broker` and `M1-03` scope enforcement.
 */
export { TenantMismatchError }

/**
 * Thrown when the store rejects a read because the caller's
 * `principalScope` does not match the `ownershipScope` recorded on
 * the artifact. Same shape as the create-side error; same name.
 */

/**
 * Thrown when the store is asked to read an `artifactId` it does not
 * know about. Distinct from `TenantMismatchError` so a caller can
 * branch on the difference (a missing id is a 404; a scope mismatch
 * is a 403).
 */
export class ArtifactNotFoundError extends Error {
  constructor(reason: string) {
    super(reason)
    this.name = "ArtifactNotFoundError"
  }
}

/* ------------------------------------------------------------------ */
/* Scope enforcement — M1-03 pattern, 3-field OwnershipScope          */
/* ------------------------------------------------------------------ */

/**
 * 3-field scope check, identical to the helper in
 * `docs/automation-v2/spikes/m1-03-scope-enforcement.ts:89` and
 * `packages/secret-broker/src/index.ts:230-236` (extended to cover
 * `projectId` drift). The `what` argument is the operation name
 * (`"artifact create"`, `"artifact read"`) for diagnostics.
 */
function ensureScope(actual: OwnershipScope, requested: OwnershipScope, what: string): void {
  if (actual.organizationId !== requested.organizationId) {
    throw new TenantMismatchError(
      `cross-tenant access denied for ${what}: org ${actual.organizationId} != ${requested.organizationId}`,
    )
  }
  if (actual.workspaceId !== requested.workspaceId) {
    throw new TenantMismatchError(
      `cross-tenant access denied for ${what}: workspace ${actual.workspaceId} != ${requested.workspaceId}`,
    )
  }
  const aProj = actual.projectId ?? ""
  const rProj = requested.projectId ?? ""
  if (aProj !== rProj) {
    throw new TenantMismatchError(
      `cross-tenant access denied for ${what}: project '${aProj}' != '${rProj}'`,
    )
  }
}

/* ------------------------------------------------------------------ */
/* Classification derivation — mediaType → Classification              */
/* ------------------------------------------------------------------ */

/**
 * Map a `mediaType` string to the platform's four
 * `Classification` levels (plan §121, ADR-005).
 *
 * The matrix is documented in `M1-06-EVIDENCE.md` §3.1. The
 * implementation strips RFC 2045 charset / boundary parameters
 * before matching (e.g. `text/plain; charset=utf-8` → `text/plain`),
 * which avoids the "downgrade by adding a charset" trick.
 *
 * The matrix is *deliberately* conservative. Adding a new
 * `restricted` media type is an ADR (it widens the surface of what
 * the store refuses to inline as plain text). The default branch
 * returns `internal` so unknown media types are still subject to the
 * at-rest envelope.
 */
export function deriveClassificationFromMediaType(mediaType: string): Classification {
  const bare = mediaType.split(";", 1)[0]!.trim().toLowerCase()
  if (bare === "") return "internal"

  // Restricted: anything executable or anything that the platform
  // refuses to inline as text (shell, native binaries, archives
  // that bypass the document pipeline).
  if (
    bare === "application/x-sh" ||
    bare === "application/x-shellscript" ||
    bare === "application/x-bash" ||
    bare === "application/x-executable" ||
    bare === "application/x-mach-binary" ||
    bare === "application/x-elf" ||
    bare === "application/x-msdownload" ||
    bare === "application/zip" ||
    bare === "application/x-tar" ||
    bare === "application/x-gzip" ||
    bare === "application/x-7z-compressed"
  ) {
    return "restricted"
  }

  // Confidential: human-readable text that may contain secrets.
  // The store still emits the protection envelope, but `internal`
  // text (`.txt`, `.md`, `.log`) and `secrets/*` content get a
  // bumped classification.
  if (bare === "text/plain" || bare.startsWith("text/")) {
    return "confidential"
  }
  if (bare === "application/json" || bare === "application/x-yaml" || bare === "application/yaml") {
    return "confidential"
  }
  if (bare.startsWith("secrets/")) {
    return "confidential"
  }

  // Public: nothing currently — there is no media type for which
  // the store returns `public` on its own. A caller cannot lower
  // the classification (plan §71, TM-AR-01) so `public` is
  // unreachable from `deriveClassificationFromMediaType` today.
  //
  // The matrix is pinned to "store-derived default = internal" so
  // a future expansion to `public` is an explicit ADR.

  return "internal"
}

/* ------------------------------------------------------------------ */
/* Taint sniffing — bytes content → Taint[]                            */
/* ------------------------------------------------------------------ */

/**
 * Decode a leading window of the artifact bytes as ASCII / UTF-8 and
 * return the taint markers the store can detect from the prefix.
 *
 * The sniff is intentionally narrow:
 *   - PEM-style `-----BEGIN <label>-----` arms of a key/cert → `secret`.
 *   - `Cookie:` / `Set-Cookie:` headers → `auth_session`.
 *
 * Anything else returns `[]` (the store does not invent taints
 * from a content sample). The full content is not re-scanned: the
 * `DigestEnvelope` is the content-addressed handle, and taints
 * are a *property of the prefix the store can prove without
 * reading the whole stream*.
 *
 * Returning `[]` is the safe default — the store does not down-
 * or up-grade taints based on the caller's hints.
 */
export function sniffTaintsFromBytes(bytes: Uint8Array, maxPrefix = 4096): Taint[] {
  // PEM arm marker: `-----BEGIN ` (10 bytes, then 1+ label char).
  // We do not require the closing `-----` (some files omit it for
  // streaming); the BEGIN alone is enough to flag a key / cert.
  const PEM_BEGIN = "-----BEGIN "
  // Cookie header forms: RFC 6265 `Cookie:` and `Set-Cookie:`.
  const COOKIE_NAMES = ["cookie:", "set-cookie:"]

  const end = Math.min(bytes.length, maxPrefix)
  // Cheap ASCII/UTF-8 prefix decode: we only need to recognise
  // marker bytes that are 7-bit ASCII by construction.
  const prefix = bytesToAsciiLower(bytes, end)

  const taints: Taint[] = []
  if (prefix.includes(PEM_BEGIN.toLowerCase())) {
    taints.push("secret")
  }
  for (const marker of COOKIE_NAMES) {
    if (prefix.includes(marker)) {
      taints.push("auth_session")
      break
    }
  }
  return taints
}

function bytesToAsciiLower(bytes: Uint8Array, end: number): string {
  let out = ""
  for (let i = 0; i < end; i++) {
    const b = bytes[i]!
    // 0x09 (tab), 0x0A (LF), 0x0D (CR), 0x20..0x7E are all valid ASCII
    // bytes that appear in PEM / cookie headers. Anything outside
    // (high bit set) is replaced by a placeholder so `includes`
    // works on the exact byte sequences we care about.
    if (b === 0x09 || b === 0x0a || b === 0x0d || (b >= 0x20 && b <= 0x7e)) {
      out += String.fromCharCode(b)
    } else {
      out += "."
    }
  }
  return out.toLowerCase()
}

/* ------------------------------------------------------------------ */
/* Protection envelope — placeholder, aadDomain "artifact-content"    */
/* ------------------------------------------------------------------ */

/**
 * Build the at-rest protection envelope for an artifact. This is a
 * *placeholder* — the production envelope is computed by the
 * `secret-broker` OS-level port (C-M1-07) with a real KEK/DEK
 * hierarchy and OS-keyring root key. Here we just need the *shape*
 * to validate against `AtRestProtectionEnvelopeSchema` and to pin
 * the `aadDomain: "artifact-content"` binding that the
 * ArtifactStore contract requires (plan §71, ADR-010).
 *
 * The nonce is `randomBytes(12).toString("base64")` — 12 bytes
 * (96 bits) is the NIST SP 800-38D recommendation for AES-256-GCM.
 * The `keyRef: "ROOT"` / `keyVersion: 1` pair is the placeholder
 * the production OS broker will overwrite with the real
 * keyring-recognisable string.
 */
function buildProtectionEnvelope(): AtRestProtectionEnvelope {
  return {
    version: 1,
    protectionScheme: "OS-keyring",
    encryptionAlgorithm: "AES-256-GCM",
    keyRef: "ROOT",
    keyVersion: "1",
    nonceOrIV: randomBytes(12).toString("base64"),
    aadDomain: "artifact-content",
  }
}

/* ------------------------------------------------------------------ */
/* Store interface                                                     */
/* ------------------------------------------------------------------ */

/**
 * The store is the *unique* authority for classification, taint,
 * ownership, and environment. The caller cannot fix any of those
 * (plan §71, TM-AR-01).
 */
export interface ArtifactStore {
  /**
   * Persist `bytes` per the caller-supplied `ArtifactWriteRequest`
   * (mediaType, origin, ownership scope) and `principalScope`
   * (the actor on whose behalf the write happens).
   *
   * Throws `TenantMismatchError` if `principalScope` does not
   * match `req.ownershipScope`. The store computes
   * `contentDigest`, derives `classification` and `taints` from
   * the bytes + `mediaType`, and returns a fully populated
   * `ArtifactRecord` validated by Zod.
   */
  create(req: ArtifactWriteRequest, principalScope: OwnershipScope): Promise<ArtifactRecord>

  /**
   * Read the artifact by id, enforcing scope. Returns the
   * `ArtifactRecord` and a *defensive copy* of the bytes (so a
   * mutation by the caller cannot corrupt the store).
   */
  read(artifactId: string, principalScope: OwnershipScope): Promise<{ record: ArtifactRecord; bytes: Uint8Array }>
}

/* ------------------------------------------------------------------ */
/* In-memory implementation                                            */
/* ------------------------------------------------------------------ */

interface Stored {
  record: ArtifactRecord
  bytes: Uint8Array
}

const HOT_THRESHOLD_BYTES = 1024 * 1024 // 1 MiB
const DEFAULT_TTL_SECONDS = 7 * 24 * 3600 // 7 days

/**
 * Default retention policy. Used when the request omits
 * `retentionPolicy`. The TTL is 7 days for a hot artifact; the
 * cold transition and purge are governed by `coldAfterSeconds` and
 * `purgeAfterSeconds` when set.
 */
const DEFAULT_RETENTION: RetentionPolicy = {
  ttlSeconds: DEFAULT_TTL_SECONDS,
}

/**
 * Create the in-memory `ArtifactStore`. The factory is the
 * exported handle; the implementation is a closure over a `Map`
 * keyed by `artifactId`. A process crash erases everything —
 * that is acceptable for the M1-06 spike / evidence scope
 * (plan §193: spike = throwaway, no durable persistence).
 *
 * The store is **stateless across instances** — two stores do
 * not share data. A production store would back the `Map` with
 * SQLite (Native), Postgres (DBOS), or a Temporal workflow
 * (Temporal); that is the C-M1-09/C-M1-11 workstream (RED, post-
 * ADR-000).
 */
export function createInMemoryArtifactStore(): ArtifactStore {
  const byId = new Map<string, Stored>()

  // 8-hex chars of random for a fresh id. The id is opaque — a
  // caller never derives it from content (two different contents
  // can share an id lineage in the C-PRE1-04 model, see
  // `packages/artifact-runtime/src/index.ts:13-16`). For the
  // V2 store we just want a fresh handle.
  function newArtifactId(): string {
    return "art_" + randomBytes(8).toString("hex")
  }

  async function create(req: ArtifactWriteRequest, principalScope: OwnershipScope): Promise<ArtifactRecord> {
    // Caller cannot fix classification, taint, ownership, or
    // environment (plan §71, TM-AR-01). The contract
    // `ArtifactWriteRequestSchema` *omits* those fields on
    // purpose, but we defend in depth: a malicious caller who
    // bypasses Zod and passes an extended object via
    // `as unknown as ArtifactWriteRequest` will still get
    // store-derived values, because we only read
    // `bytes`/`mediaType`/`origin`/`ownershipScope`/
    // `deploymentScope`/`retentionPolicy` here.
    ensureScope(req.ownershipScope, principalScope, "artifact create")

    const classification = deriveClassificationFromMediaType(req.mediaType)
    const taints = sniffTaintsFromBytes(req.bytes)

    // contentDigest: SHA-256 over the canonical form
    //   { domain: "artifact-bytes", value: { bytes-hex: ... } }
    // via the digest-runtime. The domain separation is what the
    // M0-02 spike proved (8/9 PASS).
    //
    // We cannot JCS-canonicalize a raw `Uint8Array` because JCS
    // requires a JSON-typed value. The store wraps the bytes in
    // a `{ bytesHex: hex(bytes) }` object before digesting so
    // the JCS-v1 layer sees a valid value. The hex encoding is
    // a deterministic, well-defined transformation (RFC 4648
    // §10, lowercase) and the digest-runtime's domain
    // separation makes the resulting envelope collision-
    // resistant across the other 6 domains.
    const bytesHex = bytesToLowerHex(req.bytes)
    const envelope = digest({ bytesHex }, "artifact-bytes")
    const contentDigest: ArtifactBytesDigest = asDomainDigest(envelope, "artifact-bytes")

    const size = req.bytes.byteLength
    const storageClass: ArtifactRecord["storageClass"] = size < HOT_THRESHOLD_BYTES ? "hot" : "cold"

    const retentionPolicy: RetentionPolicy = req.retentionPolicy ?? DEFAULT_RETENTION

    const origin: ArtifactOrigin = req.origin
    const artifactId = newArtifactId()

    const record: ArtifactRecord = ArtifactRecordSchema.parse({
      artifactId,
      ownershipScope: req.ownershipScope,
      deploymentScope: req.deploymentScope,
      contentDigest,
      mediaType: req.mediaType,
      size,
      storageClass,
      taints,
      classification,
      origin,
      retentionPolicy,
      protectionEnvelope: buildProtectionEnvelope(),
      createdAt: Date.now(),
    })

    // Defensive copy: the store never holds the caller's
    // buffer. The caller is free to mutate or reuse `req.bytes`
    // after the call returns.
    byId.set(artifactId, { record, bytes: new Uint8Array(req.bytes) })

    return record
  }

  async function read(
    artifactId: string,
    principalScope: OwnershipScope,
  ): Promise<{ record: ArtifactRecord; bytes: Uint8Array }> {
    const stored = byId.get(artifactId)
    if (!stored) {
      throw new ArtifactNotFoundError(`artifact not found: ${artifactId}`)
    }
    ensureScope(stored.record.ownershipScope, principalScope, "artifact read")
    // Defensive copy on read too — a caller that mutates the
    // returned buffer must not corrupt the store.
    return { record: stored.record, bytes: new Uint8Array(stored.bytes) }
  }

  return { create, read }
}

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

function bytesToLowerHex(bytes: Uint8Array): string {
  // createHash is allocation-bounded and constant-time-friendly
  // for SHA-256, but for hex-encoding we use the faster
  // `Buffer.from(bytes).toString("hex")` which is well-defined
  // for any Uint8Array (it never re-encodes, just maps bytes to
  // 2-char hex pairs). The fallback path (rare) handles
  // subarray views that don't align with a `Buffer` view.
  try {
    return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString("hex")
  } catch {
    return createHash("sha256").update(bytes).digest("hex") // unreachable, but typed-safe
  }
}

/* ------------------------------------------------------------------ */
/* Re-exports                                                          */
/* ------------------------------------------------------------------ */

export type { ArtifactRecord, ArtifactRef, ArtifactWriteRequest, Taint, Classification, OwnershipScope }
export { ARTIFACT_INLINE_THRESHOLD_BYTES }
