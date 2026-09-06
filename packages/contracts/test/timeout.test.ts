/* SPDX-License-Identifier: MIT */
/* Copyright (c) 2026 Unifia contributors */

/**
 * M3-09 — `TimeoutConfigSchema` + `resolveEffectiveDeadline` (Plan V2.3.1 §200,
 * ADR-022).
 *
 * M3-09 is the ninth card in the M3 Effect / Timer / Cancellation round.
 * It consolidates the loose `timeoutMs` (per-node) and `defaultTimeoutMs`
 * (per-workflow) fields into a single discriminated union with three kinds:
 *
 *   - `none`     : no timeout — the workflow's overall deadline applies.
 *   - `fixed`    : a hard upper bound on the node's duration (ms, positive,
 *                  ≤ 24h).
 *   - `deadline` : an absolute wall-clock deadline (Unix ms, positive).
 *
 * The contract is **contract-only** here: runtime enforcement (the timer
 * that kills a node past its deadline) waits on ADR-000. The contract
 * must already be parseable, validated, and reason-about-able without a
 * kernel.
 *
 * Locked invariants (regression net):
 *   (1) All three `kind` values parse — `none`, `fixed`, `deadline`.
 *   (2) `fixed` rejects 0, negative, non-integer, and over-24h durations.
 *   (3) `deadline` rejects 0 and negative `deadlineAt` values.
 *   (4) The discriminator is mandatory: a config without `kind`, or with
 *       an unknown literal, is rejected.
 *   (5) `parseTimeoutConfig` round-trips valid inputs and throws
 *       `ZodError` on invalid ones.
 *   (6) `resolveEffectiveDeadline` is a pure function: it never reads the
 *       wall clock, never allocates past a single return value, and
 *       covers all three kinds correctly.
 */
import { describe, expect, test } from "bun:test"
import {
  TimeoutConfigSchema,
  parseTimeoutConfig,
  resolveEffectiveDeadline,
  TIMEOUT_MAX_DURATION_MS,
  type TimeoutConfig,
} from "../src/timeout.ts"

describe("TimeoutConfigSchema — happy path (1)", () => {
  test("(1) ParsesNone — { kind: 'none' } parses with no extra fields", () => {
    const parsed = TimeoutConfigSchema.parse({ kind: "none" })
    expect(parsed.kind).toBe("none")
  })

  test("(2) ParsesFixed — { kind: 'fixed', maxDurationMs: 60_000 } parses", () => {
    const parsed = TimeoutConfigSchema.parse({
      kind: "fixed",
      maxDurationMs: 60_000,
    })
    if (parsed.kind !== "fixed") throw new Error("discriminator should be fixed")
    expect(parsed.maxDurationMs).toBe(60_000)
  })

  test("(3) ParsesDeadline — { kind: 'deadline', deadlineAt: 1_700_000_000_000 } parses", () => {
    const parsed = TimeoutConfigSchema.parse({
      kind: "deadline",
      deadlineAt: 1_700_000_000_000,
    })
    if (parsed.kind !== "deadline")
      throw new Error("discriminator should be deadline")
    expect(parsed.deadlineAt).toBe(1_700_000_000_000)
  })
})

describe("TimeoutConfigSchema — rejection of `fixed` (2)", () => {
  test("(4) RejectsZeroMaxDuration — maxDurationMs: 0 is rejected", () => {
    expect(() =>
      TimeoutConfigSchema.parse({ kind: "fixed", maxDurationMs: 0 }),
    ).toThrow()
  })

  test("(5) RejectsTooLargeMaxDuration — maxDurationMs > 24h is rejected", () => {
    expect(() =>
      TimeoutConfigSchema.parse({
        kind: "fixed",
        maxDurationMs: TIMEOUT_MAX_DURATION_MS + 1,
      }),
    ).toThrow()
  })

  test("(6) RejectsNonIntegerMaxDuration — maxDurationMs: 1.5 is rejected", () => {
    expect(() =>
      TimeoutConfigSchema.parse({ kind: "fixed", maxDurationMs: 1.5 }),
    ).toThrow()
  })
})

describe("TimeoutConfigSchema — rejection of `deadline` (3)", () => {
  test("(7) RejectsZeroDeadlineAt — deadlineAt: 0 is rejected", () => {
    expect(() =>
      TimeoutConfigSchema.parse({ kind: "deadline", deadlineAt: 0 }),
    ).toThrow()
  })

  test("(8) RejectsNegativeDeadlineAt — deadlineAt: -1 is rejected", () => {
    expect(() =>
      TimeoutConfigSchema.parse({ kind: "deadline", deadlineAt: -1 }),
    ).toThrow()
  })
})

describe("TimeoutConfigSchema — rejection of `kind` (4)", () => {
  test("(9) RejectsUnknownKind — kind: 'maybe' is rejected", () => {
    expect(() => TimeoutConfigSchema.parse({ kind: "maybe" })).toThrow()
  })

  test("(10) RejectsMissingKind — config without `kind` is rejected", () => {
    expect(() => TimeoutConfigSchema.parse({})).toThrow()
  })
})

describe("parseTimeoutConfig — wrapper helper (5)", () => {
  test("(11) RoundTripsValid — all 3 kinds round-trip through parseTimeoutConfig", () => {
    const none: TimeoutConfig = parseTimeoutConfig({ kind: "none" })
    expect(none.kind).toBe("none")

    const fixed: TimeoutConfig = parseTimeoutConfig({
      kind: "fixed",
      maxDurationMs: 5_000,
    })
    expect(fixed.kind).toBe("fixed")
    if (fixed.kind === "fixed") expect(fixed.maxDurationMs).toBe(5_000)

    const deadline: TimeoutConfig = parseTimeoutConfig({
      kind: "deadline",
      deadlineAt: 1_700_000_000_000,
    })
    expect(deadline.kind).toBe("deadline")
    if (deadline.kind === "deadline")
      expect(deadline.deadlineAt).toBe(1_700_000_000_000)
  })

  test("(12) ThrowsOnInvalid — wrong shape throws ZodError", () => {
    expect(() => parseTimeoutConfig({ kind: "fixed" })).toThrow()
    expect(() => parseTimeoutConfig({ kind: "deadline" })).toThrow()
    expect(() => parseTimeoutConfig("not an object")).toThrow()
    expect(() => parseTimeoutConfig(null)).toThrow()
  })
})

describe("resolveEffectiveDeadline — pure helper (6)", () => {
  test("(13) NoneReturnsNull — kind: 'none' resolves to null regardless of start", () => {
    const config: TimeoutConfig = { kind: "none" }
    expect(resolveEffectiveDeadline(config, 0)).toBeNull()
    expect(resolveEffectiveDeadline(config, 1_700_000_000_000)).toBeNull()
  })

  test("(14) FixedAddsToStart — kind: 'fixed' resolves to startMs + maxDurationMs", () => {
    const config: TimeoutConfig = { kind: "fixed", maxDurationMs: 5_000 }
    expect(resolveEffectiveDeadline(config, 1_000)).toBe(6_000)
    expect(resolveEffectiveDeadline(config, 0)).toBe(5_000)
  })

  test("(15) DeadlineReturnsItself — kind: 'deadline' resolves to deadlineAt (start ignored)", () => {
    const config: TimeoutConfig = {
      kind: "deadline",
      deadlineAt: 1_700_000_000_000,
    }
    expect(resolveEffectiveDeadline(config, 0)).toBe(1_700_000_000_000)
    // start is intentionally ignored for `deadline` — verify with a
    // different start producing the same answer.
    expect(resolveEffectiveDeadline(config, 999_999_999)).toBe(1_700_000_000_000)
  })
})
