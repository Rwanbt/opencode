/* SPDX-License-Identifier: MIT */
/**
 * @unifia/digest-runtime — Canonicalization + content digest (JCS-v1 + SHA-256).
 *
 * Implements the production half of ADR-001 (Plan V2.3.1 §64-66, §193-197).
 * The M0-02 spike proved the JCS library selection; this module is the
 * substrate-agnostic runtime that all durable artifacts (workflow versions,
 * approval effects, policies, connector manifests, MCP schemas, deployments,
 * artifact bytes) go through before any content-addressed value is
 * persisted.
 *
 * Contract — `digest(value, domain)`:
 *   1. The value is validated for integer-only numeric payloads. Any
 *      number that is not a safe integer (i.e. NaN, ±Infinity, or a
 *      float with a non-zero fractional part) throws IntegerOnlyError.
 *      This is the chosen mitigation for the M0-02 finding that the
 *      `canonicalize` package (npm) collapses `1` and `1.0` to the same
 *      byte stream. We do not (and cannot) distinguish the two literals
 *      at runtime — they are the same JavaScript number. The mitigation
 *      is upstream: contracts are Zod-typed with `z.int()` and the
 *      `IntegerOnlyError` is the last line of defense for non-integer
 *      floats like `1.5` that would otherwise silently produce
 *      domain-dependent digests.
 *   2. The domain is folded into the canonical form so the seven domains
 *      are pairwise collision-resistant. Domain separation is
 *      `{"domain": <domain>, "value": <canonicalized-payload>}`.
 *   3. The canonicalized bytes are SHA-256 hashed.
 *   4. The returned object is a `DigestEnvelope` validated by
 *      `DigestEnvelopeSchema`. It carries the schema version
 *      (`version: 1`), the algorithm pair (`canonicalizationAlgorithm:
 *      "JCS-v1"`, `hashAlgorithm: "SHA-256"`), the domain, and the
 *      64-character lowercase hex value.
 *
 * The module deliberately exposes the minimum surface area required
 * for the platform:
 *   - `digest(value, domain)` — compute a digest envelope
 *   - `IntegerOnlyError` — thrown when a non-integer numeric value is
 *     encountered
 *   - `validateIntegerOnly(value)` — pre-flight check used by callers
 *     that want to fail fast before canonicalization
 *   - `asDomainDigest` — re-exported from `@unifia/contracts` so the
 *     runtime owns the boundary between computed envelopes and the
 *     branded per-domain type aliases
 */
import { createHash } from "node:crypto"
import canonicalize from "canonicalize"
import {
  DigestDomainSchema,
  DigestEnvelopeSchema,
  type DigestDomain,
  type DigestEnvelope,
  asDomainDigest as _asDomainDigest,
} from "@unifia/contracts"

/* ------------------------------------------------------------------ */
/* Errors                                                              */
/* ------------------------------------------------------------------ */

/**
 * Thrown by `digest` and `validateIntegerOnly` when a numeric value
 * in the payload is not a safe integer. The path is the JSON-pointer-
 * like location of the offending value (e.g. `"/steps/3/costUnits"`)
 * for diagnostics.
 */
export class IntegerOnlyError extends Error {
  readonly path: string
  readonly value: unknown

  constructor(path: string, value: unknown) {
    super(
      `IntegerOnlyError at ${path}: expected a safe integer, ` +
        `got ${describeForDiagnostic(value)} ` +
        `(ADR-001 mitigation for the M0-02 silent-collision bug)`,
    )
    this.name = "IntegerOnlyError"
    this.path = path
    this.value = value
  }
}

/* ------------------------------------------------------------------ */
/* Integer-only validation                                             */
/* ------------------------------------------------------------------ */

/**
 * Recursive walk that throws `IntegerOnlyError` if any numeric leaf
 * is not a safe integer (i.e. NaN, ±Infinity, or has a non-zero
 * fractional part).
 *
 * The check enforces `Number.isInteger(x) && Number.isSafeInteger(x)`.
 * `Number.isInteger(1.0)` is `true` because `1.0 === 1` in JavaScript,
 * so the canonical form collapses `1` and `1.0` to the same byte
 * stream. This is the documented RFC 8785 §3.2.2.3 behavior the
 * `canonicalize` npm package implements; ADR-001 mitigates the
 * downstream risk with the integer-only invariant at every
 * publication boundary.
 *
 * Recursion is used (not iterative) for clarity; the platform inputs
 * are bounded by the contract depth (plan §226 — structural tests
 * cap nesting at ~10 levels), so stack depth is not a concern.
 */
export function validateIntegerOnly(value: unknown, path: string = ""): void {
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      validateIntegerOnly(value[i], joinPath(path, `/${i}`))
    }
    return
  }
  if (isPlainObject(value)) {
    for (const key of Object.keys(value)) {
      validateIntegerOnly(value[key], joinPath(path, `/${key}`))
    }
    return
  }
  assertIntegerAt(path, value)
}

function assertIntegerAt(path: string, value: unknown): void {
  if (typeof value === "number") {
    if (!Number.isInteger(value) || !Number.isSafeInteger(value)) {
      throw new IntegerOnlyError(path === "" ? "/" : path, value)
    }
  }
  // Booleans, strings, null, undefined are passed through without
  // check. bigint is *not* a number at runtime so the JCS library
  // will throw on it; the integer check is only about preventing
  // float numeric collision.
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v)
}

function joinPath(parent: string, child: string): string {
  return parent === "" ? child : `${parent}${child}`
}

function describeForDiagnostic(v: unknown): string {
  if (typeof v === "number") {
    if (Number.isNaN(v)) return "NaN"
    if (!Number.isFinite(v)) return v > 0 ? "Infinity" : "-Infinity"
    return `number ${v} (typeof ${typeof v})`
  }
  return `${typeof v} ${JSON.stringify(v)}`
}

/* ------------------------------------------------------------------ */
/* The digest runtime                                                  */
/* ------------------------------------------------------------------ */

/**
 * Compute a `DigestEnvelope` for `value` in `domain`. The envelope
 * is guaranteed to be valid by Zod; callers can re-validate with
 * `DigestEnvelopeSchema.parse(envelope)` if they need a runtime
 * guarantee at the trust boundary.
 *
 * Domain separation is implemented by canonicalizing
 * `{"domain": <domain>, "value": <canonicalized-payload>}` — i.e. the
 * domain field is part of the input bytes. The seven domains
 * (workflow-version, approval-effect, policy, connector-manifest,
 * mcp-schema, deployment, artifact-bytes) therefore produce seven
 * distinct digests for the same payload.
 */
export function digest(value: unknown, domain: DigestDomain): DigestEnvelope {
  // Domain is validated by the type system; we double-check at
  // runtime to fail fast on `digest(payload, "bogus")` calls.
  const parsedDomain = DigestDomainSchema.parse(domain)
  validateIntegerOnly(value)

  // JCS canonicalization of the payload. The `canonicalize` package
  // (npm v4.0.0) implements RFC 8785 with the documented §3.2.2.3
  // behavior that `1` and `1.0` collapse. The integer-only invariant
  // makes that collapse safe in our context.
  const canonicalPayload = canonicalize(value)
  if (typeof canonicalPayload !== "string") {
    // The library returns `undefined` for values it cannot canonicalize
    // (e.g. functions, symbols). We surface a typed error.
    throw new TypeError(
      "digest: canonicalize() returned a non-string. The input likely " +
        "contains an unsupported value (function, symbol, or circular " +
        "reference).",
    )
  }

  // Domain separation: include the domain in the canonical form so
  // collisions across domains are cryptographically hard.
  const separatedInput = { domain: parsedDomain, value: JSON.parse(canonicalPayload) }
  const canonicalSeparated = canonicalize(separatedInput)
  if (typeof canonicalSeparated !== "string") {
    throw new TypeError("digest: canonicalize() returned a non-string on the separated input.")
  }

  const hashValue = createHash("sha256").update(canonicalSeparated).digest("hex")

  const envelope = {
    version: 1 as const,
    domain: parsedDomain,
    canonicalizationAlgorithm: "JCS-v1" as const,
    hashAlgorithm: "SHA-256" as const,
    value: hashValue,
  }

  // Validate the envelope against the Zod schema before returning.
  // This guarantees callers cannot observe a malformed envelope even
  // if the algorithm constants are ever expanded.
  return DigestEnvelopeSchema.parse(envelope)
}

/* ------------------------------------------------------------------ */
/* Re-exports                                                          */
/* ------------------------------------------------------------------ */

/**
 * Re-export `asDomainDigest` from `@unifia/contracts` so the runtime
 * is the single import point for the digest surface. Callers that
 * compute an envelope with `digest()` and then need to hand it to a
 * function expecting `WorkflowVersionDigest` (branded) can do
 *
 *   const env = digest(payload, "workflow-version")
 *   const typed = asDomainDigest(env, "workflow-version")
 *
 * from a single import.
 */
export const asDomainDigest = _asDomainDigest

export type { DigestDomain, DigestEnvelope }
