/* SPDX-License-Identifier: MIT */
/**
 * Digest envelope — Plan V2.3.1 §64, ADR-001.
 *
 * The DigestEnvelope is the canonical handle for any content-
 * addressed value in the platform. Every persisted workflow version,
 * approval effect, policy bundle, deployment descriptor, and
 * artifact is referenced through one of these.
 *
 * The envelope is "generic" over the domain in two complementary
 * ways:
 *   1. The runtime `domain` field is one of the seven values in
 *      DigestDomainSchema (Plan V2.3.1 §65).
 *   2. Each domain has a *branded* type alias below so a function
 *      that takes a WorkflowVersionDigest cannot be called with an
 *      ArtifactBytesDigest — the type system enforces the boundary
 *      even though both are structurally identical envelopes.
 *
 * The `version: 1` field is the schema version of the envelope
 * itself, not the underlying object. A future field is added by
 * bumping the version, not by overloading existing ones.
 */
import { z } from "zod"

/**
 * The seven digest domains from Plan V2.3.1 §65. Each is a closed
 * value set; adding a new domain is an ADR-level decision (collision
 * resistance via the envelope's domain field).
 */
export const DigestDomainSchema = z.enum([
  "workflow-version",
  "approval-effect",
  "policy",
  "connector-manifest",
  "mcp-schema",
  "deployment",
  "artifact-bytes",
])

export type DigestDomain = z.infer<typeof DigestDomainSchema>

/* ------------------------------------------------------------------ */
/* Algorithm enums                                                     */
/* ------------------------------------------------------------------ */

/**
 * The canonicalization algorithm the digest is computed over.
 * `JCS-v1` (RFC 8785) is the only algorithm currently defined; new
 * values are added by ADR when the platform adopts a new
 * canonicalization rule.
 */
export const CanonicalizationAlgorithmSchema = z.enum(["JCS-v1"])

export type CanonicalizationAlgorithm = z.infer<typeof CanonicalizationAlgorithmSchema>

/**
 * The hash algorithm. `SHA-256` is the only algorithm currently
 * defined; the platform deliberately has no fallback to weaker
 * hashes because the content-address is a security primitive.
 */
export const HashAlgorithmSchema = z.enum(["SHA-256"])

export type HashAlgorithm = z.infer<typeof HashAlgorithmSchema>

/* ------------------------------------------------------------------ */
/* The envelope                                                         */
/* ------------------------------------------------------------------ */

/**
 * The base envelope. Use the branded aliases below for domain-
 * specific call sites. The `value` field is a lowercase hex string
 * — the exact form the canonicalization step in ADR-001 emits.
 */
export const DigestEnvelopeSchema = z.object({
  /** Schema version of the envelope shape itself. */
  version: z.literal(1),
  /** Domain this digest was computed over. */
  domain: DigestDomainSchema,
  /** Canonicalization algorithm used to produce the byte stream. */
  canonicalizationAlgorithm: CanonicalizationAlgorithmSchema,
  /** Hash algorithm applied to the canonicalized bytes. */
  hashAlgorithm: HashAlgorithmSchema,
  /** Hex-encoded hash value (lowercase, no prefix). */
  value: z.string(),
})

export type DigestEnvelope = z.infer<typeof DigestEnvelopeSchema>

/* ------------------------------------------------------------------ */
/* Branded per-domain aliases                                           */
/* ------------------------------------------------------------------ */

declare const __digestBrand: unique symbol
type Brand<T, B> = T & { readonly [__digestBrand]: B }

/**
 * Build a branded type for a given domain literal. The brand is a
 * compile-time fiction; at runtime the value is still a plain
 * DigestEnvelope. A function that takes a WorkflowVersionDigest
 * cannot accept a structurally identical PolicyDigest — the type
 * system is the boundary, not the runtime.
 */
type DigestForDomain<D extends DigestDomain> = Brand<DigestEnvelope, D>

export type WorkflowVersionDigest = DigestForDomain<"workflow-version">
export type ApprovalEffectDigest = DigestForDomain<"approval-effect">
export type PolicyDigest = DigestForDomain<"policy">
export type ConnectorManifestDigest = DigestForDomain<"connector-manifest">
export type McpSchemaDigest = DigestForDomain<"mcp-schema">
export type DeploymentDigest = DigestForDomain<"deployment">
export type ArtifactBytesDigest = DigestForDomain<"artifact-bytes">

/* ------------------------------------------------------------------ */
/* Per-domain Zod refinements (ADR-026)                                 */
/* ------------------------------------------------------------------ */

/**
 * ADR-026 — typed DigestEnvelope per domain.
 *
 * The branded type aliases above are *compile-time* fictions: a
 * `WorkflowVersionDigest` and an `ArtifactBytesDigest` are both
 * `DigestEnvelope` at runtime, so the type system cannot stop a
 * caller from passing the wrong domain literal to a field — the
 * runtime boundary is `asDomainDigest()` (called explicitly by
 * trusted loaders and by the digest-runtime).
 *
 * The schemas below close the cross-domain gap at the *parsing
 * boundary* — the first point of entry for any external data. A
 * `WorkflowVersionDigestSchema.parse(env)` rejects `env` if its
 * `domain` literal is anything other than `"workflow-version"`.
 *
 * The refine is a `ZodEffects<DigestEnvelope, DigestForDomain<D>, ...>`:
 * at runtime the value is still a plain `DigestEnvelope`, but
 * `z.infer<typeof WorkflowVersionDigestSchema>` is the branded
 * alias, so call sites that depend on the brand (e.g. an artifact
 * store wiring an `ArtifactBytesDigest` into an `ArtifactRef`)
 * gain a structural guarantee that the two ends agree.
 *
 * Adding a new domain: extend `DigestDomainSchema`, add a
 * `DigestForDomain<"...">` type alias, and add one line below
 * using `domainSchemaFor("...")`. ADR-026 §"Consequences".
 */
function domainSchemaFor<D extends DigestDomain>(d: D) {
  return DigestEnvelopeSchema.refine(
    (e): e is DigestForDomain<D> => e.domain === d,
    { message: `expected domain "${d}"` },
  )
}

export const WorkflowVersionDigestSchema = domainSchemaFor("workflow-version")
export const ApprovalEffectDigestSchema = domainSchemaFor("approval-effect")
export const PolicyDigestSchema = domainSchemaFor("policy")
export const ConnectorManifestDigestSchema = domainSchemaFor("connector-manifest")
export const McpSchemaDigestSchema = domainSchemaFor("mcp-schema")
export const DeploymentDigestSchema = domainSchemaFor("deployment")
export const ArtifactBytesDigestSchema = domainSchemaFor("artifact-bytes")

/**
 * Reinterpret an unbranded envelope as the domain-branded type.
 * Does NOT verify that the envelope's `domain` field matches the
 * brand — that is the caller's responsibility (the canonicalization
 * step guarantees it). The function is a type-system escape hatch
 * for the boundary where digests cross trust zones (e.g. reading
 * from disk and handing to a typed function).
 */
export function asDomainDigest<D extends DigestDomain>(
  envelope: DigestEnvelope,
  expected: D,
): DigestForDomain<D> {
  if (envelope.domain !== expected) {
    throw new Error(
      `DigestEnvelope domain mismatch: expected ${expected}, got ${envelope.domain}`,
    )
  }
  return envelope as DigestForDomain<D>
}
