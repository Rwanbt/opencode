/* SPDX-License-Identifier: MIT */
/* Copyright (c) 2026 Unifia contributors */

/**
 * FC-31A / FC-31B canonical value qualification vectors.
 *
 * Per pack gelé §16 / §17, the harness drives the same fixture set
 * through both candidates. The fixture is shared at the BYTE level —
 * one physical file consumed by both adapters. Each value in the
 * fixture is **already canonical**; FC-31A is a round-trip, not a
 * conversion, and the harness must not "fix" a bad value on the way
 * in.
 *
 * 0, ±0 normalisation
 * 1, -1
 * MAX_SAFE, MAX_SAFE+1
 * -MAX_SAFE, -MAX_SAFE-1
 * 0.5, -0.5
 * smallest subnormal, smallest normal, max finite
 * U+0000 (legal character — §29 forbids NFC/NFD normalization)
 * CanonicalTimestamp
 * object + array + nested structures
 */

import {
  fromHostFloat64,
  fromHostInteger,
  canonicalTimestampFromEpochMs,
  type UnifiaValue,
} from "@unifia/automate-m0-contract"

/* ------------------------------------------------------------------ */
/* Bit patterns for binary64 (per pack gelé §16)                       */
/* ------------------------------------------------------------------ */

export const BINARY64_SMALLEST_SUBNORMAL = 0x0000000000000001n // 5e-324
export const BINARY64_SMALLEST_NORMAL = 0x0010000000000000n // 2.2250738585072014e-308
export const BINARY64_MAX_FINITE = 0x7fefffffffffffffn // 1.7976931348623157e+308
export const BINARY64_NEGATIVE_ZERO = 0x8000000000000000n // -0
export const BINARY64_ONE = 0x3ff0000000000000n // 1
export const BINARY64_NEG_ONE = 0xbff0000000000000n // -1
export const BINARY64_HALF = 0x3fe0000000000000n // 0.5
export const BINARY64_NEG_HALF = 0xbfe0000000000000n // -0.5
export const BINARY64_MAX_SAFE = 0x433fffffffffffffn // 9007199254740991 (2^53 - 1)
export const BINARY64_MAX_SAFE_PLUS_ONE = 0x4340000000000000n // 9007199254740992 (2^53)
export const BINARY64_NEG_MAX_SAFE = 0xc33fffffffffffffn // -9007199254740991
export const BINARY64_NEG_MAX_SAFE_MINUS_ONE = 0xc340000000000000n // -9007199254740992

/** Reinterpret a BigInt bit pattern as a float64 (host IEEE-754). */
export function bitsToFloat64(bits: bigint): number {
  const buf = new ArrayBuffer(8)
  const view = new DataView(buf)
  // BigInt.to_bytes(8, 'little') returns Uint8Array in Python semantics.
  // We use manual byte construction.
  let n = bits
  for (let i = 0; i < 8; i++) {
    view.setUint8(i, Number(n & 0xffn))
    n >>= 8n
  }
  return view.getFloat64(0, true /* little-endian */)
}

/* ------------------------------------------------------------------ */
/* FC-31A vector: already-canonical values                             */
/* ------------------------------------------------------------------ */

export interface FC31AValue {
  readonly name: string
  readonly value: UnifiaValue
  /** Bit pattern this value should round-trip as. */
  readonly bitPattern: bigint
}

export const FC_31A_VALUES: readonly FC31AValue[] = [
  {
    name: "zero",
    value: fromHostFloat64(0),
    bitPattern: 0n,
  },
  {
    name: "negative-zero-normalizes-to-positive-zero",
    value: fromHostFloat64(-0),
    bitPattern: 0n, // -0 must round-trip as +0 (§26)
  },
  {
    name: "one",
    value: fromHostFloat64(1),
    bitPattern: BINARY64_ONE,
  },
  {
    name: "negative-one",
    value: fromHostFloat64(-1),
    bitPattern: BINARY64_NEG_ONE,
  },
  {
    name: "max-safe-integer-as-float",
    value: fromHostFloat64(9_007_199_254_740_991),
    bitPattern: BINARY64_MAX_SAFE,
  },
  {
    name: "max-safe-plus-one-as-float",
    value: fromHostFloat64(9_007_199_254_740_992),
    bitPattern: BINARY64_MAX_SAFE_PLUS_ONE,
  },
  {
    name: "negative-max-safe-as-float",
    value: fromHostFloat64(-9_007_199_254_740_991),
    bitPattern: BINARY64_NEG_MAX_SAFE,
  },
  {
    name: "negative-max-safe-minus-one-as-float",
    value: fromHostFloat64(-9_007_199_254_740_992),
    bitPattern: BINARY64_NEG_MAX_SAFE_MINUS_ONE,
  },
  {
    name: "one-half",
    value: fromHostFloat64(0.5),
    bitPattern: BINARY64_HALF,
  },
  {
    name: "negative-one-half",
    value: fromHostFloat64(-0.5),
    bitPattern: BINARY64_NEG_HALF,
  },
  {
    name: "smallest-positive-subnormal",
    value: fromHostFloat64(bitsToFloat64(BINARY64_SMALLEST_SUBNORMAL)),
    bitPattern: BINARY64_SMALLEST_SUBNORMAL,
  },
  {
    name: "smallest-positive-normal",
    value: fromHostFloat64(bitsToFloat64(BINARY64_SMALLEST_NORMAL)),
    bitPattern: BINARY64_SMALLEST_NORMAL,
  },
  {
    name: "largest-finite",
    value: fromHostFloat64(bitsToFloat64(BINARY64_MAX_FINITE)),
    bitPattern: BINARY64_MAX_FINITE,
  },
  {
    name: "uplus-0000-character",
    value: "\u0000",
    bitPattern: 0n, // not a number — bit pattern is for numbers only
  },
  {
    name: "unicode-ff",
    value: "\u00FF",
    bitPattern: 0n,
  },
  {
    name: "canonical-timestamp-zero",
    value: canonicalTimestampFromEpochMs(0),
    bitPattern: 0n,
  },
  {
    name: "canonical-timestamp-positive",
    value: canonicalTimestampFromEpochMs(1_700_000_000_000),
    bitPattern: 0n,
  },
  {
    name: "nested-object",
    value: {
      name: "fixture",
      values: [0, 1, 2, 3],
      meta: { when: canonicalTimestampFromEpochMs(0), ok: true },
    },
    bitPattern: 0n,
  },
  {
    name: "deep-array",
    value: [[[null, true, false, ""]]],
    bitPattern: 0n,
  },
  {
    name: "artifact-ref",
    value: { $ref: "artifact", artifactId: "art-1" },
    bitPattern: 0n,
  },
  {
    name: "secret-ref",
    value: { $ref: "secret", secretId: "sec-1" },
    bitPattern: 0n,
  },
]

/* ------------------------------------------------------------------ */
/* FC-31B vector: host-integer semantics                                */
/* ------------------------------------------------------------------ */

export interface FC31BVector {
  readonly name: string
  /** "fromHostFloat64" or "fromHostInteger" — what the harness is testing. */
  readonly adapter: "fromHostFloat64" | "fromHostInteger"
  readonly input: number | bigint | string
  /** Whether the canonical conversion should accept or reject. */
  readonly expected: "PASS" | "REJECT"
  /** If REJECT, the canonical error code expected. */
  readonly expectedErrorCode?: "NUMBER_OUT_OF_CANONICAL_RANGE" | "UNSUPPORTED_HOST_TYPE" | "UNSUPPORTED_CANONICAL_VALUE" | "NON_FINITE_NUMBER" | "NON_CANONICAL_TIME"
}

export const FC_31B_VECTORS: readonly FC31BVector[] = [
  // From pack gelé §17
  { name: "host-float64-max-safe-plus-one", adapter: "fromHostFloat64", input: 9_007_199_254_740_992, expected: "PASS" },
  { name: "host-integer-max-safe-plus-one", adapter: "fromHostInteger", input: 9_007_199_254_740_992, expected: "REJECT", expectedErrorCode: "NUMBER_OUT_OF_CANONICAL_RANGE" },
  { name: "host-integer-max-safe", adapter: "fromHostInteger", input: 9_007_199_254_740_991, expected: "PASS" },
  { name: "host-integer-min-safe", adapter: "fromHostInteger", input: -9_007_199_254_740_991, expected: "PASS" },
  { name: "host-integer-over-max", adapter: "fromHostInteger", input: 9_007_199_254_740_992n, expected: "REJECT", expectedErrorCode: "NUMBER_OUT_OF_CANONICAL_RANGE" },
  { name: "host-integer-bigint-over-max", adapter: "fromHostInteger", input: 9_223_372_036_854_775_807n /* Go int64 max */, expected: "REJECT", expectedErrorCode: "NUMBER_OUT_OF_CANONICAL_RANGE" },
  { name: "host-integer-bigint-under-min", adapter: "fromHostInteger", input: -9_223_372_036_854_775_808n /* Go int64 min */, expected: "REJECT", expectedErrorCode: "NUMBER_OUT_OF_CANONICAL_RANGE" },
  { name: "host-float64-zero", adapter: "fromHostFloat64", input: 0, expected: "PASS" },
  { name: "host-float64-negative-zero", adapter: "fromHostFloat64", input: -0, expected: "PASS" },
  { name: "host-float-nan", adapter: "fromHostFloat64", input: Number.NaN, expected: "REJECT", expectedErrorCode: "NON_FINITE_NUMBER" },
  { name: "host-float-positive-infinity", adapter: "fromHostFloat64", input: Number.POSITIVE_INFINITY, expected: "REJECT", expectedErrorCode: "NON_FINITE_NUMBER" },
  { name: "host-integer-float", adapter: "fromHostInteger", input: 1.5, expected: "REJECT", expectedErrorCode: "UNSUPPORTED_CANONICAL_VALUE" },
  { name: "host-string-as-number", adapter: "fromHostInteger", input: "42", expected: "REJECT", expectedErrorCode: "UNSUPPORTED_HOST_TYPE" },
]
