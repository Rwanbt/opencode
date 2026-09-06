/* SPDX-License-Identifier: MIT */
/* Copyright (c) 2026 Unifia contributors */

/**
 * M3 Round 2 — M3-04 retry, M3-05 reconciliation,
 * M3-06 UNKNOWN_EXTERNAL_STATE, M3-07 compensation,
 * M3-08 wait contract (Plan V2.3.1 §200, ADR-007, ADR-008,
 * ADR-022, ADR-000).
 *
 * These are config extensions on the existing `tool.http`,
 * `human.approval` and `wait` effector families — not new node
 * families (NodeFamilySchema is unchanged, per ADR-002).
 */
import { describe, expect, test } from "bun:test"
import {
  CONTROL_RETRY_BACKOFF_MAX_MS,
  CONTROL_RETRY_MAX_ATTEMPTS,
  parseRetryPolicy,
  RetryBackoffKindSchema,
  RECONCILIATION_PROBE_MAX_CHARS,
  parseReconciliationConfig,
  ReconcileExpectedResultSchema,
  ReconcileFailOnSchema,
  UnknownExternalStateActionSchema,
  parseEffectNodeConfigWithReconciliation,
  COMPENSATION_BRANCH_ID_MAX_CHARS,
  parseCompensationBinding,
  CompensationListSchema,
  WAIT_DURATION_MAX_MS,
  parseWaitConfig,
  WaitUnitSchema,
  resolveWaitDurationMs,
  NodeSchema,
} from "../src/workflow-ir.ts"

const RETRY_FIXED = "fixed" as const
const RETRY_EXP = "exponential" as const
const RETRY_DECORR = "decorrelated-jitter" as const

/* ---------------- M3-04 retry ---------------- */

describe("M3-04 RetryPolicy", () => {
  test("1: RetryBackoffKindSchema accepts all 3 kinds, rejects 'linear'", () => {
    expect(RetryBackoffKindSchema.parse(RETRY_FIXED)).toBe(RETRY_FIXED)
    expect(RetryBackoffKindSchema.parse(RETRY_EXP)).toBe(RETRY_EXP)
    expect(RetryBackoffKindSchema.parse(RETRY_DECORR)).toBe(RETRY_DECORR)
    expect(() => RetryBackoffKindSchema.parse("linear")).toThrow()
  })

  test("2: RetryPolicySchema parses fixed + defaults (kind, maxAttempts, backoffMs=1000, jitterRatio=0.25)", () => {
    const parsed = parseRetryPolicy({ kind: RETRY_FIXED, maxAttempts: 3 })
    expect(parsed.kind).toBe(RETRY_FIXED)
    expect(parsed.maxAttempts).toBe(3)
    expect(parsed.backoffMs).toBe(1000)
    expect(parsed.jitterRatio).toBe(0.25)
    expect(parsed.maxBackoffMs).toBeUndefined()
  })

  test("2: RetryPolicySchema parses exponential with jitter (kind, maxAttempts, backoffMs, jitterRatio)", () => {
    const parsed = parseRetryPolicy({
      kind: RETRY_EXP,
      maxAttempts: 5,
      backoffMs: 500,
      jitterRatio: 0.5,
    })
    expect(parsed.kind).toBe(RETRY_EXP)
    expect(parsed.maxAttempts).toBe(5)
    expect(parsed.backoffMs).toBe(500)
    expect(parsed.jitterRatio).toBe(0.5)
  })

  test("2: RetryPolicySchema parses decorrelated-jitter with maxBackoffMs", () => {
    const parsed = parseRetryPolicy({
      kind: RETRY_DECORR,
      maxAttempts: 10,
      backoffMs: 100,
      maxBackoffMs: 5_000,
    })
    expect(parsed.kind).toBe(RETRY_DECORR)
    expect(parsed.maxBackoffMs).toBe(5_000)
  })

  test("3: RetryPolicySchema rejects maxAttempts=0, non-integer, and > CONTROL_RETRY_MAX_ATTEMPTS", () => {
    expect(() => parseRetryPolicy({ kind: RETRY_FIXED, maxAttempts: 0 })).toThrow(
      /maxAttempts/,
    )
    expect(() => parseRetryPolicy({ kind: RETRY_FIXED, maxAttempts: 1.5 })).toThrow()
    expect(() =>
      parseRetryPolicy({
        kind: RETRY_FIXED,
        maxAttempts: CONTROL_RETRY_MAX_ATTEMPTS + 1,
      }),
    ).toThrow(/maxAttempts/)
  })

  test("4: RetryPolicySchema rejects jitterRatio out of [0,1] and backoffMs > CONTROL_RETRY_BACKOFF_MAX_MS", () => {
    expect(() =>
      parseRetryPolicy({ kind: RETRY_FIXED, maxAttempts: 1, jitterRatio: 1.5 }),
    ).toThrow(/jitterRatio/)
    expect(() =>
      parseRetryPolicy({ kind: RETRY_FIXED, maxAttempts: 1, jitterRatio: -0.1 }),
    ).toThrow(/jitterRatio/)
    expect(() =>
      parseRetryPolicy({
        kind: RETRY_FIXED,
        maxAttempts: 1,
        backoffMs: CONTROL_RETRY_BACKOFF_MAX_MS + 1,
      }),
    ).toThrow(/backoffMs/)
  })

  test("5: parseRetryPolicy round-trips valid input (parse → JSON → re-parse equal)", () => {
    const original = {
      kind: RETRY_EXP,
      maxAttempts: 4,
      backoffMs: 250,
      maxBackoffMs: 10_000,
      jitterRatio: 0.4,
    }
    const first = parseRetryPolicy(original)
    const roundTripped = parseRetryPolicy(JSON.parse(JSON.stringify(first)))
    expect(roundTripped).toEqual(first)
    expect(roundTripped.kind).toBe(RETRY_EXP)
  })
})

/* ---------------- M3-05 reconciliation ---------------- */

describe("M3-05 ReconciliationConfig", () => {
  test("6: ReconcileExpectedResultSchema + ReconcileFailOnSchema accept all literals, reject unknown", () => {
    expect(ReconcileExpectedResultSchema.parse("absent")).toBe("absent")
    expect(ReconcileExpectedResultSchema.parse("present")).toBe("present")
    expect(ReconcileExpectedResultSchema.parse("error")).toBe("error")
    expect(() => ReconcileExpectedResultSchema.parse("unknown")).toThrow()
    expect(ReconcileFailOnSchema.parse("unexpected_present")).toBe(
      "unexpected_present",
    )
    expect(ReconcileFailOnSchema.parse("unexpected_absent")).toBe("unexpected_absent")
    expect(ReconcileFailOnSchema.parse("any_mismatch")).toBe("any_mismatch")
  })

  test("6: ReconciliationConfigSchema parses all 3 enums combined", () => {
    const parsed = parseReconciliationConfig({
      probeExpression: "GET /v1/charges/${chargeId}",
      expectedResult: "present",
      failOn: "any_mismatch",
    })
    expect(parsed.probeExpression).toBe("GET /v1/charges/${chargeId}")
    expect(parsed.expectedResult).toBe("present")
    expect(parsed.failOn).toBe("any_mismatch")
  })

  test("7: ReconciliationConfigSchema rejects empty probeExpression", () => {
    expect(() =>
      parseReconciliationConfig({
        probeExpression: "",
        expectedResult: "present",
        failOn: "any_mismatch",
      }),
    ).toThrow(/probeExpression/)
  })

  test("8: ReconciliationConfigSchema rejects probe > RECONCILIATION_PROBE_MAX_CHARS, accepts boundary", () => {
    const tooLong = "a".repeat(RECONCILIATION_PROBE_MAX_CHARS + 1)
    expect(() =>
      parseReconciliationConfig({
        probeExpression: tooLong,
        expectedResult: "present",
        failOn: "any_mismatch",
      }),
    ).toThrow(/probeExpression/)
    const boundary = "a".repeat(RECONCILIATION_PROBE_MAX_CHARS)
    const parsed = parseReconciliationConfig({
      probeExpression: boundary,
      expectedResult: "absent",
      failOn: "unexpected_present",
    })
    expect(parsed.probeExpression).toBe(boundary)
  })

  test("9: parseReconciliationConfig round-trips valid input", () => {
    const original = {
      probeExpression: "POST /v1/refunds body={\"charge\":\"${id}\"}",
      expectedResult: "present" as const,
      failOn: "any_mismatch" as const,
    }
    const first = parseReconciliationConfig(original)
    const roundTripped = parseReconciliationConfig(
      JSON.parse(JSON.stringify(first)),
    )
    expect(roundTripped).toEqual(first)
    expect(roundTripped.expectedResult).toBe("present")
  })
})

/* ---------------- M3-06 UNKNOWN_EXTERNAL_STATE ---------------- */

describe("M3-06 UnknownExternalState + reconciliation bundle", () => {
  test("10: UnknownExternalStateActionSchema accepts FAIL, RECONCILE_PROBE, RECONCILE_REPLAY; rejects IGNORE", () => {
    expect(UnknownExternalStateActionSchema.parse("FAIL")).toBe("FAIL")
    expect(UnknownExternalStateActionSchema.parse("RECONCILE_PROBE")).toBe(
      "RECONCILE_PROBE",
    )
    expect(UnknownExternalStateActionSchema.parse("RECONCILE_REPLAY")).toBe(
      "RECONCILE_REPLAY",
    )
    expect(() => UnknownExternalStateActionSchema.parse("IGNORE")).toThrow()
  })

  test("11: EffectNodeConfigWithReconciliation parses idempotency=BUSINESS + onUnknown=RECONCILE_REPLAY", () => {
    const parsed = parseEffectNodeConfigWithReconciliation({
      effect: { idempotency: "BUSINESS" },
      reconciliation: {
        probeExpression: "GET /v1/users/${id}",
        expectedResult: "present",
        failOn: "any_mismatch",
      },
      onUnknown: "RECONCILE_REPLAY",
    })
    expect(parsed.effect.idempotency).toBe("BUSINESS")
    expect(parsed.onUnknown).toBe("RECONCILE_REPLAY")
    expect(parsed.reconciliation.expectedResult).toBe("present")
  })

  test("11: EffectNodeConfigWithReconciliation parses idempotency=PROVIDER + key + replay", () => {
    const parsed = parseEffectNodeConfigWithReconciliation({
      effect: { idempotency: "PROVIDER", idempotencyKey: "k-1" },
      reconciliation: {
        probeExpression: "GET /v1/charges/${id}",
        expectedResult: "present",
        failOn: "any_mismatch",
      },
      onUnknown: "RECONCILE_REPLAY",
    })
    expect(parsed.effect.idempotency).toBe("PROVIDER")
    expect(parsed.effect.idempotencyKey).toBe("k-1")
  })

  test("12: Refine rejects idempotency=NONE + onUnknown=RECONCILE_REPLAY", () => {
    expect(() =>
      parseEffectNodeConfigWithReconciliation({
        effect: { idempotency: "NONE" },
        reconciliation: {
          probeExpression: "GET /v1/foo",
          expectedResult: "absent",
          failOn: "any_mismatch",
        },
        onUnknown: "RECONCILE_REPLAY",
      }),
    ).toThrow(/RECONCILE_REPLAY/)
  })

  test("13: Refine accepts idempotency=NONE + onUnknown=RECONCILE_PROBE (probe is read-only, safe on NONE)", () => {
    const parsed = parseEffectNodeConfigWithReconciliation({
      effect: { idempotency: "NONE" },
      reconciliation: {
        probeExpression: "GET /v1/foo",
        expectedResult: "absent",
        failOn: "unexpected_present",
      },
      onUnknown: "RECONCILE_PROBE",
    })
    expect(parsed.effect.idempotency).toBe("NONE")
    expect(parsed.onUnknown).toBe("RECONCILE_PROBE")
  })

  test("13: Refine accepts idempotency=NONE + onUnknown=FAIL (always allowed)", () => {
    const parsed = parseEffectNodeConfigWithReconciliation({
      effect: { idempotency: "NONE" },
      reconciliation: {
        probeExpression: "GET /v1/foo",
        expectedResult: "absent",
        failOn: "any_mismatch",
      },
      onUnknown: "FAIL",
    })
    expect(parsed.onUnknown).toBe("FAIL")
  })

  test("14: parseEffectNodeConfigWithReconciliation round-trips valid input", () => {
    const original = {
      effect: { idempotency: "USER" as const, idempotencyKey: "user-42" },
      reconciliation: {
        probeExpression: "GET /v1/orders/${id}",
        expectedResult: "present" as const,
        failOn: "unexpected_absent" as const,
      },
      onUnknown: "RECONCILE_PROBE" as const,
    }
    const first = parseEffectNodeConfigWithReconciliation(original)
    const roundTripped = parseEffectNodeConfigWithReconciliation(
      JSON.parse(JSON.stringify(first)),
    )
    expect(roundTripped).toEqual(first)
    expect(roundTripped.effect.idempotency).toBe("USER")
  })
})

/* ---------------- M3-07 compensation ---------------- */

describe("M3-07 Compensation binding", () => {
  test("15: CompensationBindingSchema parses forward + compensation + optional description", () => {
    const withDesc = parseCompensationBinding({
      forwardNode: "n-charge",
      compensationNode: "n-refund",
      description: "refund the Stripe charge",
    })
    expect(withDesc.forwardNode).toBe("n-charge")
    expect(withDesc.compensationNode).toBe("n-refund")
    expect(withDesc.description).toBe("refund the Stripe charge")

    const noDesc = parseCompensationBinding({
      forwardNode: "n-create-user",
      compensationNode: "n-delete-user",
    })
    expect(noDesc.description).toBeUndefined()
  })

  test("16: CompensationBindingSchema rejects empty forwardNode and empty compensationNode", () => {
    expect(() =>
      parseCompensationBinding({ forwardNode: "", compensationNode: "n-refund" }),
    ).toThrow(/forwardNode/)
    expect(() =>
      parseCompensationBinding({ forwardNode: "n-charge", compensationNode: "" }),
    ).toThrow(/compensationNode/)
  })

  test("17: CompensationListSchema rejects duplicate forwardNode, accepts distinct + empty", () => {
    const ok = CompensationListSchema.parse([
      { forwardNode: "n-a", compensationNode: "n-a-comp" },
      { forwardNode: "n-b", compensationNode: "n-b-comp" },
    ])
    expect(ok).toHaveLength(2)
    expect(() =>
      CompensationListSchema.parse([
        { forwardNode: "n-a", compensationNode: "n-a-comp" },
        { forwardNode: "n-a", compensationNode: "n-a-comp-2" },
      ]),
    ).toThrow(/duplicate forwardNode/)
    expect(CompensationListSchema.parse([])).toHaveLength(0)
  })

  test("18: parseCompensationBinding round-trips valid input", () => {
    const original = {
      forwardNode: "n-book-flight",
      compensationNode: "n-cancel-flight",
      description: "cancel the booking if downstream fails",
    }
    const first = parseCompensationBinding(original)
    const roundTripped = parseCompensationBinding(
      JSON.parse(JSON.stringify(first)),
    )
    expect(roundTripped).toEqual(first)
    expect(roundTripped.forwardNode).toBe("n-book-flight")
  })
})

/* ---------------- M3-08 wait ---------------- */

describe("M3-08 WaitConfig", () => {
  test("19: WaitConfigSchema parses minimal config (duration, unit, defaults jitterRatio=0.1, outputVariable undefined)", () => {
    const parsed = parseWaitConfig({ duration: 100, unit: "ms" })
    expect(parsed.duration).toBe(100)
    expect(parsed.unit).toBe("ms")
    expect(parsed.jitterRatio).toBe(0.1)
    expect(parsed.outputVariable).toBeUndefined()
  })

  test("20: WaitUnitSchema accepts ms/s/min; WaitConfigSchema parses all 3 units + valid outputVariable", () => {
    expect(WaitUnitSchema.parse("ms")).toBe("ms")
    expect(WaitUnitSchema.parse("s")).toBe("s")
    expect(WaitUnitSchema.parse("min")).toBe("min")
    expect(() => WaitUnitSchema.parse("h")).toThrow()
    expect(parseWaitConfig({ duration: 500, unit: "ms" }).unit).toBe("ms")
    expect(parseWaitConfig({ duration: 5, unit: "s" }).unit).toBe("s")
    expect(parseWaitConfig({ duration: 2, unit: "min" }).unit).toBe("min")
    const withVar = parseWaitConfig({
      duration: 1_000,
      unit: "ms",
      outputVariable: "actualWait",
    })
    expect(withVar.outputVariable).toBe("actualWait")
  })

  test("21: WaitConfigSchema rejects duration=0, negative duration, duration > WAIT_DURATION_MAX_MS", () => {
    expect(() => parseWaitConfig({ duration: 0, unit: "ms" })).toThrow(/duration/)
    expect(() => parseWaitConfig({ duration: -1, unit: "ms" })).toThrow(/duration/)
    expect(() =>
      parseWaitConfig({ duration: WAIT_DURATION_MAX_MS + 1, unit: "ms" }),
    ).toThrow(/duration/)
  })

  test("22: WaitConfigSchema rejects invalid outputVariable (starts with digit, hyphen, > 64 chars)", () => {
    expect(() =>
      parseWaitConfig({ duration: 100, unit: "ms", outputVariable: "1bad" }),
    ).toThrow(/outputVariable/)
    expect(() =>
      parseWaitConfig({ duration: 100, unit: "ms", outputVariable: "wait-time" }),
    ).toThrow(/outputVariable/)
    expect(() =>
      parseWaitConfig({ duration: 100, unit: "ms", outputVariable: "a".repeat(65) }),
    ).toThrow(/outputVariable/)
  })

  test("23: resolveWaitDurationMs converts correctly (ms identity, s ×1000, min ×60_000)", () => {
    expect(
      resolveWaitDurationMs(parseWaitConfig({ duration: 100, unit: "ms" })),
    ).toBe(100)
    expect(
      resolveWaitDurationMs(parseWaitConfig({ duration: 5, unit: "s" })),
    ).toBe(5_000)
    expect(
      resolveWaitDurationMs(parseWaitConfig({ duration: 2, unit: "min" })),
    ).toBe(120_000)
  })
})

/* ---------------- Non-regression on the IR ---------------- */

describe("M3-04/05/06/07/08 non-regression on the IR", () => {
  test("tool.http and wait nodes still parse at IR level with empty config (config stays opaque)", () => {
    expect(
      NodeSchema.safeParse({ id: "n-http", family: "tool.http", config: {} }).success,
    ).toBe(true)
    expect(
      NodeSchema.safeParse({ id: "n-wait", family: "wait", config: {} }).success,
    ).toBe(true)
  })

  test("Exposed constants match design (caps, IDs, durations)", () => {
    expect(CONTROL_RETRY_MAX_ATTEMPTS).toBe(100)
    expect(CONTROL_RETRY_BACKOFF_MAX_MS).toBe(60_000)
    expect(RECONCILIATION_PROBE_MAX_CHARS).toBe(1024)
    expect(COMPENSATION_BRANCH_ID_MAX_CHARS).toBe(64)
    expect(WAIT_DURATION_MAX_MS).toBe(365 * 24 * 60 * 60 * 1000)
  })
})
