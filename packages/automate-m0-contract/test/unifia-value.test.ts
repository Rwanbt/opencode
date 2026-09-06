/* SPDX-License-Identifier: MIT */
/* Copyright (c) 2026 Unifia contributors */

/**
 * FC-31A / FC-31B — canonical value conformance (ADR-000 §53-§58).
 *
 * These are two of the eight early discriminating tests of §86 (P0-3, P0-4):
 * they run before the failure matrix, because a candidate that cannot hold
 * the value domain cannot hold anything built on top of it.
 *
 * **Scope of this file, stated rather than implied.** It exercises the
 * *contract half* of FC-31A/B: host→canonical conversion, refusal codes,
 * normalization, and semantic equality — all in-process, no substrate. The
 * persistence half ("→ persistence → restart →", §53) belongs to the
 * harness, which replays this same vector through each candidate's
 * `DurableWorkflowAuthorityQualificationAdapter`. A PASS here is necessary
 * and not sufficient; §76 forbids claiming a mechanical PASS without
 * reproducible evidence, and the substrate evidence does not exist yet.
 *
 * The vector is shared with the Go candidate (§79 Gate A). Every case is
 * driven from `M0_UNIFIAVALUE_VECTOR_V1`, never from a literal written
 * here — a case that exists only in the TypeScript test would break the
 * "shared fixtures identical" gate silently.
 */
import { describe, expect, test } from "bun:test"
import {
  CANONICAL_ERROR_CODES,
  CanonicalValueError,
  canonicalEquals,
  canonicalTimestampFromEpochMs,
  canonicalTimestampFromHostDate,
  fromHostFloat64,
  fromHostInteger,
  MAX_SAFE_CANONICAL_INTEGER,
  MIN_SAFE_CANONICAL_INTEGER,
  toCanonicalValue,
  type UnifiaValue,
} from "../src/value.ts"
import {
  binary64ToBits,
  bitsToBinary64,
  BINARY64_LANDMARKS,
  M0_UNIFIAVALUE_VECTOR_V1,
  type VectorCase,
} from "../src/vectors.ts"

/* ------------------------------------------------------------------ */
/* Driving a vector case                                               */
/* ------------------------------------------------------------------ */

class SomeClass {
  value = 1
}

/** Build the host value a `host-sentinel` case names. */
function hostSentinel(name: string): unknown {
  switch (name) {
    case "undefined":
      return undefined
    case "function":
      return () => 1
    case "symbol":
      return Symbol("s")
    case "map":
      return new Map([["k", "v"]])
    case "set":
      return new Set([1])
    case "binary":
      return new Uint8Array([1, 2, 3])
    case "class-instance":
      return new SomeClass()
    case "date":
      return new Date(0)
    default:
      throw new Error(`unknown host sentinel: ${name}`)
  }
}

/**
 * Apply the conversion the case's encoding calls for. Throws
 * `CanonicalValueError` exactly where the contract says it should.
 */
function runCase(one: VectorCase): UnifiaValue {
  switch (one.encoding) {
    case "literal":
      return toCanonicalValue(one.payload)
    case "binary64-bits":
      return fromHostFloat64(bitsToBinary64(one.payload as string))
    case "float64-decimal":
      return fromHostFloat64(Number(one.payload as string))
    case "host-integer":
      return fromHostInteger(Number(one.payload as string))
    case "host-bigint":
      return fromHostInteger(BigInt(one.payload as string))
    case "codepoints":
      return toCanonicalValue(String.fromCodePoint(...(one.payload as number[])))
    case "canonical-timestamp":
      return canonicalTimestampFromEpochMs(one.payload as number)
    case "host-date":
      return canonicalTimestampFromHostDate(new Date(one.payload as number))
    case "host-sentinel":
      return toCanonicalValue(hostSentinel(one.payload as string))
  }
}

/* ------------------------------------------------------------------ */
/* The vector, case by case                                            */
/* ------------------------------------------------------------------ */

describe("FC-31A / FC-31B — vector-driven conformance", () => {
  for (const one of M0_UNIFIAVALUE_VECTOR_V1) {
    test(`${one.id} [${one.test}] ${one.source} — expects ${one.expect.outcome}`, () => {
      if (one.expect.outcome === "reject") {
        let caught: unknown
        try {
          runCase(one)
        } catch (error) {
          caught = error
        }
        expect(caught).toBeInstanceOf(CanonicalValueError)
        expect((caught as CanonicalValueError).code).toBe(one.expect.code as never)
        return
      }

      const result = runCase(one)

      if (one.expect.outcome === "pass-normalized") {
        expect(typeof result).toBe("number")
        expect(binary64ToBits(result as number)).toBe(one.expect.normalizedBits)
        return
      }

      // pass: the value survived, and equals itself under the canonical
      // predicate (which is what the round-trip assertion will compare).
      expect(canonicalEquals(result, result)).toBe(true)
    })
  }
})

/* ------------------------------------------------------------------ */
/* Bit-level landmarks (card M0-M06)                                   */
/* ------------------------------------------------------------------ */

describe("M0-M06 — binary64 bit vectors", () => {
  test("the three landmarks decode to the documented values", () => {
    expect(bitsToBinary64(BINARY64_LANDMARKS.smallestPositiveSubnormal)).toBe(5e-324)
    expect(bitsToBinary64(BINARY64_LANDMARKS.smallestPositiveNormal)).toBe(
      2.2250738585072014e-308,
    )
    expect(bitsToBinary64(BINARY64_LANDMARKS.largestFinite)).toBe(1.7976931348623157e308)
  })

  test("bits round-trip through the canonical boundary unchanged", () => {
    for (const bits of Object.values(BINARY64_LANDMARKS)) {
      const value = fromHostFloat64(bitsToBinary64(bits))
      expect(binary64ToBits(value)).toBe(bits)
    }
  })

  test("a decimal literal is not a substitute for a bit pattern", () => {
    // The point of M0-M06: the decimal is a *request*, the bits are the
    // value. Both must agree here, and the test says so explicitly so a
    // future parser drift is caught rather than assumed away.
    expect(binary64ToBits(5e-324)).toBe(BINARY64_LANDMARKS.smallestPositiveSubnormal)
    expect(binary64ToBits(1.7976931348623157e308)).toBe(BINARY64_LANDMARKS.largestFinite)
  })
})

/* ------------------------------------------------------------------ */
/* §27 — the deliberate float64 / integer split                        */
/* ------------------------------------------------------------------ */

describe("§27 — host float64 and host integer diverge at 2^53", () => {
  const twoPow53 = 9_007_199_254_740_992

  test("the same bits pass as a float64 and are refused as an integer", () => {
    expect(fromHostFloat64(twoPow53)).toBe(twoPow53)
    expect(() => fromHostInteger(twoPow53)).toThrow(CanonicalValueError)
  })

  test("the refusal carries NUMBER_OUT_OF_CANONICAL_RANGE, not a host error", () => {
    try {
      fromHostInteger(twoPow53)
      throw new Error("should have thrown")
    } catch (error) {
      expect(error).toBeInstanceOf(CanonicalValueError)
      expect((error as CanonicalValueError).code).toBe("NUMBER_OUT_OF_CANONICAL_RANGE")
    }
  })

  test("the safe boundary itself is inclusive on both sides", () => {
    expect(fromHostInteger(MAX_SAFE_CANONICAL_INTEGER)).toBe(MAX_SAFE_CANONICAL_INTEGER)
    expect(fromHostInteger(MIN_SAFE_CANONICAL_INTEGER)).toBe(MIN_SAFE_CANONICAL_INTEGER)
    expect(() => fromHostInteger(MAX_SAFE_CANONICAL_INTEGER + 1)).toThrow()
    expect(() => fromHostInteger(MIN_SAFE_CANONICAL_INTEGER - 1)).toThrow()
  })

  test("a non-integer declared as a host integer is refused", () => {
    expect(() => fromHostInteger(1.5)).toThrow(CanonicalValueError)
  })

  test("§26 sets no upper bound on an already-canonical binary64", () => {
    expect(fromHostFloat64(1.7976931348623157e308)).toBe(1.7976931348623157e308)
    expect(fromHostFloat64(5e-324)).toBe(5e-324)
  })
})

/* ------------------------------------------------------------------ */
/* §26 — negative zero                                                 */
/* ------------------------------------------------------------------ */

describe("§26 — -0 normalizes to +0", () => {
  test("through the float64 boundary", () => {
    expect(Object.is(fromHostFloat64(-0), 0)).toBe(true)
  })

  test("through the integer boundary", () => {
    expect(Object.is(fromHostInteger(-0), 0)).toBe(true)
  })

  test("through a whole structure", () => {
    const out = toCanonicalValue({ a: -0, b: [-0] }) as { a: number; b: number[] }
    expect(Object.is(out.a, 0)).toBe(true)
    expect(Object.is(out.b[0], 0)).toBe(true)
  })

  test("canonicalEquals still distinguishes -0 from +0 if one slips through", () => {
    // The normalization is the constructors' job; the predicate must not
    // paper over a failure to apply it, or FC-31A could pass on a
    // substrate that persists -0.
    expect(canonicalEquals(-0, 0)).toBe(false)
  })
})

/* ------------------------------------------------------------------ */
/* §29 — strings                                                       */
/* ------------------------------------------------------------------ */

describe("§29 — no implicit Unicode normalization", () => {
  test("a combining sequence is not composed", () => {
    const decomposed = String.fromCodePoint(0x0065, 0x0301)
    const composed = String.fromCodePoint(0x00e9)
    const out = toCanonicalValue(decomposed) as string
    expect(out).toBe(decomposed)
    expect(out).not.toBe(composed)
    expect([...out].length).toBe(2)
  })

  test("U+0000 round-trips exactly and does not truncate", () => {
    const withNul = String.fromCodePoint(0x0061, 0x0000, 0x0062)
    const out = toCanonicalValue(withNul) as string
    expect(out).toBe(withNul)
    expect(out.length).toBe(3)
    expect(out.codePointAt(1)).toBe(0)
  })

  test("a ZWJ emoji keeps its three code points", () => {
    const zwj = String.fromCodePoint(0x1f468, 0x200d, 0x1f4bb)
    expect(toCanonicalValue(zwj)).toBe(zwj)
    expect([...zwj].length).toBe(3)
  })
})

/* ------------------------------------------------------------------ */
/* §28, §58 — time                                                     */
/* ------------------------------------------------------------------ */

describe("§28 / §58 — CanonicalTimestamp", () => {
  test("a host date in a timestamp-typed field converts", () => {
    expect(canonicalTimestampFromHostDate(new Date(1_672_531_200_000))).toBe(
      1_672_531_200_000 as never,
    )
  })

  test("a host date outside a timestamp-typed field is UNSUPPORTED_HOST_TYPE", () => {
    try {
      toCanonicalValue({ when: new Date(0) })
      throw new Error("should have thrown")
    } catch (error) {
      expect(error).toBeInstanceOf(CanonicalValueError)
      expect((error as CanonicalValueError).code).toBe("UNSUPPORTED_HOST_TYPE")
    }
  })

  test("the same instant yields the same canonical value under any host timezone", () => {
    // §58 asks for several host timezones. Bun honours TZ per process, so
    // the portable in-process check is that conversion reads the absolute
    // instant and never a local-time field.
    const instant = 1_672_531_200_000
    const fromEpoch = canonicalTimestampFromEpochMs(instant)
    const fromDate = canonicalTimestampFromHostDate(new Date(instant))
    expect(fromDate).toBe(fromEpoch)
    // A local-time reading would differ from getTime() by the offset.
    expect(new Date(instant).getTime()).toBe(instant)
  })

  test("a non-integer millisecond value is NON_CANONICAL_TIME", () => {
    try {
      canonicalTimestampFromEpochMs(1.5)
      throw new Error("should have thrown")
    } catch (error) {
      expect((error as CanonicalValueError).code).toBe("NON_CANONICAL_TIME")
    }
  })

  test("§58 — an out-of-range instant errors rather than clamping", () => {
    // A JS Date cannot hold ±(2^53−1) ms; it caps at ±8.64e15. The contract
    // requires an explicit error, never a silent clamp or truncation.
    const beyondDate = new Date(8.64e15 + 1)
    expect(Number.isNaN(beyondDate.getTime())).toBe(true)
    expect(() => canonicalTimestampFromHostDate(beyondDate)).toThrow(CanonicalValueError)
    expect(() => canonicalTimestampFromEpochMs(9_007_199_254_740_992)).toThrow(
      CanonicalValueError,
    )
  })
})

/* ------------------------------------------------------------------ */
/* §25, §30 — host types with no canonical form                        */
/* ------------------------------------------------------------------ */

describe("§25 / §30 — refused host types", () => {
  const refused: ReadonlyArray<[string, unknown]> = [
    ["undefined", undefined],
    ["BigInt", 1n],
    ["function", () => 1],
    ["symbol", Symbol("s")],
    ["Map", new Map()],
    ["Set", new Set()],
    ["Uint8Array", new Uint8Array([1])],
    ["ArrayBuffer", new ArrayBuffer(1)],
    ["class instance", new SomeClass()],
    ["Date", new Date()],
  ]

  for (const [label, value] of refused) {
    test(`${label} is refused with UNSUPPORTED_HOST_TYPE`, () => {
      try {
        toCanonicalValue(value)
        throw new Error("should have thrown")
      } catch (error) {
        expect(error).toBeInstanceOf(CanonicalValueError)
        expect((error as CanonicalValueError).code).toBe("UNSUPPORTED_HOST_TYPE")
      }
    })
  }

  test("NaN and infinities are NON_FINITE_NUMBER, not UNSUPPORTED_HOST_TYPE", () => {
    for (const value of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      try {
        toCanonicalValue(value)
        throw new Error("should have thrown")
      } catch (error) {
        expect((error as CanonicalValueError).code).toBe("NON_FINITE_NUMBER")
      }
    }
  })

  test("the error path names the offending location", () => {
    try {
      toCanonicalValue({ outer: { inner: [1, undefined] } })
      throw new Error("should have thrown")
    } catch (error) {
      expect((error as CanonicalValueError).path).toBe("$.outer.inner[1]")
    }
  })

  test("refs pass through as tagged objects", () => {
    const ref = { $ref: "artifact", artifactId: "a-1" }
    expect(toCanonicalValue(ref)).toEqual(ref)
    expect(toCanonicalValue({ $ref: "secret", secretId: "s-1" })).toEqual({
      $ref: "secret",
      secretId: "s-1",
    })
  })
})

/* ------------------------------------------------------------------ */
/* Equality predicate                                                  */
/* ------------------------------------------------------------------ */

describe("canonicalEquals — the round-trip predicate", () => {
  test("objects compare as unordered key sets", () => {
    expect(canonicalEquals({ a: 1, b: 2 }, { b: 2, a: 1 })).toBe(true)
  })

  test("arrays remain ordered", () => {
    expect(canonicalEquals([1, 2], [2, 1])).toBe(false)
  })

  test("a missing key is not equal to an undefined one", () => {
    expect(canonicalEquals({ a: 1 }, { a: 1, b: null })).toBe(false)
  })

  test("nested structures compare deeply", () => {
    expect(canonicalEquals({ a: [{ b: "x" }] }, { a: [{ b: "x" }] })).toBe(true)
    expect(canonicalEquals({ a: [{ b: "x" }] }, { a: [{ b: "y" }] })).toBe(false)
  })

  test("strings compare by code unit, so U+0000 is significant", () => {
    expect(canonicalEquals("a b", "ab")).toBe(false)
  })

  test("types do not coerce", () => {
    expect(canonicalEquals(1, "1" as unknown as UnifiaValue)).toBe(false)
    expect(canonicalEquals(null, false)).toBe(false)
  })
})

/* ------------------------------------------------------------------ */
/* Contract hygiene                                                    */
/* ------------------------------------------------------------------ */

describe("§31 — canonical error codes are a closed set", () => {
  test("every declared code is distinct", () => {
    expect(new Set(CANONICAL_ERROR_CODES).size).toBe(CANONICAL_ERROR_CODES.length)
  })

  test("every code the vector expects is declared", () => {
    const declared = new Set<string>(CANONICAL_ERROR_CODES)
    for (const one of M0_UNIFIAVALUE_VECTOR_V1) {
      if (one.expect.outcome === "reject") {
        expect(declared.has(one.expect.code)).toBe(true)
      }
    }
  })
})
