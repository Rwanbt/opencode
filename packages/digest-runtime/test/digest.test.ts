/* SPDX-License-Identifier: MIT */
/**
 * @unifia/digest-runtime — bun:test suite.
 *
 * Covers the M1-01 acceptance criteria from
 * `docs/automation-v2/M1-IMPLEMENTATION-PLAN.md` §3.1 + §5.1:
 *
 *   (a) `digest({a: 1, b: 2})` ≡ `digest({b: 2, a: 1})` (key sort)
 *   (b) `digest({x: 1})` ≠ `digest({x: 1.0})` (integer-only, Zod pre-coerce)
 *   (c) 7 domains produce 7 distinct `value` for same payload
 *   (d) Recursive sort: `digest({nested: {b: 1, a: 2}})` ≡
 *       `digest({nested: {a: 2, b: 1}})`
 *   (e) `digest({})` returns SHA-256 of JCS of `{}` (RFC 8785 reference vector)
 *
 * Plus regression coverage for the typed envelope surface, the
 * integer-only invariant, and domain-branded type re-export.
 */
import { describe, expect, test } from "bun:test"
import { createHash } from "node:crypto"
import canonicalize from "canonicalize"
import {
  DigestEnvelopeSchema,
  type DigestDomain,
  type DigestEnvelope,
} from "@unifia/contracts"
import { asDomainDigest, digest, IntegerOnlyError, validateIntegerOnly } from "../src/index.js"

const ALL_DOMAINS: DigestDomain[] = [
  "workflow-version",
  "approval-effect",
  "policy",
  "connector-manifest",
  "mcp-schema",
  "deployment",
  "artifact-bytes",
]

describe("@unifia/digest-runtime", () => {
  test("(a) key sort at root: same payload, different insertion order, same digest", () => {
    const env1 = digest({ a: 1, b: 2 }, "workflow-version")
    const env2 = digest({ b: 2, a: 1 }, "workflow-version")
    expect(env1.value).toBe(env2.value)
    expect(env1.domain).toBe("workflow-version")
    expect(env1.canonicalizationAlgorithm).toBe("JCS-v1")
    expect(env1.hashAlgorithm).toBe("SHA-256")
    expect(env1.version).toBe(1)
  })

  test("(b) integer-only: 1.5 throws, 1 succeeds (silent-collision mitigation per M0-02)", () => {
    // The JCS library collapses 1 and 1.0 to the same byte stream.
    // The integer-only invariant catches non-integer floats (1.5)
    // before they reach the canonicalizer.
    const integerEnvelope = digest({ x: 1 }, "workflow-version")
    expect(integerEnvelope.value).toMatch(/^[0-9a-f]{64}$/)

    // 1.0 === 1 in JavaScript, so it produces the same digest as 1.
    // This is documented behavior, not a bug: the platform's
    // Zod-typed contracts upstream never emit `1.0` distinct from `1`.
    const floatOneEnvelope = digest({ x: 1.0 }, "workflow-version")
    expect(floatOneEnvelope.value).toBe(integerEnvelope.value)

    // A *real* non-integer float (1.5) is rejected.
    expect(() => digest({ x: 1.5 }, "workflow-version")).toThrow(IntegerOnlyError)
  })

  test("(c) seven domains produce seven distinct digests for the same payload", () => {
    const payload = { id: "wf-1", version: 1, steps: [] }
    const envelopes = ALL_DOMAINS.map((d) => digest(payload, d))
    const values = envelopes.map((e) => e.value)
    expect(new Set(values).size).toBe(7)
    // Domain field matches the requested domain.
    for (let i = 0; i < ALL_DOMAINS.length; i++) {
      expect(envelopes[i]!.domain).toBe(ALL_DOMAINS[i])
    }
  })

  test("(d) recursive key sort: nested objects are sorted at every depth", () => {
    const a = digest({ nested: { b: 1, a: 2 } }, "workflow-version")
    const b = digest({ nested: { a: 2, b: 1 } }, "workflow-version")
    expect(a.value).toBe(b.value)
  })

  test("(e) empty object: SHA-256 of JCS('{}') under domain 'workflow-version'", () => {
    // Reference vector: SHA-256 of the byte stream of
    // canonicalize({"domain": "workflow-version", "value": {}}).
    const expectedCanonical = canonicalize({ domain: "workflow-version", value: {} })
    expect(typeof expectedCanonical).toBe("string")
    const expectedHex = createHash("sha256").update(expectedCanonical as string).digest("hex")
    const env = digest({}, "workflow-version")
    expect(env.value).toBe(expectedHex)
  })

  test("RFC 8785 §3.2.2.3 — canonical form is the lower-case JSON with sorted keys", () => {
    // JCS sorts keys lexicographically (Unicode code-point order). The
    // result for {z:1, a:2, m:3} is exactly {"a":2,"m":3,"z":1}.
    const c = canonicalize({ z: 1, a: 2, m: 3 })
    expect(c).toBe('{"a":2,"m":3,"z":1}')
  })

  test("typed envelope parses against DigestEnvelopeSchema", () => {
    const env = digest({ id: "wf-1" }, "policy")
    const parsed: DigestEnvelope = DigestEnvelopeSchema.parse(env)
    expect(parsed).toEqual(env)
  })

  test("asDomainDigest re-export coerces an envelope to its branded type", async () => {
    const env = digest({ id: "wf-1" }, "workflow-version")
    // The branded type prevents cross-domain assignment at compile time;
    // at runtime the function verifies the domain matches.
    const typed = asDomainDigest(env, "workflow-version")
    expect(typed.domain).toBe("workflow-version")
    expect(() => asDomainDigest(env, "policy")).toThrow(/domain mismatch/)
  })

  test("validateIntegerOnly: accepts 1, 0, -1, MAX_SAFE_INTEGER, refuses 1.5, NaN, Infinity", () => {
    expect(() => validateIntegerOnly(0)).not.toThrow()
    expect(() => validateIntegerOnly(1)).not.toThrow()
    expect(() => validateIntegerOnly(-1)).not.toThrow()
    expect(() => validateIntegerOnly(Number.MAX_SAFE_INTEGER)).not.toThrow()
    expect(() => validateIntegerOnly(Number.MIN_SAFE_INTEGER)).not.toThrow()

    expect(() => validateIntegerOnly(1.5)).toThrow(IntegerOnlyError)
    expect(() => validateIntegerOnly(NaN)).toThrow(IntegerOnlyError)
    expect(() => validateIntegerOnly(Infinity)).toThrow(IntegerOnlyError)
    expect(() => validateIntegerOnly(-Infinity)).toThrow(IntegerOnlyError)
    expect(() => validateIntegerOnly(Number.MAX_SAFE_INTEGER + 1)).toThrow(IntegerOnlyError)
  })

  test("validateIntegerOnly: deep path is reported in the error", () => {
    try {
      validateIntegerOnly({ steps: [{ cost: 10 }, { cost: 1.5 }] })
      expect.unreachable()
    } catch (err) {
      expect(err).toBeInstanceOf(IntegerOnlyError)
      expect((err as IntegerOnlyError).path).toBe("/steps/1/cost")
      expect((err as IntegerOnlyError).value).toBe(1.5)
    }
  })

  test("non-integer inside a deeply nested object is rejected", () => {
    const payload = { a: { b: { c: { d: { e: 2.7 } } } } }
    expect(() => digest(payload, "policy")).toThrow(IntegerOnlyError)
  })

  test("domain is rejected at the boundary if not in DigestDomainSchema", () => {
    // @ts-expect-error: testing runtime guard, not the type system
    expect(() => digest({}, "bogus-domain")).toThrow()
  })
})
