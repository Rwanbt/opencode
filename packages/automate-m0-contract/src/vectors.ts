/* SPDX-License-Identifier: MIT */
/* Copyright (c) 2026 Unifia contributors */

/**
 * `M0_UNIFIAVALUE_VECTOR_V1` — the shared conformance vector for FC-31A and
 * FC-31B (ADR-000 §53-§58, card M0-M06).
 *
 * ADR-000 §79 Gate A asks "shared fixtures identical?" and answers NO
 * DECISION if they are not. Both candidates — the TypeScript native kernel
 * and the Go DBOS adapter — must therefore consume the *same* vector, which
 * makes it a language-neutral data file rather than a TypeScript literal.
 * This module is the authoring source; `emitVectorFile()` serializes it to
 * `docs/automate/m0/fixtures/M0_UNIFIAVALUE_VECTOR_V1.json`, and the Go
 * adapter reads that JSON.
 *
 * WHY the numeric cases carry a bit pattern: card M0-M06 requires it, and
 * the reason is that a decimal literal is not a reliable way to pin a
 * binary64 across two languages' parsers. `5e-324` is a *request* for the
 * smallest positive subnormal; `0x0000000000000001` **is** it. A candidate
 * that round-trips the decimal but perturbs the bits fails, and only the
 * bit pattern can catch that.
 *
 * JSON cannot carry NaN, ±Infinity, `-0`, or a lone `U+0000` reliably, so
 * every case is described *structurally* — an encoding directive plus its
 * payload — rather than as a raw JSON value. Each candidate's adapter
 * reconstitutes the host value from the directive.
 */

/** How a case's payload is reconstituted into a host value. */
export type VectorEncoding =
  /** Payload is the literal JSON value (null, boolean, string, container). */
  | "literal"
  /** Payload is a 16-char hex big-endian IEEE-754 binary64 bit pattern. */
  | "binary64-bits"
  /** Payload is a decimal string parsed as a host float64. */
  | "float64-decimal"
  /** Payload is a decimal string parsed as a host *integer* (§27 semantics). */
  | "host-integer"
  /** Payload is a decimal string parsed as an arbitrary-precision integer. */
  | "host-bigint"
  /** Payload is an array of Unicode code points, built into a string. */
  | "codepoints"
  /** Payload is epoch milliseconds for a timestamp-typed field (§28). */
  | "canonical-timestamp"
  /** Payload is epoch milliseconds handed over as a host date object. */
  | "host-date"
  /** Payload names a host type with no canonical form. */
  | "host-sentinel"

export type VectorExpectation =
  | { readonly outcome: "pass"; readonly note?: string }
  | {
      readonly outcome: "pass-normalized"
      /** Bit pattern the value must hold *after* normalization. */
      readonly normalizedBits: string
      readonly note?: string
    }
  | { readonly outcome: "reject"; readonly code: string; readonly note?: string }

export interface VectorCase {
  readonly id: string
  /** Which failure-matrix test consumes this case. */
  readonly test: "FC-31A" | "FC-31B"
  readonly encoding: VectorEncoding
  readonly payload: unknown
  readonly expect: VectorExpectation
  /** The ADR-000 section this case is required by. */
  readonly source: string
}

/* ------------------------------------------------------------------ */
/* Bit-pattern helpers                                                 */
/* ------------------------------------------------------------------ */

/** Big-endian 16-char hex of a binary64, e.g. 5e-324 → 0000000000000001. */
export function binary64ToBits(value: number): string {
  const view = new DataView(new ArrayBuffer(8))
  view.setFloat64(0, value, false)
  let hex = ""
  for (let index = 0; index < 8; index += 1) {
    hex += (view.getUint8(index) as number).toString(16).padStart(2, "0")
  }
  return hex
}

/** Inverse of `binary64ToBits`. */
export function bitsToBinary64(bits: string): number {
  if (!/^[0-9a-f]{16}$/i.test(bits)) {
    throw new Error(`not a 16-char hex binary64 pattern: ${bits}`)
  }
  const view = new DataView(new ArrayBuffer(8))
  for (let index = 0; index < 8; index += 1) {
    view.setUint8(index, Number.parseInt(bits.slice(index * 2, index * 2 + 2), 16))
  }
  return view.getFloat64(0, false)
}

/** The three IEEE-754 landmarks card M0-M06 names explicitly. */
export const BINARY64_LANDMARKS = {
  smallestPositiveSubnormal: "0000000000000001",
  smallestPositiveNormal: "0010000000000000",
  largestFinite: "7fefffffffffffff",
} as const

/* ------------------------------------------------------------------ */
/* FC-31A — canonical round-trip (§53-§56)                             */
/* ------------------------------------------------------------------ */

const NUMBER_CASES: readonly VectorCase[] = [
  { id: "num-zero", test: "FC-31A", encoding: "float64-decimal", payload: "0", expect: { outcome: "pass" }, source: "§54" },
  { id: "num-one", test: "FC-31A", encoding: "float64-decimal", payload: "1", expect: { outcome: "pass" }, source: "§54" },
  { id: "num-minus-one", test: "FC-31A", encoding: "float64-decimal", payload: "-1", expect: { outcome: "pass" }, source: "§54" },
  {
    id: "num-max-safe-integer",
    test: "FC-31A",
    encoding: "float64-decimal",
    payload: "9007199254740991",
    expect: { outcome: "pass" },
    source: "§54",
  },
  {
    id: "num-two-pow-53",
    test: "FC-31A",
    encoding: "float64-decimal",
    payload: "9007199254740992",
    expect: {
      outcome: "pass",
      note: "§26 sets no 2^53 bound on an already-canonical binary64; contrast fc31b-integer-two-pow-53",
    },
    source: "§54",
  },
  {
    id: "num-negative-two-pow-53",
    test: "FC-31A",
    encoding: "float64-decimal",
    payload: "-9007199254740992",
    expect: { outcome: "pass" },
    source: "§54",
  },
  { id: "num-half", test: "FC-31A", encoding: "float64-decimal", payload: "0.5", expect: { outcome: "pass" }, source: "§54" },
  { id: "num-minus-half", test: "FC-31A", encoding: "float64-decimal", payload: "-0.5", expect: { outcome: "pass" }, source: "§54" },
  {
    id: "num-smallest-subnormal",
    test: "FC-31A",
    encoding: "binary64-bits",
    payload: BINARY64_LANDMARKS.smallestPositiveSubnormal,
    expect: { outcome: "pass", note: "smallest positive binary64 subnormal" },
    source: "§54 / M0-M06",
  },
  {
    id: "num-smallest-normal",
    test: "FC-31A",
    encoding: "binary64-bits",
    payload: BINARY64_LANDMARKS.smallestPositiveNormal,
    expect: { outcome: "pass", note: "smallest positive binary64 normal" },
    source: "§54 / M0-M06",
  },
  {
    id: "num-largest-finite",
    test: "FC-31A",
    encoding: "binary64-bits",
    payload: BINARY64_LANDMARKS.largestFinite,
    expect: { outcome: "pass", note: "largest finite binary64" },
    source: "§54 / M0-M06",
  },
  {
    id: "num-negative-zero",
    test: "FC-31A",
    encoding: "binary64-bits",
    payload: "8000000000000000",
    expect: {
      outcome: "pass-normalized",
      normalizedBits: "0000000000000000",
      note: "§26: -0 normalizes to +0",
    },
    source: "§54",
  },
  {
    id: "num-nan",
    test: "FC-31A",
    encoding: "binary64-bits",
    payload: "7ff8000000000000",
    expect: { outcome: "reject", code: "NON_FINITE_NUMBER" },
    source: "§54",
  },
  {
    id: "num-positive-infinity",
    test: "FC-31A",
    encoding: "binary64-bits",
    payload: "7ff0000000000000",
    expect: { outcome: "reject", code: "NON_FINITE_NUMBER" },
    source: "§54",
  },
  {
    id: "num-negative-infinity",
    test: "FC-31A",
    encoding: "binary64-bits",
    payload: "fff0000000000000",
    expect: { outcome: "reject", code: "NON_FINITE_NUMBER" },
    source: "§54",
  },
]

const STRING_CASES: readonly VectorCase[] = [
  { id: "str-empty", test: "FC-31A", encoding: "literal", payload: "", expect: { outcome: "pass" }, source: "§55" },
  { id: "str-ascii", test: "FC-31A", encoding: "literal", payload: "ascii", expect: { outcome: "pass" }, source: "§55" },
  { id: "str-latin1", test: "FC-31A", encoding: "literal", payload: "é", expect: { outcome: "pass" }, source: "§55" },
  { id: "str-cjk", test: "FC-31A", encoding: "literal", payload: "日本語", expect: { outcome: "pass" }, source: "§55" },
  {
    id: "str-zwj-emoji",
    test: "FC-31A",
    encoding: "codepoints",
    payload: [0x1f468, 0x200d, 0x1f4bb],
    expect: { outcome: "pass", note: "man technologist — ZWJ sequence, 3 code points" },
    source: "§55",
  },
  {
    id: "str-combining",
    test: "FC-31A",
    encoding: "codepoints",
    payload: [0x0065, 0x0301],
    expect: {
      outcome: "pass",
      note: "e + combining acute. §29 forbids implicit NFC: must NOT become U+00E9",
    },
    source: "§55 / §29",
  },
  {
    id: "str-embedded-newline",
    test: "FC-31A",
    encoding: "codepoints",
    payload: [0x0061, 0x000a, 0x0062],
    expect: { outcome: "pass" },
    source: "§55",
  },
  {
    id: "str-nul",
    test: "FC-31A",
    encoding: "codepoints",
    payload: [0x0061, 0x0000, 0x0062],
    expect: {
      outcome: "pass",
      note: "§29: U+0000 is legal and must round-trip exactly — no C-string truncation",
    },
    source: "§55 / §29",
  },
]

const CONTAINER_CASES: readonly VectorCase[] = [
  { id: "ctr-empty-array", test: "FC-31A", encoding: "literal", payload: [], expect: { outcome: "pass" }, source: "§56" },
  { id: "ctr-empty-object", test: "FC-31A", encoding: "literal", payload: {}, expect: { outcome: "pass" }, source: "§56" },
  {
    id: "ctr-mixed-array",
    test: "FC-31A",
    encoding: "literal",
    payload: [null, true, false, 0, "x"],
    expect: { outcome: "pass" },
    source: "§56",
  },
  {
    id: "ctr-nested-arrays",
    test: "FC-31A",
    encoding: "literal",
    payload: [[1, [2, [3]]], []],
    expect: { outcome: "pass" },
    source: "§56",
  },
  {
    id: "ctr-nested-objects",
    test: "FC-31A",
    encoding: "literal",
    payload: { a: { b: { c: null } } },
    expect: { outcome: "pass" },
    source: "§56",
  },
  {
    id: "ctr-object-with-array",
    test: "FC-31A",
    encoding: "literal",
    payload: { items: [1, 2, 3] },
    expect: { outcome: "pass" },
    source: "§56",
  },
  {
    id: "ctr-array-with-object",
    test: "FC-31A",
    encoding: "literal",
    payload: [{ k: "v" }],
    expect: { outcome: "pass" },
    source: "§56",
  },
]

/* ------------------------------------------------------------------ */
/* FC-31B — host adapter conformance (§57-§58)                         */
/* ------------------------------------------------------------------ */

const HOST_INTEGER_CASES: readonly VectorCase[] = [
  {
    id: "fc31b-integer-max-safe",
    test: "FC-31B",
    encoding: "host-integer",
    payload: "9007199254740991",
    expect: { outcome: "pass" },
    source: "§57",
  },
  {
    id: "fc31b-integer-min-safe",
    test: "FC-31B",
    encoding: "host-integer",
    payload: "-9007199254740991",
    expect: { outcome: "pass" },
    source: "§57",
  },
  {
    id: "fc31b-integer-two-pow-53",
    test: "FC-31B",
    encoding: "host-integer",
    payload: "9007199254740992",
    expect: {
      outcome: "reject",
      code: "NUMBER_OUT_OF_CANONICAL_RANGE",
      note: "the deliberate contrast with num-two-pow-53 — §27",
    },
    source: "§57",
  },
  {
    id: "fc31b-integer-negative-two-pow-53",
    test: "FC-31B",
    encoding: "host-integer",
    payload: "-9007199254740992",
    expect: { outcome: "reject", code: "NUMBER_OUT_OF_CANONICAL_RANGE" },
    source: "§57",
  },
  {
    id: "fc31b-int64-max",
    test: "FC-31B",
    encoding: "host-bigint",
    payload: "9223372036854775807",
    expect: { outcome: "reject", code: "NUMBER_OUT_OF_CANONICAL_RANGE", note: "Go int64 max" },
    source: "§57",
  },
  {
    id: "fc31b-int64-min",
    test: "FC-31B",
    encoding: "host-bigint",
    payload: "-9223372036854775808",
    expect: { outcome: "reject", code: "NUMBER_OUT_OF_CANONICAL_RANGE", note: "Go int64 min" },
    source: "§57",
  },
  {
    id: "fc31b-bigint-outside-safe",
    test: "FC-31B",
    encoding: "host-bigint",
    payload: "9007199254740993",
    expect: { outcome: "reject", code: "NUMBER_OUT_OF_CANONICAL_RANGE", note: "JS BigInt outside safe range" },
    source: "§57",
  },
  {
    id: "fc31b-float64-two-pow-53",
    test: "FC-31B",
    encoding: "float64-decimal",
    payload: "9007199254740992",
    expect: {
      outcome: "pass",
      note: "same bits as fc31b-integer-two-pow-53, opposite verdict — §27 calls this deliberate",
    },
    source: "§57",
  },
]

const TIME_CASES: readonly VectorCase[] = [
  {
    id: "fc31b-ts-epoch",
    test: "FC-31B",
    encoding: "canonical-timestamp",
    payload: 0,
    expect: { outcome: "pass" },
    source: "§58",
  },
  {
    id: "fc31b-ts-negative-day",
    test: "FC-31B",
    encoding: "canonical-timestamp",
    payload: -86_400_000,
    expect: { outcome: "pass", note: "pre-epoch instants are in range" },
    source: "§58",
  },
  {
    id: "fc31b-ts-2023",
    test: "FC-31B",
    encoding: "canonical-timestamp",
    payload: 1_672_531_200_000,
    expect: { outcome: "pass" },
    source: "§58",
  },
  {
    id: "fc31b-host-date-in-typed-field",
    test: "FC-31B",
    encoding: "host-date",
    payload: 1_672_531_200_000,
    expect: {
      outcome: "pass",
      note: "must yield the same CanonicalTimestamp under every host timezone",
    },
    source: "§58",
  },
  {
    id: "fc31b-host-date-untyped",
    test: "FC-31B",
    encoding: "host-sentinel",
    payload: "date",
    expect: {
      outcome: "reject",
      code: "UNSUPPORTED_HOST_TYPE",
      note: "a generic date object outside a timestamp-typed field",
    },
    source: "§58 / §30",
  },
]

const HOST_SENTINEL_CASES: readonly VectorCase[] = [
  { id: "fc31b-undefined", test: "FC-31B", encoding: "host-sentinel", payload: "undefined", expect: { outcome: "reject", code: "UNSUPPORTED_HOST_TYPE" }, source: "§30" },
  { id: "fc31b-function", test: "FC-31B", encoding: "host-sentinel", payload: "function", expect: { outcome: "reject", code: "UNSUPPORTED_HOST_TYPE" }, source: "§30" },
  { id: "fc31b-symbol", test: "FC-31B", encoding: "host-sentinel", payload: "symbol", expect: { outcome: "reject", code: "UNSUPPORTED_HOST_TYPE" }, source: "§30" },
  { id: "fc31b-map", test: "FC-31B", encoding: "host-sentinel", payload: "map", expect: { outcome: "reject", code: "UNSUPPORTED_HOST_TYPE" }, source: "§30" },
  { id: "fc31b-set", test: "FC-31B", encoding: "host-sentinel", payload: "set", expect: { outcome: "reject", code: "UNSUPPORTED_HOST_TYPE" }, source: "§30" },
  { id: "fc31b-binary", test: "FC-31B", encoding: "host-sentinel", payload: "binary", expect: { outcome: "reject", code: "UNSUPPORTED_HOST_TYPE", note: "must become an ArtifactRef" }, source: "§30" },
  { id: "fc31b-class-instance", test: "FC-31B", encoding: "host-sentinel", payload: "class-instance", expect: { outcome: "reject", code: "UNSUPPORTED_HOST_TYPE" }, source: "§30" },
]

/* ------------------------------------------------------------------ */
/* The vector                                                          */
/* ------------------------------------------------------------------ */

export const M0_UNIFIAVALUE_VECTOR_V1: readonly VectorCase[] = [
  ...NUMBER_CASES,
  ...STRING_CASES,
  ...CONTAINER_CASES,
  ...HOST_INTEGER_CASES,
  ...TIME_CASES,
  ...HOST_SENTINEL_CASES,
]

export const M0_UNIFIAVALUE_VECTOR_VERSION = "M0_UNIFIAVALUE_VECTOR_V1"

/** Serializable form handed to every candidate, Go included. */
export function vectorDocument(): {
  version: string
  source: string
  caseCount: number
  cases: readonly VectorCase[]
} {
  return {
    version: M0_UNIFIAVALUE_VECTOR_VERSION,
    source: "ADR-000 §53-§58, card M0-M06",
    caseCount: M0_UNIFIAVALUE_VECTOR_V1.length,
    cases: M0_UNIFIAVALUE_VECTOR_V1,
  }
}
