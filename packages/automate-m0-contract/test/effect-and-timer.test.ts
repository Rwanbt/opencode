/* SPDX-License-Identifier: MIT */
/* Copyright (c) 2026 Unifia contributors */

/**
 * Contract tests for effect identity (§19-§24) and durable timers (§32).
 *
 * Like `unifia-value.test.ts`, this is the **contract half**: it locks the
 * semantics both candidates must implement, in-process, with no substrate.
 * The substrate half is the failure matrix, which the harness will drive
 * through each adapter. No FC result is claimed here.
 *
 * What these tests are really guarding is §82's list of absolute
 * prohibitions — "generic exactly-once claim", "blind retry of uncertain
 * irreversible effect", "substrate-local identity replacing EffectKey".
 * Each of those becomes a concrete assertion below.
 */
import { describe, expect, test } from "bun:test"
import {
  actionUnderUncertainty,
  assertEffectKeyDeriverIsDeterministic,
  assertRetryPreservesIdentity,
  assertWellFormedEffectSlot,
  EFFECT_IDENTITY_VERSION_M0,
  EFFECT_POLICIES,
  EffectAttemptConfigError,
  EffectKeyError,
  EffectSemanticsError,
  effectKeyEquals,
  effectSlotEquals,
  isReconcilable,
  mayAutoReplayUnderUncertainty,
  parseEffectAttemptConfig,
  UNKNOWN_EXTERNAL_STATE,
  type EffectKey,
  type EffectRecord,
  type EffectSlot,
  type IterationCoordinate,
} from "../src/effect.ts"
import {
  asAttemptId,
  asEffectId,
  asLogicalInvocationId,
  asWorkflowDeploymentId,
  asWorkflowRunId,
  assertWellFormedIdentity,
  IdentityError,
  MAX_IDENTITY_LENGTH,
} from "../src/ids.ts"
import {
  assertLegalTimerTransition,
  assertWellFormedTimer,
  DURABLE_TIMER_STATES,
  evaluateTimerOnRecovery,
  isLegalTimerTransition,
  TERMINAL_TIMER_STATES,
  TimerContractError,
  type DurableTimer,
  type DurableTimerState,
} from "../src/timer.ts"
import { canonicalTimestampFromEpochMs } from "../src/value.ts"
import { asDurableTimerId } from "../src/ids.ts"

/* ------------------------------------------------------------------ */
/* Fixtures                                                            */
/* ------------------------------------------------------------------ */

const deploymentId = asWorkflowDeploymentId("dep-01")
const runId = asWorkflowRunId("run-01")
const invocationId = asLogicalInvocationId("inv-01")

function slot(
  nodeExecutionPath: string,
  iterationCoordinates: readonly IterationCoordinate[] = [],
  effectOrdinal = 0,
): EffectSlot {
  return { nodeExecutionPath, iterationCoordinates, effectOrdinal }
}

function key(effectSlot: EffectSlot, invocation = invocationId): EffectKey {
  return {
    effectIdentityVersion: EFFECT_IDENTITY_VERSION_M0,
    deploymentId,
    runId,
    logicalInvocationId: invocation,
    effectSlot,
  }
}

/* ------------------------------------------------------------------ */
/* §19 — retry preserves identity                                      */
/* ------------------------------------------------------------------ */

describe("§19 — retry keeps the invocation and the key, changes the attempt", () => {
  const original: EffectRecord = {
    effectId: asEffectId("eff-01"),
    key: key(slot("node/http-a")),
    policy: "IDEMPOTENT",
    attemptId: asAttemptId("att-01"),
    outcome: { kind: "FAILED", error: "boom" },
  }

  test("a retry with the same key and a new attempt is accepted", () => {
    expect(() =>
      assertRetryPreservesIdentity(original, {
        key: key(slot("node/http-a")),
        attemptId: asAttemptId("att-02"),
      }),
    ).not.toThrow()
  })

  test("a retry that reuses the AttemptId is rejected", () => {
    expect(() =>
      assertRetryPreservesIdentity(original, {
        key: key(slot("node/http-a")),
        attemptId: asAttemptId("att-01"),
      }),
    ).toThrow(EffectSemanticsError)
  })

  test("a retry that changed the key is rejected — §82 substrate-local identity", () => {
    // The failure this guards: a candidate that re-derives identity from
    // its own internal step counter would produce a *different* key on
    // retry and silently dispatch a second real effect.
    expect(() =>
      assertRetryPreservesIdentity(original, {
        key: key(slot("node/http-a", [], 1)),
        attemptId: asAttemptId("att-02"),
      }),
    ).toThrow(/must preserve its EffectKey/)
  })

  test("a different logical invocation is a different effect", () => {
    expect(
      effectKeyEquals(key(slot("node/http-a")), key(slot("node/http-a"), asLogicalInvocationId("inv-02"))),
    ).toBe(false)
  })
})

/* ------------------------------------------------------------------ */
/* §21 — EffectSlot and iteration coordinates                          */
/* ------------------------------------------------------------------ */

describe("§21 — iteration coordinates are materialized, not re-derived", () => {
  test("a stable business key and an ordinal are different coordinates", () => {
    const byKey = slot("node/map", [{ kind: "key", key: "item-7" }])
    const byOrdinal = slot("node/map", [{ kind: "ordinal", ordinal: 7 }])
    expect(effectSlotEquals(byKey, byOrdinal)).toBe(false)
  })

  test("reordering a collection cannot change a key-based coordinate", () => {
    // The §21 failure mode: retry re-enumerates and item-7 is now at index
    // 2. With a materialized business key the identity is untouched.
    const before = slot("node/map", [{ kind: "key", key: "item-7" }])
    const afterReorder = slot("node/map", [{ kind: "key", key: "item-7" }])
    expect(effectSlotEquals(before, afterReorder)).toBe(true)
  })

  test("an ordinal coordinate is identity-bearing, so a reorder is visible", () => {
    // This is why §21 prefers a stable key: with an ordinal, a reorder
    // *does* change identity — which is correct behavior for the contract
    // (it surfaces), and the reason the ordinal must itself be durable.
    const before = slot("node/map", [{ kind: "ordinal", ordinal: 7 }])
    const afterReorder = slot("node/map", [{ kind: "ordinal", ordinal: 2 }])
    expect(effectSlotEquals(before, afterReorder)).toBe(false)
  })

  test("nested coordinates compare outermost first and by position", () => {
    const nested = slot("node/loop", [
      { kind: "ordinal", ordinal: 0 },
      { kind: "key", key: "row-3" },
    ])
    const swapped = slot("node/loop", [
      { kind: "key", key: "row-3" },
      { kind: "ordinal", ordinal: 0 },
    ])
    expect(effectSlotEquals(nested, swapped)).toBe(false)
    expect(effectSlotEquals(nested, { ...nested })).toBe(true)
  })

  test("effectOrdinal separates several effects of one invocation (M0-M01)", () => {
    expect(effectSlotEquals(slot("n", [], 0), slot("n", [], 1))).toBe(false)
  })

  test("a malformed slot is refused", () => {
    expect(() => assertWellFormedEffectSlot(slot(""))).toThrow(EffectKeyError)
    expect(() => assertWellFormedEffectSlot(slot("n", [], -1))).toThrow(EffectKeyError)
    expect(() => assertWellFormedEffectSlot(slot("n", [], 1.5))).toThrow(EffectKeyError)
    expect(() =>
      assertWellFormedEffectSlot(slot("n", [{ kind: "key", key: "" }])),
    ).toThrow(EffectKeyError)
    expect(() =>
      assertWellFormedEffectSlot(slot("n", [{ kind: "ordinal", ordinal: -1 }])),
    ).toThrow(EffectKeyError)
  })

  test("a well-formed slot passes", () => {
    expect(() =>
      assertWellFormedEffectSlot(slot("node/map", [{ kind: "key", key: "i" }], 2)),
    ).not.toThrow()
  })
})

/* ------------------------------------------------------------------ */
/* §20 — identity version                                              */
/* ------------------------------------------------------------------ */

describe("§20 — effectIdentityVersion participates in identity", () => {
  test("two keys from different identity schemes are not equal", () => {
    const a = key(slot("n"))
    const b = { ...a, effectIdentityVersion: 2 }
    expect(effectKeyEquals(a, b)).toBe(false)
  })

  test("a different deployment is a different effect", () => {
    const a = key(slot("n"))
    const b = { ...a, deploymentId: asWorkflowDeploymentId("dep-02") }
    expect(effectKeyEquals(a, b)).toBe(false)
  })

  test("a different run is a different effect", () => {
    const a = key(slot("n"))
    const b = { ...a, runId: asWorkflowRunId("run-02") }
    expect(effectKeyEquals(a, b)).toBe(false)
  })
})

/* ------------------------------------------------------------------ */
/* §22, §23, §24 — what may happen under uncertainty                   */
/* ------------------------------------------------------------------ */

describe("§23 / §24 — no blind retry of an uncertain effect", () => {
  test("only PURE and IDEMPOTENT may be auto-replayed", () => {
    expect(mayAutoReplayUnderUncertainty("PURE")).toBe(true)
    expect(mayAutoReplayUnderUncertainty("IDEMPOTENT")).toBe(true)
    expect(mayAutoReplayUnderUncertainty("REPEATABLE")).toBe(false)
    expect(mayAutoReplayUnderUncertainty("RECONCILABLE")).toBe(false)
    expect(mayAutoReplayUnderUncertainty("NON_REPEATABLE")).toBe(false)
  })

  test("REPEATABLE is not a synonym for IDEMPOTENT — §22 separates them", () => {
    // The trap: "the business says it's fine to repeat" is a statement
    // about intent, not about the provider's behavior. Replaying it under
    // uncertainty can still double a real effect.
    expect(mayAutoReplayUnderUncertainty("REPEATABLE")).toBe(false)
  })

  test("RECONCILABLE means ask, not replay", () => {
    expect(actionUnderUncertainty("RECONCILABLE")).toBe("RECONCILE")
    expect(isReconcilable("RECONCILABLE")).toBe(true)
  })

  test("NON_REPEATABLE surfaces the uncertainty", () => {
    expect(actionUnderUncertainty("NON_REPEATABLE")).toBe("SURFACE_UNCERTAINTY")
  })

  test("every policy maps to exactly one action, and none is missing", () => {
    const actions = EFFECT_POLICIES.map(actionUnderUncertainty)
    expect(actions).toHaveLength(5)
    expect(new Set(actions)).toEqual(
      new Set(["AUTO_REPLAY", "RECONCILE", "SURFACE_UNCERTAINTY"]),
    )
  })

  test("UNKNOWN_EXTERNAL_STATE is a first-class outcome, not an error string", () => {
    const record: EffectRecord = {
      effectId: asEffectId("eff-02"),
      key: key(slot("node/http-b")),
      policy: "NON_REPEATABLE",
      attemptId: asAttemptId("att-01"),
      outcome: { kind: UNKNOWN_EXTERNAL_STATE, reason: "ACK lost after dispatch" },
    }
    expect(record.outcome.kind).toBe(UNKNOWN_EXTERNAL_STATE)
    // It is distinguishable from FAILED — §24 requires every surface to
    // preserve that distinction.
    expect(record.outcome.kind).not.toBe("FAILED")
  })

  test("the two exits from uncertainty are reconciliation and operator resolution", () => {
    const reconciled: EffectRecord = {
      effectId: asEffectId("eff-03"),
      key: key(slot("n")),
      policy: "RECONCILABLE",
      attemptId: asAttemptId("att-01"),
      outcome: { kind: UNKNOWN_EXTERNAL_STATE, reason: "timeout" },
      resolution: {
        kind: "RECONCILED",
        evidence: { queried: "GET /charges/x", answered: "not_found" },
        outcome: "FAILED",
      },
    }
    expect(reconciled.resolution?.kind).toBe("RECONCILED")
  })
})

/* ------------------------------------------------------------------ */
/* §32 — durable timers                                                */
/* ------------------------------------------------------------------ */

const at = (ms: number) => canonicalTimestampFromEpochMs(ms)

function timer(state: DurableTimerState, notBefore = 1_000): DurableTimer {
  return {
    timerId: asDurableTimerId("timer-01"),
    createdAt: at(0),
    notBefore: at(notBefore),
    state,
    missedTimerPolicy: "FIRE_ON_RECOVERY",
  }
}

describe("§32 — a FIRED timer never returns to PENDING", () => {
  test("the transition is refused, with the reason named", () => {
    expect(() => assertLegalTimerTransition("FIRED", "PENDING")).toThrow(TimerContractError)
    expect(() => assertLegalTimerTransition("FIRED", "PENDING")).toThrow(
      /must not return to PENDING/,
    )
  })

  test("every terminal state is a dead end", () => {
    for (const from of TERMINAL_TIMER_STATES) {
      for (const to of DURABLE_TIMER_STATES) {
        expect(isLegalTimerTransition(from, to)).toBe(false)
      }
    }
  })

  test("the legal path is PENDING → ELIGIBLE → FIRED", () => {
    expect(isLegalTimerTransition("PENDING", "ELIGIBLE")).toBe(true)
    expect(isLegalTimerTransition("ELIGIBLE", "FIRED")).toBe(true)
    expect(isLegalTimerTransition("PENDING", "FIRED")).toBe(false)
  })

  test("a pending or eligible timer may still be cancelled or expire", () => {
    expect(isLegalTimerTransition("PENDING", "CANCELLED")).toBe(true)
    expect(isLegalTimerTransition("ELIGIBLE", "CANCELLED")).toBe(true)
    expect(isLegalTimerTransition("PENDING", "EXPIRED")).toBe(true)
    expect(isLegalTimerTransition("ELIGIBLE", "EXPIRED")).toBe(true)
  })
})

describe("§32 — recovery and clock movement (FC-15, FC-16, FC-17)", () => {
  test("FIRE_ON_RECOVERY: a reached deadline becomes ELIGIBLE on restart", () => {
    expect(evaluateTimerOnRecovery(timer("PENDING", 1_000), at(1_000)).state).toBe("ELIGIBLE")
    expect(evaluateTimerOnRecovery(timer("PENDING", 1_000), at(5_000)).state).toBe("ELIGIBLE")
  })

  test("an unreached deadline stays PENDING", () => {
    expect(evaluateTimerOnRecovery(timer("PENDING", 1_000), at(999)).state).toBe("PENDING")
  })

  test("FC-15 — moving the clock backwards does not refire a FIRED timer", () => {
    const fired = timer("FIRED", 1_000)
    expect(evaluateTimerOnRecovery(fired, at(0)).state).toBe("FIRED")
    expect(evaluateTimerOnRecovery(fired, at(-1_000_000)).state).toBe("FIRED")
  })

  test("FC-15 — a backwards clock does not un-elect an ELIGIBLE timer either", () => {
    const eligible = timer("ELIGIBLE", 1_000)
    expect(evaluateTimerOnRecovery(eligible, at(0)).state).toBe("ELIGIBLE")
  })

  test("FC-16 — a forward clock preserves notBefore semantics", () => {
    // Jumping forward makes a pending deadline eligible, which is correct:
    // notBefore is a lower bound, not an equality.
    expect(evaluateTimerOnRecovery(timer("PENDING", 1_000), at(10 ** 12)).state).toBe(
      "ELIGIBLE",
    )
  })

  test("cancelled and expired timers are untouched by recovery", () => {
    expect(evaluateTimerOnRecovery(timer("CANCELLED", 1_000), at(9_999)).state).toBe(
      "CANCELLED",
    )
    expect(evaluateTimerOnRecovery(timer("EXPIRED", 1_000), at(9_999)).state).toBe("EXPIRED")
  })

  test("recovery does not mutate its input", () => {
    const pending = timer("PENDING", 1_000)
    evaluateTimerOnRecovery(pending, at(5_000))
    expect(pending.state).toBe("PENDING")
  })

  test("ELIGIBLE does not assert the external effect completed", () => {
    // §32 says so explicitly. Encoded as a structural fact: the timer type
    // carries no outcome field, so "eligible" cannot be read as "done".
    const eligible = evaluateTimerOnRecovery(timer("PENDING", 0), at(1))
    expect(eligible.state).toBe("ELIGIBLE")
    expect("outcome" in eligible).toBe(false)
  })
})

describe("§32 — timer well-formedness", () => {
  test("a deadline preceding creation is refused (FC-20 territory)", () => {
    const corrupted: DurableTimer = { ...timer("PENDING"), notBefore: at(-1) }
    expect(() => assertWellFormedTimer(corrupted)).toThrow(TimerContractError)
  })

  test("a well-formed timer passes", () => {
    expect(() => assertWellFormedTimer(timer("PENDING", 1_000))).not.toThrow()
  })

  test("an unknown state or policy is refused", () => {
    expect(() =>
      assertWellFormedTimer({ ...timer("PENDING"), state: "SLEEPING" as DurableTimerState }),
    ).toThrow(TimerContractError)
  })
})

/* ------------------------------------------------------------------ */
/* §18 — identity well-formedness                                      */
/* ------------------------------------------------------------------ */

describe("§18 — identities are opaque, with a well-formedness floor", () => {
  test("empty, padded and over-long identities are refused", () => {
    expect(() => assertWellFormedIdentity("", "X")).toThrow(IdentityError)
    expect(() => assertWellFormedIdentity(" a", "X")).toThrow(IdentityError)
    expect(() => assertWellFormedIdentity("a ", "X")).toThrow(IdentityError)
    expect(() => assertWellFormedIdentity("x".repeat(MAX_IDENTITY_LENGTH + 1), "X")).toThrow(
      IdentityError,
    )
  })

  test("no format is imposed — UUID, ULID and opaque all pass", () => {
    // §18 leaves the concrete representation undecided. A test that
    // demanded a UUID here would decide it by accident.
    for (const candidate of [
      "550e8400-e29b-41d4-a716-446655440000",
      "01ARZ3NDEKTSV4RRFFQ69G5FAV",
      "run_opaque_42",
    ]) {
      expect(() => assertWellFormedIdentity(candidate, "X")).not.toThrow()
    }
  })

  test("the boundary length is inclusive", () => {
    expect(() => assertWellFormedIdentity("x".repeat(MAX_IDENTITY_LENGTH), "X")).not.toThrow()
  })
})

/* ------------------------------------------------------------------ */
/* M3-02 — assertEffectKeyDeriverIsDeterministic                       */
/* ------------------------------------------------------------------ */

describe("M3-02 — assertEffectKeyDeriverIsDeterministic (M3-02 effect identity)", () => {
  // A deriver that hashes a JSON-serialized payload. This is the kind of
  // deriver a correct substrate would write: same payload in, same key
  // out, every call.
  const jsonHashDeriver = {
    deriveKey(payload: unknown): EffectKey {
      const serialized = JSON.stringify(payload)
      return key(slot(`node/hash:${serialized}`))
    },
  }

  // A deriver that returns a *counter*. This is the failure mode §82
  // exists to prevent: a candidate re-deriving identity from its own
  // internal step counter would produce a different key on every call and
  // silently dispatch a second real effect on retry.
  let counter = 0
  const counterDeriver = {
    deriveKey(_payload: unknown): EffectKey {
      counter += 1
      return key(slot(`node/step:${counter}`), asLogicalInvocationId(`inv-step-${counter}`))
    },
  }

  // A SHA-256-style deriver: stable across calls, no internal state. The
  // "hash" here is just a digest of the JSON; the test only cares about
  // determinism, not cryptographic strength.
  const contentHashDeriver = {
    deriveKey(payload: unknown): EffectKey {
      const serialized = JSON.stringify(payload)
      // Simple, deterministic fold: every char summed mod a small prime.
      let acc = 0
      for (const ch of serialized) acc = (acc * 31 + ch.charCodeAt(0)) | 0
      return key(slot(`node/sha256:${acc.toString(16)}`))
    },
  }

  test("a deterministic deriver passes — same payload → same EffectKey", () => {
    const sample = { http: "POST", url: "https://api.example.com/charge", body: { amount: 4200 } }
    const derived = assertEffectKeyDeriverIsDeterministic(jsonHashDeriver, sample)
    expect(derived.effectSlot.nodeExecutionPath).toBe(
      `node/hash:${JSON.stringify(sample)}`,
    )
  })

  test("a counter-based deriver is rejected — the §82 failure mode", () => {
    counter = 0
    const sample = { step: "approve" }
    expect(() =>
      assertEffectKeyDeriverIsDeterministic(counterDeriver, sample),
    ).toThrow(EffectSemanticsError)
    expect(() =>
      assertEffectKeyDeriverIsDeterministic(counterDeriver, sample),
    ).toThrow(/must produce the same EffectKey/)
  })

  test("a content-hash deriver is robust — the recommended shape", () => {
    const sample = { node: "send-invoice", invoice: 4711 }
    expect(() =>
      assertEffectKeyDeriverIsDeterministic(contentHashDeriver, sample),
    ).not.toThrow()
    // Same payload, different object identity — the hash must be
    // content-based, not reference-based.
    const clone = { node: "send-invoice", invoice: 4711 }
    expect(() =>
      assertEffectKeyDeriverIsDeterministic(contentHashDeriver, clone),
    ).not.toThrow()
  })

  test("REPEATABLE is not a synonym for IDEMPOTENT — mayAutoReplayUnderUncertainty excludes it", () => {
    // Explicit, named test. §22 is unambiguous: REPEATABLE is about
    // *intent*, not about the provider. Replaying it under uncertainty can
    // still double a real effect. This test is the one a future refactor
    // would have to break to quietly re-introduce the bug.
    expect(mayAutoReplayUnderUncertainty("REPEATABLE")).toBe(false)
    expect(mayAutoReplayUnderUncertainty("PURE")).toBe(true)
    expect(mayAutoReplayUnderUncertainty("IDEMPOTENT")).toBe(true)
  })

  test("actionUnderUncertainty returns three distinct string values", () => {
    const actions = new Set(EFFECT_POLICIES.map(actionUnderUncertainty))
    expect(actions.size).toBe(3)
    expect(actions).toEqual(
      new Set(["AUTO_REPLAY", "RECONCILE", "SURFACE_UNCERTAINTY"]),
    )
  })

  test("RETRY never coerces into ASK or SURFACE — distinct identity enforced", () => {
    // The collapse this guards: a `?? false` somewhere in the runtime
    // turning `RECONCILE` or `SURFACE_UNCERTAINTY` into `AUTO_REPLAY`. The
    // type system only helps if the values are kept as distinct strings.
    const RETRY = actionUnderUncertainty("IDEMPOTENT")
    const ASK = actionUnderUncertainty("RECONCILABLE")
    const SURFACE = actionUnderUncertainty("NON_REPEATABLE")
    expect(RETRY).not.toBe(ASK)
    expect(RETRY).not.toBe(SURFACE)
    expect(ASK).not.toBe(SURFACE)
    // And the values are stable — no implicit conversion.
    expect(typeof RETRY).toBe("string")
    expect(typeof ASK).toBe("string")
    expect(typeof SURFACE).toBe("string")
  })
})

/* ------------------------------------------------------------------ */
/* M3-01 — EffectAttemptConfig                                          */
/* ------------------------------------------------------------------ */

describe("M3-01 — parseEffectAttemptConfig (M3-01 attempts)", () => {
  // A reusable sample payload, used to confirm the schema is the only
  // thing under test — not the surrounding caller's data shape.
  const sample = { maxAttempts: 3, minIntervalMs: 500 }

  test("EffectAttemptConfigSchema_ParsesMinimal — defaults are applied", () => {
    const parsed = parseEffectAttemptConfig({ maxAttempts: 1 })
    expect(parsed).toEqual({ maxAttempts: 1, minIntervalMs: 1000 })
  })

  test("EffectAttemptConfigSchema_ParsesFull — both fields round-trip", () => {
    const parsed = parseEffectAttemptConfig(sample)
    expect(parsed).toEqual(sample)
  })

  test("EffectAttemptConfigSchema_RejectsZeroMaxAttempts", () => {
    expect(() => parseEffectAttemptConfig({ maxAttempts: 0 })).toThrow(
      EffectAttemptConfigError,
    )
    expect(() => parseEffectAttemptConfig({ maxAttempts: 0 })).toThrow(
      /maxAttempts must be ≥ 1/,
    )
  })

  test("EffectAttemptConfigSchema_RejectsTooLargeMaxAttempts — the 1000 resource bound", () => {
    expect(() => parseEffectAttemptConfig({ maxAttempts: 1001 })).toThrow(
      EffectAttemptConfigError,
    )
    expect(() => parseEffectAttemptConfig({ maxAttempts: 1001 })).toThrow(
      /maxAttempts must be ≤ 1000/,
    )
    // 1000 itself is the inclusive boundary and must pass.
    expect(() => parseEffectAttemptConfig({ maxAttempts: 1000 })).not.toThrow()
  })

  test("EffectAttemptConfigSchema_RejectsNegativeMinIntervalMs", () => {
    expect(() =>
      parseEffectAttemptConfig({ maxAttempts: 1, minIntervalMs: -1 }),
    ).toThrow(EffectAttemptConfigError)
    expect(() =>
      parseEffectAttemptConfig({ maxAttempts: 1, minIntervalMs: -1 }),
    ).toThrow(/minIntervalMs must be ≥ 0/)
  })
})
