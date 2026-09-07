/* SPDX-License-Identifier: MIT */
/* Copyright (c) 2026 Unifia contributors */

/**
 * `UnifiaValue` — the canonical durable value domain (ADR-000 §25-§31).
 *
 * Every value a substrate persists on Unifia's behalf must be expressible
 * here. The domain is deliberately narrower than any host language's, so
 * that two candidates written in different languages (a TypeScript native
 * kernel, a Go DBOS adapter) round-trip the *same* semantics rather than
 * each language's incidental ones.
 *
 * ADR-000 §82 forbids "host-language serialization semantics as Unifia
 * semantics". This module is where that prohibition is enforced.
 *
 * ─────────────────────────────────────────────────────────────────────
 * THE CENTRAL SUBTLETY — why there are two number entry points
 * ─────────────────────────────────────────────────────────────────────
 *
 * ADR-000 §27 requires this pair of outcomes, and calls the distinction
 * deliberate:
 *
 *     host float64 9007199254740992  → PASS
 *     host int64   9007199254740992  → REJECT
 *
 * The reason is §26 versus §27. A value that is *already canonical* is any
 * finite binary64, with no 2^53 bound — 2^53 itself is exactly
 * representable, so `9007199254740992.0` is a perfectly good UnifiaNumber.
 * But a *host integer* carries an exactness promise binary64 cannot keep
 * past 2^53−1: `9007199254740993` has no binary64 representation, so
 * silently accepting integers above the safe range would let a substrate
 * persist a number that is not the one the caller meant.
 *
 * In JavaScript there is no int64 — a `number` *is* a float64. The
 * distinction therefore cannot be recovered from the runtime value; it
 * lives in what the caller *meant*. So the boundary exposes two functions,
 * and the caller declares intent by choosing one:
 *
 *     fromHostFloat64(9007199254740992)  → ok    (§26: finite binary64)
 *     fromHostInteger(9007199254740992)  → error (§27: outside safe range)
 *
 * A single "smart" entry point that guessed from `Number.isInteger()` would
 * make the two cases indistinguishable and silently violate §27. This is
 * the one place where a slightly wider API is the correct design.
 */

/* ------------------------------------------------------------------ */
/* Canonical errors (§31)                                              */
/* ------------------------------------------------------------------ */

/**
 * The closed set of canonical error codes. Host exceptions (a Go panic, a
 * JS TypeError, a Rust panic) are **not authoritative** (§31) — every
 * refusal at this boundary must surface as one of these.
 */
export const CANONICAL_ERROR_CODES = [
  "UNSUPPORTED_CANONICAL_VALUE",
  "NUMBER_OUT_OF_CANONICAL_RANGE",
  "NON_FINITE_NUMBER",
  "UNSUPPORTED_HOST_TYPE",
  "NON_CANONICAL_TIME",
] as const

export type CanonicalErrorCode = (typeof CANONICAL_ERROR_CODES)[number]

export class CanonicalValueError extends Error {
  readonly code: CanonicalErrorCode
  /** Location of the offending value inside the converted structure. */
  readonly path: string

  constructor(code: CanonicalErrorCode, message: string, path = "") {
    super(path === "" ? message : `${message} (at ${path})`)
    this.name = "CanonicalValueError"
    this.code = code
    this.path = path
  }
}

/* ------------------------------------------------------------------ */
/* Canonical domain (§25, §26, §28)                                    */
/* ------------------------------------------------------------------ */

/**
 * Any finite IEEE-754 binary64 value (§26). `NaN`, `+Infinity` and
 * `-Infinity` are outside the domain. `-0` is normalized to `+0`.
 *
 * There is **no** general ±(2^53−1) bound on an already-canonical number —
 * `1.7976931348623157e308` and `5e-324` are both valid.
 */
export type UnifiaNumber = number

/**
 * Signed Unix epoch milliseconds in UTC (§28), conceptually an exact
 * integer, bounded to ±(2^53−1) so it stays exactly representable.
 *
 * A `CanonicalTimestamp` is only produced where a schema explicitly
 * expects one. A bare host date object anywhere else is
 * `UNSUPPORTED_HOST_TYPE` (§30).
 */
export type CanonicalTimestamp = number & { readonly __canonicalTimestamp: unique symbol }

/** Reference to bytes owned by the ArtifactStore (§37). Never inline bytes. */
export interface ArtifactRef {
  readonly $ref: "artifact"
  readonly artifactId: string
}

/** Reference to secret material. The material itself is never durable (§25). */
export interface SecretRef {
  readonly $ref: "secret"
  readonly secretId: string
}

export interface CredentialRef {
  readonly $ref: "credential"
  readonly credentialId: string
}

export type UnifiaRef = ArtifactRef | SecretRef | CredentialRef

export type UnifiaValue =
  | null
  | boolean
  | string
  | UnifiaNumber
  | UnifiaRef
  | readonly UnifiaValue[]
  | { readonly [key: string]: UnifiaValue }

/* ------------------------------------------------------------------ */
/* Numeric bounds                                                      */
/* ------------------------------------------------------------------ */

/** Largest host integer convertible without losing exactness (§27). */
export const MAX_SAFE_CANONICAL_INTEGER = 9_007_199_254_740_991

/** Smallest host integer convertible without losing exactness (§27). */
export const MIN_SAFE_CANONICAL_INTEGER = -9_007_199_254_740_991

/** Inclusive bounds of a CanonicalTimestamp, in milliseconds (§28). */
export const MAX_CANONICAL_TIMESTAMP_MS = 9_007_199_254_740_991
export const MIN_CANONICAL_TIMESTAMP_MS = -9_007_199_254_740_991

/* ------------------------------------------------------------------ */
/* Host → canonical: numbers (§26, §27)                                */
/* ------------------------------------------------------------------ */

/**
 * Convert a host float64 to a `UnifiaNumber` (§26).
 *
 * Accepts **any finite binary64**, including values above 2^53 — those are
 * exact binary64 values and §26 sets no upper bound on an already-canonical
 * number. Rejects non-finite values and normalizes `-0` to `+0`.
 *
 * Use this when the host value is genuinely a float. For a value that
 * carries an *integer* exactness promise, use `fromHostInteger` — the two
 * differ on purpose, see the module header.
 */
export function fromHostFloat64(value: number, path = ""): UnifiaNumber {
  if (typeof value !== "number") {
    throw new CanonicalValueError(
      "UNSUPPORTED_HOST_TYPE",
      `expected a host float64, got ${typeof value}`,
      path,
    )
  }
  if (Number.isNaN(value)) {
    throw new CanonicalValueError("NON_FINITE_NUMBER", "NaN is not canonical", path)
  }
  if (!Number.isFinite(value)) {
    throw new CanonicalValueError(
      "NON_FINITE_NUMBER",
      `${value > 0 ? "+Infinity" : "-Infinity"} is not canonical`,
      path,
    )
  }
  // §26: -0 normalizes to +0. Object.is distinguishes them; `=== 0` does not.
  return Object.is(value, -0) ? 0 : value
}

/**
 * Convert a host **integer** — a typed integer in Go/Rust, or a JS
 * `number`/`BigInt` the caller declares as an integer — to a
 * `UnifiaNumber` (§27).
 *
 * Conversion is permitted only within [MIN_SAFE, MAX_SAFE]. Outside that
 * window binary64 can no longer hold every integer, so accepting the value
 * would silently change it: `NUMBER_OUT_OF_CANONICAL_RANGE`.
 *
 * This is why `fromHostInteger(9007199254740992)` fails while
 * `fromHostFloat64(9007199254740992)` succeeds. Same bits, different
 * promise.
 */
export function fromHostInteger(value: number | bigint, path = ""): UnifiaNumber {
  if (typeof value === "bigint") {
    if (
      value > BigInt(MAX_SAFE_CANONICAL_INTEGER) ||
      value < BigInt(MIN_SAFE_CANONICAL_INTEGER)
    ) {
      throw new CanonicalValueError(
        "NUMBER_OUT_OF_CANONICAL_RANGE",
        `BigInt ${value} is outside the canonical safe integer range`,
        path,
      )
    }
    return Number(value)
  }
  if (typeof value !== "number") {
    throw new CanonicalValueError(
      "UNSUPPORTED_HOST_TYPE",
      `expected a host integer, got ${typeof value}`,
      path,
    )
  }
  if (!Number.isFinite(value)) {
    throw new CanonicalValueError(
      "NON_FINITE_NUMBER",
      "a host integer must be finite",
      path,
    )
  }
  if (!Number.isInteger(value)) {
    throw new CanonicalValueError(
      "UNSUPPORTED_CANONICAL_VALUE",
      `${value} was declared as a host integer but is not one`,
      path,
    )
  }
  if (value > MAX_SAFE_CANONICAL_INTEGER || value < MIN_SAFE_CANONICAL_INTEGER) {
    throw new CanonicalValueError(
      "NUMBER_OUT_OF_CANONICAL_RANGE",
      `integer ${value} is outside the canonical safe integer range`,
      path,
    )
  }
  return Object.is(value, -0) ? 0 : value
}

/* ------------------------------------------------------------------ */
/* Host → canonical: time (§28)                                        */
/* ------------------------------------------------------------------ */

/**
 * Build a `CanonicalTimestamp` from epoch milliseconds. Only called where
 * a schema explicitly expects a timestamp (§28) — never as a fallback for
 * a stray date object.
 */
export function canonicalTimestampFromEpochMs(
  epochMs: number,
  path = "",
): CanonicalTimestamp {
  if (typeof epochMs !== "number" || !Number.isFinite(epochMs)) {
    throw new CanonicalValueError(
      "NON_CANONICAL_TIME",
      "a CanonicalTimestamp must be a finite number of epoch milliseconds",
      path,
    )
  }
  if (!Number.isInteger(epochMs)) {
    throw new CanonicalValueError(
      "NON_CANONICAL_TIME",
      `a CanonicalTimestamp is an exact integer; got ${epochMs}`,
      path,
    )
  }
  if (epochMs > MAX_CANONICAL_TIMESTAMP_MS || epochMs < MIN_CANONICAL_TIMESTAMP_MS) {
    throw new CanonicalValueError(
      "NUMBER_OUT_OF_CANONICAL_RANGE",
      `CanonicalTimestamp ${epochMs} ms is outside the M0 range`,
      path,
    )
  }
  return (Object.is(epochMs, -0) ? 0 : epochMs) as CanonicalTimestamp
}

/**
 * Convert a host date object where — and only where — a schema expects a
 * timestamp (§28, §58).
 *
 * §58 is explicit that a host object which cannot represent an extreme
 * CanonicalTimestamp must raise an **explicit adapter error**: no clamping,
 * no truncation. A JS `Date` holds ±8.64e15 ms, narrower than the M0 range
 * of ±(2^53−1) ≈ ±9.007e15, so a caller reaching the edge is told rather
 * than silently given a clamped instant.
 */
export function canonicalTimestampFromHostDate(
  date: Date,
  path = "",
): CanonicalTimestamp {
  if (!(date instanceof Date)) {
    throw new CanonicalValueError(
      "UNSUPPORTED_HOST_TYPE",
      "expected a host Date in a timestamp-typed field",
      path,
    )
  }
  const epochMs = date.getTime()
  if (Number.isNaN(epochMs)) {
    throw new CanonicalValueError("NON_CANONICAL_TIME", "Invalid Date", path)
  }
  return canonicalTimestampFromEpochMs(epochMs, path)
}

/* ------------------------------------------------------------------ */
/* Host → canonical: whole structures (§25, §29, §30)                  */
/* ------------------------------------------------------------------ */

const REF_KINDS = new Set(["artifact", "secret", "credential"])

function isRef(value: object): value is UnifiaRef {
  const kind = (value as { $ref?: unknown }).$ref
  return typeof kind === "string" && REF_KINDS.has(kind)
}

/**
 * Convert an arbitrary host value to a `UnifiaValue`, refusing everything
 * outside the canonical domain (§25, §30).
 *
 * Numbers reached through this path are treated as **float64** (§26) — a
 * caller who needs host-integer semantics must convert that field with
 * `fromHostInteger` before handing the structure over. That is the same
 * intent problem described in the module header: a walker cannot read the
 * caller's mind, so it applies the rule that never silently changes a
 * value.
 *
 * Strings pass through untouched: §29 forbids implicit NFC/NFD
 * normalization, and `U+0000` is a legal character that must round-trip.
 */
export function toCanonicalValue(value: unknown, path = "$"): UnifiaValue {
  if (value === null) return null

  const type = typeof value

  if (type === "boolean") return value as boolean
  if (type === "string") return value as string
  if (type === "number") return fromHostFloat64(value as number, path)

  if (type === "undefined") {
    throw new CanonicalValueError(
      "UNSUPPORTED_HOST_TYPE",
      "undefined is not a canonical value",
      path,
    )
  }
  if (type === "bigint") {
    throw new CanonicalValueError(
      "UNSUPPORTED_HOST_TYPE",
      "BigInt has no untagged canonical form; convert it with fromHostInteger",
      path,
    )
  }
  if (type === "function" || type === "symbol") {
    throw new CanonicalValueError(
      "UNSUPPORTED_HOST_TYPE",
      `${type} is not a canonical value`,
      path,
    )
  }

  // Everything below is an object.
  if (Array.isArray(value)) {
    return value.map((item, index) => toCanonicalValue(item, `${path}[${index}]`))
  }
  if (value instanceof Date) {
    throw new CanonicalValueError(
      "UNSUPPORTED_HOST_TYPE",
      "a host Date is only canonical in a timestamp-typed field",
      path,
    )
  }
  if (value instanceof Map || value instanceof Set) {
    throw new CanonicalValueError(
      "UNSUPPORTED_HOST_TYPE",
      `${value instanceof Map ? "Map" : "Set"} is not a canonical value`,
      path,
    )
  }
  if (ArrayBuffer.isView(value) || value instanceof ArrayBuffer) {
    throw new CanonicalValueError(
      "UNSUPPORTED_HOST_TYPE",
      "raw binary must be stored as an ArtifactRef",
      path,
    )
  }

  const asObject = value as Record<string, unknown>
  if (isRef(asObject)) return asObject as unknown as UnifiaRef

  const prototype = Object.getPrototypeOf(asObject)
  if (prototype !== Object.prototype && prototype !== null) {
    throw new CanonicalValueError(
      "UNSUPPORTED_HOST_TYPE",
      "a class instance is not a canonical value",
      path,
    )
  }

  const out: Record<string, UnifiaValue> = {}
  for (const key of Object.keys(asObject)) {
    out[key] = toCanonicalValue(asObject[key], `${path}.${key}`)
  }
  return out
}

/**
 * Assert that a value is already canonical, without converting it. Used by
 * FC-31A, which round-trips **already-canonical** values and must not be
 * able to "fix" a bad one on the way in.
 */
export function assertCanonical(value: unknown, path = "$"): asserts value is UnifiaValue {
  toCanonicalValue(value, path)
}

/* ------------------------------------------------------------------ */
/* Semantic equality                                                   */
/* ------------------------------------------------------------------ */

/**
 * Exact semantic equality over the canonical domain — the FC-31A
 * round-trip predicate.
 *
 * Deliberately **not** `JSON.stringify` comparison: that would make key
 * order significant, mangle `U+0000`, and silently agree that `-0 === 0`
 * for the wrong reason. Objects compare as unordered key sets; numbers
 * compare by `Object.is` after the `-0 → +0` normalization the constructors
 * already applied, so a `-0` that slipped through is caught here.
 */
export function canonicalEquals(left: UnifiaValue, right: UnifiaValue): boolean {
  if (left === null || right === null) return left === right

  const leftType = typeof left
  if (leftType !== typeof right) return false

  if (leftType === "number") return Object.is(left, right)
  if (leftType === "boolean" || leftType === "string") return left === right

  const leftIsArray = Array.isArray(left)
  if (leftIsArray !== Array.isArray(right)) return false

  if (leftIsArray) {
    const a = left as readonly UnifiaValue[]
    const b = right as readonly UnifiaValue[]
    if (a.length !== b.length) return false
    return a.every((item, index) => canonicalEquals(item, b[index] as UnifiaValue))
  }

  const a = left as Record<string, UnifiaValue>
  const b = right as Record<string, UnifiaValue>
  const aKeys = Object.keys(a)
  const bKeys = Object.keys(b)
  if (aKeys.length !== bKeys.length) return false
  return aKeys.every(
    (key) =>
      Object.hasOwn(b, key) && canonicalEquals(a[key] as UnifiaValue, b[key] as UnifiaValue),
  )
}
