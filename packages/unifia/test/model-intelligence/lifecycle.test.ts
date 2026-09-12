/**
 * Tests for the lifecycle state machine (TEAM-C08) — structural transition
 * graph (valid AND invalid edges), data-driven promotion conditions,
 * mandatory explicit actions for quarantine/deprecate/trust, the
 * deprecation replacement-policy requirement, and (F1 regression, added
 * after independent E2 review) the clock-injection fix that makes
 * elapsed-time governance non-bypassable and fail-closed on malformed
 * input.
 */

import { describe, expect, test } from "bun:test"
import {
  LIFECYCLE_STAGES,
  LIFECYCLE_TRANSITIONS,
  LifecycleStore,
  InvalidLifecycleTransitionError,
  LifecyclePromotionConditionsNotMetError,
  MissingExplicitActionError,
  MissingReplacementPolicyError,
  UnknownModelStageError,
  evaluatePromotionConditions,
  isStructurallyValidTransition,
  isTerminalStage,
  requiredExplicitActionKind,
  validTransitionsFrom,
  MIN_PROBATION_MS,
  MIN_LOW_RISK_MS,
  MIN_GENERAL_ELIGIBLE_MS,
  LOW_RISK_MIN_AVAILABILITY,
  LOW_RISK_MAX_ERROR_RATE,
  GENERAL_MIN_AVAILABILITY,
  GENERAL_MAX_ERROR_RATE,
  type LifecycleStage,
  type TransitionEvidence,
} from "../../src/model-intelligence/lifecycle"
import type { ModelHealth } from "../../src/model-intelligence/schema"
import { Model } from "../../src/model-intelligence/schema"

const T0 = Date.parse("2026-01-01T00:00:00Z")

function isoAt(msFromEpoch: number): string {
  return new Date(msFromEpoch).toISOString()
}

function baseHealth(overrides: Partial<ModelHealth> = {}): ModelHealth {
  return {
    lastHealthCheckUTC: isoAt(T0),
    availabilityScore: 0.99,
    latencyP50Ms: 100,
    latencyP95Ms: 200,
    errorRate1h: 0.01,
    rateLimit: null,
    notes: null,
    ...overrides,
  }
}

function baseEvidence(overrides: Partial<TransitionEvidence> = {}): TransitionEvidence {
  return {
    independentSourceCount: 1,
    health: null,
    hasBenchmarkResult: false,
    ...overrides,
  }
}

/**
 * A deterministic, test-controlled clock for `LifecycleStore` — this is
 * how tests get precise control over elapsed time post-F1, instead of the
 * removed `TransitionEvidence.nowUTC` field. `advance()` mutates the
 * clock's current instant; every subsequent `store.transition(...)` /
 * `store.initialize(...)` call reads the new value.
 */
function makeFakeClock(startMs: number): { clock: () => string; advance: (ms: number) => void } {
  let current = isoAt(startMs)
  return {
    clock: () => current,
    advance: (ms: number) => {
      current = new Date(new Date(current).getTime() + ms).toISOString()
    },
  }
}

// =====================================================================
// Stage enum reuse — proves zero duplication of schema.ts's LifecycleStage
// =====================================================================

describe("LIFECYCLE_STAGES — reused from schema.ts, not redefined", () => {
  test("matches Model.shape.lifecycleStage.options exactly", () => {
    expect(LIFECYCLE_STAGES).toEqual(Model.shape.lifecycleStage.options)
  })

  test("has exactly the 8 documented stages", () => {
    expect(LIFECYCLE_STAGES).toEqual([
      "discovered",
      "metadata_validated",
      "probed",
      "low_risk_eligible",
      "general_eligible",
      "trusted_by_domain",
      "deprecated",
      "quarantined",
    ])
  })
})

// =====================================================================
// Structural transition graph — valid AND invalid edges
// =====================================================================

describe("transition graph — structural validity", () => {
  test("happy path: each stage advances to exactly the next stage", () => {
    expect(validTransitionsFrom("discovered")).toContain("metadata_validated")
    expect(validTransitionsFrom("metadata_validated")).toContain("probed")
    expect(validTransitionsFrom("probed")).toContain("low_risk_eligible")
    expect(validTransitionsFrom("low_risk_eligible")).toContain("general_eligible")
    expect(validTransitionsFrom("general_eligible")).toContain("trusted_by_domain")
  })

  test("quarantined is reachable from every non-terminal stage", () => {
    const nonTerminal: LifecycleStage[] = [
      "discovered",
      "metadata_validated",
      "probed",
      "low_risk_eligible",
      "general_eligible",
      "trusted_by_domain",
    ]
    for (const stage of nonTerminal) {
      expect(isStructurallyValidTransition(stage, "quarantined")).toBe(true)
    }
  })

  test("deprecated is reachable ONLY from low_risk_eligible, general_eligible, trusted_by_domain", () => {
    expect(isStructurallyValidTransition("low_risk_eligible", "deprecated")).toBe(true)
    expect(isStructurallyValidTransition("general_eligible", "deprecated")).toBe(true)
    expect(isStructurallyValidTransition("trusted_by_domain", "deprecated")).toBe(true)

    expect(isStructurallyValidTransition("discovered", "deprecated")).toBe(false)
    expect(isStructurallyValidTransition("metadata_validated", "deprecated")).toBe(false)
    expect(isStructurallyValidTransition("probed", "deprecated")).toBe(false)
  })

  test("deprecated and quarantined are terminal — zero outgoing transitions", () => {
    expect(isTerminalStage("deprecated")).toBe(true)
    expect(isTerminalStage("quarantined")).toBe(true)
    expect(validTransitionsFrom("deprecated")).toEqual([])
    expect(validTransitionsFrom("quarantined")).toEqual([])
    for (const target of LIFECYCLE_STAGES) {
      expect(isStructurallyValidTransition("deprecated", target)).toBe(false)
      expect(isStructurallyValidTransition("quarantined", target)).toBe(false)
    }
  })

  test("rejects skipping a stage (discovered -> probed directly)", () => {
    expect(isStructurallyValidTransition("discovered", "probed")).toBe(false)
  })

  test("rejects backward transitions (trusted_by_domain -> low_risk_eligible)", () => {
    expect(isStructurallyValidTransition("trusted_by_domain", "low_risk_eligible")).toBe(false)
  })

  test("rejects self-loops outside the documented graph (probed -> probed)", () => {
    expect(isStructurallyValidTransition("probed", "probed")).toBe(false)
  })

  test("every stage has an explicit entry in LIFECYCLE_TRANSITIONS", () => {
    for (const stage of LIFECYCLE_STAGES) {
      expect(LIFECYCLE_TRANSITIONS[stage]).toBeDefined()
    }
  })
})

// =====================================================================
// requiredExplicitActionKind mapping
// =====================================================================

describe("requiredExplicitActionKind", () => {
  test("quarantined requires quarantine", () => {
    expect(requiredExplicitActionKind("quarantined")).toBe("quarantine")
  })
  test("deprecated requires deprecate", () => {
    expect(requiredExplicitActionKind("deprecated")).toBe("deprecate")
  })
  test("trusted_by_domain requires grant_trust", () => {
    expect(requiredExplicitActionKind("trusted_by_domain")).toBe("grant_trust")
  })
  test("every other stage requires no explicit action", () => {
    for (const stage of ["discovered", "metadata_validated", "probed", "low_risk_eligible", "general_eligible"] as const) {
      expect(requiredExplicitActionKind(stage)).toBeNull()
    }
  })
})

// =====================================================================
// evaluatePromotionConditions — pure function, per-edge
// (from, to, enteredAtUTC, nowUTC, evidence) — nowUTC is now an explicit
// parameter, never a field read off `evidence`.
// =====================================================================

describe("evaluatePromotionConditions — discovered -> metadata_validated", () => {
  test("passes with at least one independent source", () => {
    const result = evaluatePromotionConditions(
      "discovered",
      "metadata_validated",
      isoAt(T0),
      isoAt(T0 + 1000),
      baseEvidence({ independentSourceCount: 1 }),
    )
    expect(result.allowed).toBe(true)
    expect(result.unmetConditions).toEqual([])
  })

  test("fails with zero independent sources", () => {
    const result = evaluatePromotionConditions(
      "discovered",
      "metadata_validated",
      isoAt(T0),
      isoAt(T0),
      baseEvidence({ independentSourceCount: 0 }),
    )
    expect(result.allowed).toBe(false)
    expect(result.unmetConditions.length).toBeGreaterThan(0)
  })
})

describe("evaluatePromotionConditions — probed -> low_risk_eligible", () => {
  test("fails when probation window has not elapsed", () => {
    const result = evaluatePromotionConditions(
      "probed",
      "low_risk_eligible",
      isoAt(T0),
      isoAt(T0 + MIN_PROBATION_MS - 1),
      baseEvidence({ health: baseHealth() }),
    )
    expect(result.allowed).toBe(false)
    expect(result.unmetConditions.some((r) => r.includes("probation"))).toBe(true)
  })

  test("fails when no health signal was ever recorded", () => {
    const result = evaluatePromotionConditions(
      "probed",
      "low_risk_eligible",
      isoAt(T0),
      isoAt(T0 + MIN_PROBATION_MS + 1),
      baseEvidence({ health: null }),
    )
    expect(result.allowed).toBe(false)
    expect(result.unmetConditions.some((r) => r.includes("health signal"))).toBe(true)
  })

  test("fails when availabilityScore is below the low-risk threshold", () => {
    const result = evaluatePromotionConditions(
      "probed",
      "low_risk_eligible",
      isoAt(T0),
      isoAt(T0 + MIN_PROBATION_MS + 1),
      baseEvidence({ health: baseHealth({ availabilityScore: LOW_RISK_MIN_AVAILABILITY - 0.01 }) }),
    )
    expect(result.allowed).toBe(false)
    expect(result.unmetConditions.some((r) => r.includes("availabilityScore"))).toBe(true)
  })

  test("fails when errorRate1h exceeds the low-risk threshold", () => {
    const result = evaluatePromotionConditions(
      "probed",
      "low_risk_eligible",
      isoAt(T0),
      isoAt(T0 + MIN_PROBATION_MS + 1),
      baseEvidence({ health: baseHealth({ errorRate1h: LOW_RISK_MAX_ERROR_RATE + 0.01 }) }),
    )
    expect(result.allowed).toBe(false)
    expect(result.unmetConditions.some((r) => r.includes("errorRate1h"))).toBe(true)
  })

  test("passes once probation elapsed and health thresholds are met", () => {
    const result = evaluatePromotionConditions(
      "probed",
      "low_risk_eligible",
      isoAt(T0),
      isoAt(T0 + MIN_PROBATION_MS + 1),
      baseEvidence({
        health: baseHealth({ availabilityScore: LOW_RISK_MIN_AVAILABILITY, errorRate1h: LOW_RISK_MAX_ERROR_RATE }),
      }),
    )
    expect(result.allowed).toBe(true)
    expect(result.unmetConditions).toEqual([])
  })
})

describe("evaluatePromotionConditions — low_risk_eligible -> general_eligible", () => {
  test("fails when the low-risk window has not elapsed", () => {
    const result = evaluatePromotionConditions(
      "low_risk_eligible",
      "general_eligible",
      isoAt(T0),
      isoAt(T0 + MIN_LOW_RISK_MS - 1),
      baseEvidence({
        health: baseHealth({ availabilityScore: GENERAL_MIN_AVAILABILITY, errorRate1h: GENERAL_MAX_ERROR_RATE }),
        hasBenchmarkResult: true,
      }),
    )
    expect(result.allowed).toBe(false)
    expect(result.unmetConditions.some((r) => r.includes("low-risk"))).toBe(true)
  })

  test("fails without a benchmark result even when health is excellent", () => {
    const result = evaluatePromotionConditions(
      "low_risk_eligible",
      "general_eligible",
      isoAt(T0),
      isoAt(T0 + MIN_LOW_RISK_MS + 1),
      baseEvidence({
        health: baseHealth({ availabilityScore: 0.999, errorRate1h: 0 }),
        hasBenchmarkResult: false,
      }),
    )
    expect(result.allowed).toBe(false)
    expect(result.unmetConditions.some((r) => r.includes("benchmark"))).toBe(true)
  })

  test("passes with elapsed window, stricter health thresholds met, and a benchmark result", () => {
    const result = evaluatePromotionConditions(
      "low_risk_eligible",
      "general_eligible",
      isoAt(T0),
      isoAt(T0 + MIN_LOW_RISK_MS + 1),
      baseEvidence({
        health: baseHealth({ availabilityScore: GENERAL_MIN_AVAILABILITY, errorRate1h: GENERAL_MAX_ERROR_RATE }),
        hasBenchmarkResult: true,
      }),
    )
    expect(result.allowed).toBe(true)
  })
})

describe("evaluatePromotionConditions — general_eligible -> trusted_by_domain", () => {
  test("fails when the general-eligible window has not elapsed", () => {
    const result = evaluatePromotionConditions(
      "general_eligible",
      "trusted_by_domain",
      isoAt(T0),
      isoAt(T0 + MIN_GENERAL_ELIGIBLE_MS - 1),
      baseEvidence({ health: baseHealth(), hasBenchmarkResult: true }),
    )
    expect(result.allowed).toBe(false)
    expect(result.unmetConditions.some((r) => r.includes("general-eligible"))).toBe(true)
  })

  test("passes on data conditions alone (explicit grant_trust action is enforced separately by the store)", () => {
    const result = evaluatePromotionConditions(
      "general_eligible",
      "trusted_by_domain",
      isoAt(T0),
      isoAt(T0 + MIN_GENERAL_ELIGIBLE_MS + 1),
      baseEvidence({ health: baseHealth(), hasBenchmarkResult: true }),
    )
    expect(result.allowed).toBe(true)
  })
})

describe("evaluatePromotionConditions — exceptional edges have no data-driven gate", () => {
  test("any -> quarantined is always data-allowed (gated structurally/procedurally elsewhere)", () => {
    const result = evaluatePromotionConditions("discovered", "quarantined", isoAt(T0), isoAt(T0), baseEvidence())
    expect(result.allowed).toBe(true)
    expect(result.unmetConditions).toEqual([])
  })

  test("eligible -> deprecated is always data-allowed (gated structurally/procedurally elsewhere)", () => {
    const result = evaluatePromotionConditions("general_eligible", "deprecated", isoAt(T0), isoAt(T0), baseEvidence())
    expect(result.allowed).toBe(true)
  })
})

// =====================================================================
// F1 regression — elapsed-time governance must fail CLOSED on malformed
// timestamps, never silently report allowed:true (independent E2 review,
// PROBE 4). Also proves the bypass/audit-corruption vectors (PROBE 1/2)
// are structurally gone: there is no `nowUTC` on `TransitionEvidence` for
// a caller to spoof in the first place.
// =====================================================================

describe("F1 regression — evaluatePromotionConditions fails closed on malformed timestamps", () => {
  test("malformed nowUTC does NOT silently report allowed:true (was the PROBE 4 fail-open bug)", () => {
    const result = evaluatePromotionConditions(
      "probed",
      "low_risk_eligible",
      isoAt(T0),
      "garbage",
      baseEvidence({ health: baseHealth({ availabilityScore: 0.99, errorRate1h: 0.01 }) }),
    )
    expect(result.allowed).toBe(false)
    expect(result.unmetConditions.some((r) => r.includes("failing closed"))).toBe(true)
  })

  test("malformed enteredAtUTC also fails closed, not open", () => {
    const result = evaluatePromotionConditions(
      "probed",
      "low_risk_eligible",
      "not-a-real-date",
      isoAt(T0 + MIN_PROBATION_MS + 1000),
      baseEvidence({ health: baseHealth({ availabilityScore: 0.99, errorRate1h: 0.01 }) }),
    )
    expect(result.allowed).toBe(false)
    expect(result.unmetConditions.some((r) => r.includes("failing closed"))).toBe(true)
  })

  test("a garbage timestamp on a transition with NO elapsed-time gate (discovered -> metadata_validated) is unaffected — the fail-closed check only fires where elapsed time is actually evaluated", () => {
    const result = evaluatePromotionConditions(
      "discovered",
      "metadata_validated",
      "garbage",
      "also-garbage",
      baseEvidence({ independentSourceCount: 1 }),
    )
    expect(result.allowed).toBe(true)
  })
})

// =====================================================================
// LifecycleStore — end-to-end valid happy-path traversal
// =====================================================================

describe("LifecycleStore — happy path traversal", () => {
  function freshStore(clock: () => string): LifecycleStore {
    const store = new LifecycleStore(clock)
    store.initialize("anthropic", "claude-sonnet-5")
    return store
  }

  test("initialize() sets stage to discovered, timestamped by the injected clock", () => {
    const fc = makeFakeClock(T0)
    const store = freshStore(fc.clock)
    expect(store.getStage("anthropic", "claude-sonnet-5")).toEqual({ stage: "discovered", enteredAtUTC: isoAt(T0) })
  })

  test("default clock (isoUtcNow) is used when none is injected", () => {
    const store = new LifecycleStore()
    const before = Date.now()
    store.initialize("openai", "gpt-9")
    const after = Date.now()
    const enteredMs = new Date(store.getStage("openai", "gpt-9").enteredAtUTC).getTime()
    // isoUtcNow() floors to the whole second, so allow a 1s tolerance window
    // on either side rather than asserting exact millisecond bounds.
    expect(enteredMs).toBeGreaterThanOrEqual(before - 1000)
    expect(enteredMs).toBeLessThanOrEqual(after + 1000)
  })

  test("double initialize() throws", () => {
    const fc = makeFakeClock(T0)
    const store = freshStore(fc.clock)
    expect(() => store.initialize("anthropic", "claude-sonnet-5")).toThrow(InvalidLifecycleTransitionError)
  })

  test("getStage on an untracked model throws UnknownModelStageError", () => {
    const store = new LifecycleStore()
    expect(() => store.getStage("openai", "gpt-9")).toThrow(UnknownModelStageError)
  })

  test("isTracked reflects initialize()", () => {
    const fc = makeFakeClock(T0)
    const store = freshStore(fc.clock)
    expect(store.isTracked("anthropic", "claude-sonnet-5")).toBe(true)
    expect(store.isTracked("openai", "gpt-9")).toBe(false)
  })

  test("full traversal discovered -> ... -> trusted_by_domain succeeds and is fully audited", () => {
    const fc = makeFakeClock(T0)
    const store = freshStore(fc.clock)
    const providerID = "anthropic"
    const modelID = "claude-sonnet-5"
    const seenTransitions: string[] = []
    const unsubscribe = store.onTransition((record) => seenTransitions.push(`${record.from}->${record.to}`))

    fc.advance(1000)
    store.transition(providerID, modelID, "metadata_validated", {
      independentSourceCount: 1,
      health: null,
      hasBenchmarkResult: false,
    })

    fc.advance(1000)
    store.transition(providerID, modelID, "probed", {
      independentSourceCount: 1,
      health: null,
      hasBenchmarkResult: false,
    })

    fc.advance(MIN_PROBATION_MS + 1)
    store.transition(providerID, modelID, "low_risk_eligible", {
      independentSourceCount: 1,
      health: baseHealth({ availabilityScore: LOW_RISK_MIN_AVAILABILITY, errorRate1h: LOW_RISK_MAX_ERROR_RATE }),
      hasBenchmarkResult: false,
    })

    fc.advance(MIN_LOW_RISK_MS + 1)
    store.transition(providerID, modelID, "general_eligible", {
      independentSourceCount: 1,
      health: baseHealth({ availabilityScore: GENERAL_MIN_AVAILABILITY, errorRate1h: GENERAL_MAX_ERROR_RATE }),
      hasBenchmarkResult: true,
    })

    fc.advance(MIN_GENERAL_ELIGIBLE_MS + 1)
    store.transition(providerID, modelID, "trusted_by_domain", {
      independentSourceCount: 1,
      health: baseHealth({ availabilityScore: GENERAL_MIN_AVAILABILITY, errorRate1h: GENERAL_MAX_ERROR_RATE }),
      hasBenchmarkResult: true,
      explicitAction: { kind: "grant_trust", actor: "erwan", reason: "manual review passed" },
    })

    expect(store.getStage(providerID, modelID).stage).toBe("trusted_by_domain")
    expect(seenTransitions).toEqual([
      "discovered->metadata_validated",
      "metadata_validated->probed",
      "probed->low_risk_eligible",
      "low_risk_eligible->general_eligible",
      "general_eligible->trusted_by_domain",
    ])
    expect(store.history(providerID, modelID).length).toBe(5)
    unsubscribe()
  })
})

// =====================================================================
// LifecycleStore — invalid transitions (structural)
// =====================================================================

describe("LifecycleStore — rejects invalid structural transitions", () => {
  function freshStore(clock: () => string): LifecycleStore {
    const store = new LifecycleStore(clock)
    store.initialize("anthropic", "claude-sonnet-5")
    return store
  }

  test("rejects skipping a stage (discovered -> probed)", () => {
    const fc = makeFakeClock(T0)
    const store = freshStore(fc.clock)
    expect(() => store.transition("anthropic", "claude-sonnet-5", "probed", baseEvidence())).toThrow(
      InvalidLifecycleTransitionError,
    )
    // store left unchanged
    expect(store.getStage("anthropic", "claude-sonnet-5").stage).toBe("discovered")
  })

  test("rejects transitioning out of a terminal stage (quarantined -> anything)", () => {
    const fc = makeFakeClock(T0)
    const store = freshStore(fc.clock)
    store.transition("anthropic", "claude-sonnet-5", "quarantined", {
      ...baseEvidence(),
      explicitAction: { kind: "quarantine", actor: "erwan", reason: "security finding" },
    })
    expect(() => store.transition("anthropic", "claude-sonnet-5", "discovered", baseEvidence())).toThrow(
      InvalidLifecycleTransitionError,
    )
    expect(() => store.transition("anthropic", "claude-sonnet-5", "metadata_validated", baseEvidence())).toThrow(
      InvalidLifecycleTransitionError,
    )
  })

  test("rejects transitioning out of terminal stage deprecated -> anything", () => {
    const fc = makeFakeClock(T0)
    const store = freshStore(fc.clock)
    store.transition("anthropic", "claude-sonnet-5", "metadata_validated", baseEvidence())
    store.transition("anthropic", "claude-sonnet-5", "probed", baseEvidence())
    fc.advance(MIN_PROBATION_MS + 1)
    store.transition("anthropic", "claude-sonnet-5", "low_risk_eligible", {
      independentSourceCount: 1,
      health: baseHealth({ availabilityScore: LOW_RISK_MIN_AVAILABILITY, errorRate1h: LOW_RISK_MAX_ERROR_RATE }),
      hasBenchmarkResult: false,
    })
    store.transition("anthropic", "claude-sonnet-5", "deprecated", {
      ...baseEvidence(),
      explicitAction: {
        kind: "deprecate",
        actor: "erwan",
        reason: "superseded",
        replacement: null,
        explicitlyNoReplacement: true,
      },
    })
    expect(() =>
      store.transition("anthropic", "claude-sonnet-5", "quarantined", {
        ...baseEvidence(),
        explicitAction: { kind: "quarantine", actor: "erwan", reason: "x" },
      }),
    ).toThrow(InvalidLifecycleTransitionError)
  })
})

// =====================================================================
// LifecycleStore — invalid transitions (unmet promotion conditions)
// =====================================================================

describe("LifecycleStore — rejects transitions with unmet promotion conditions", () => {
  test("rejects probed -> low_risk_eligible before probation window elapses", () => {
    const fc = makeFakeClock(T0)
    const store = new LifecycleStore(fc.clock)
    store.initialize("anthropic", "claude-sonnet-5")
    store.transition("anthropic", "claude-sonnet-5", "metadata_validated", baseEvidence())
    store.transition("anthropic", "claude-sonnet-5", "probed", baseEvidence())

    fc.advance(1) // far short of MIN_PROBATION_MS
    let captured: unknown = null
    try {
      store.transition("anthropic", "claude-sonnet-5", "low_risk_eligible", {
        independentSourceCount: 1,
        health: baseHealth(),
        hasBenchmarkResult: false,
      })
    } catch (e) {
      captured = e
    }
    expect(captured).toBeInstanceOf(LifecyclePromotionConditionsNotMetError)
    expect(
      (captured as InstanceType<typeof LifecyclePromotionConditionsNotMetError>).data.unmetConditions.length,
    ).toBeGreaterThan(0)
    // store left unchanged on rejection
    expect(store.getStage("anthropic", "claude-sonnet-5").stage).toBe("probed")
  })
})

// =====================================================================
// LifecycleStore — mandatory explicit actions
// =====================================================================

describe("LifecycleStore — mandatory explicit action for quarantine/deprecate/trust", () => {
  test("rejects quarantine attempt with no explicitAction at all", () => {
    const fc = makeFakeClock(T0)
    const store = new LifecycleStore(fc.clock)
    store.initialize("anthropic", "claude-sonnet-5")
    expect(() => store.transition("anthropic", "claude-sonnet-5", "quarantined", baseEvidence())).toThrow(
      MissingExplicitActionError,
    )
  })

  test("rejects quarantine attempt when explicitAction.kind mismatches (deprecate supplied instead of quarantine)", () => {
    const fc = makeFakeClock(T0)
    const store = new LifecycleStore(fc.clock)
    store.initialize("anthropic", "claude-sonnet-5")
    expect(() =>
      store.transition("anthropic", "claude-sonnet-5", "quarantined", {
        ...baseEvidence(),
        explicitAction: {
          kind: "deprecate",
          actor: "erwan",
          reason: "wrong kind on purpose",
          replacement: null,
          explicitlyNoReplacement: true,
        },
      }),
    ).toThrow(MissingExplicitActionError)
  })

  test("quarantine succeeds immediately from an early stage — no elapsed-time or health precondition", () => {
    const fc = makeFakeClock(T0)
    const store = new LifecycleStore(fc.clock)
    store.initialize("anthropic", "claude-sonnet-5")
    fc.advance(1)
    const record = store.transition("anthropic", "claude-sonnet-5", "quarantined", {
      independentSourceCount: 0,
      health: null,
      hasBenchmarkResult: false,
      explicitAction: { kind: "quarantine", actor: "erwan", reason: "policy violation discovered" },
    })
    expect(record.to).toBe("quarantined")
    expect(record.deprecationSignal).toBeNull()
  })

  test("rejects trusted_by_domain attempt with no explicitAction even if data conditions are satisfied", () => {
    const fc = makeFakeClock(T0)
    const store = new LifecycleStore(fc.clock)
    store.initialize("anthropic", "claude-sonnet-5")
    store.transition("anthropic", "claude-sonnet-5", "metadata_validated", baseEvidence())
    store.transition("anthropic", "claude-sonnet-5", "probed", baseEvidence())
    fc.advance(MIN_PROBATION_MS + 1)
    store.transition("anthropic", "claude-sonnet-5", "low_risk_eligible", {
      independentSourceCount: 1,
      health: baseHealth({ availabilityScore: LOW_RISK_MIN_AVAILABILITY, errorRate1h: LOW_RISK_MAX_ERROR_RATE }),
      hasBenchmarkResult: false,
    })
    fc.advance(MIN_LOW_RISK_MS + 1)
    store.transition("anthropic", "claude-sonnet-5", "general_eligible", {
      independentSourceCount: 1,
      health: baseHealth({ availabilityScore: GENERAL_MIN_AVAILABILITY, errorRate1h: GENERAL_MAX_ERROR_RATE }),
      hasBenchmarkResult: true,
    })

    fc.advance(MIN_GENERAL_ELIGIBLE_MS + 1)
    expect(() =>
      store.transition("anthropic", "claude-sonnet-5", "trusted_by_domain", {
        independentSourceCount: 1,
        health: baseHealth({ availabilityScore: GENERAL_MIN_AVAILABILITY, errorRate1h: GENERAL_MAX_ERROR_RATE }),
        hasBenchmarkResult: true,
        // no explicitAction — must be rejected even though data conditions pass
      }),
    ).toThrow(MissingExplicitActionError)
  })

  test("rejects trusted_by_domain with grant_trust action but unmet data conditions (action alone is not sufficient)", () => {
    const fc = makeFakeClock(T0)
    const store = new LifecycleStore(fc.clock)
    store.initialize("anthropic", "claude-sonnet-5")
    store.transition("anthropic", "claude-sonnet-5", "metadata_validated", baseEvidence())
    store.transition("anthropic", "claude-sonnet-5", "probed", baseEvidence())
    fc.advance(MIN_PROBATION_MS + 1)
    store.transition("anthropic", "claude-sonnet-5", "low_risk_eligible", {
      independentSourceCount: 1,
      health: baseHealth({ availabilityScore: LOW_RISK_MIN_AVAILABILITY, errorRate1h: LOW_RISK_MAX_ERROR_RATE }),
      hasBenchmarkResult: false,
    })
    fc.advance(MIN_LOW_RISK_MS + 1)
    store.transition("anthropic", "claude-sonnet-5", "general_eligible", {
      independentSourceCount: 1,
      health: baseHealth({ availabilityScore: GENERAL_MIN_AVAILABILITY, errorRate1h: GENERAL_MAX_ERROR_RATE }),
      hasBenchmarkResult: true,
    })

    fc.advance(1) // far short of MIN_GENERAL_ELIGIBLE_MS
    expect(() =>
      store.transition("anthropic", "claude-sonnet-5", "trusted_by_domain", {
        independentSourceCount: 1,
        health: baseHealth({ availabilityScore: GENERAL_MIN_AVAILABILITY, errorRate1h: GENERAL_MAX_ERROR_RATE }),
        hasBenchmarkResult: true,
        explicitAction: { kind: "grant_trust", actor: "erwan", reason: "premature" },
      }),
    ).toThrow(LifecyclePromotionConditionsNotMetError)
  })
})

// =====================================================================
// LifecycleStore — deprecation replacement policy
// =====================================================================

describe("LifecycleStore — deprecation always carries a replacement policy", () => {
  function eligibleStore(clock: () => string, advance: (ms: number) => void): LifecycleStore {
    const store = new LifecycleStore(clock)
    store.initialize("anthropic", "claude-sonnet-4")
    store.transition("anthropic", "claude-sonnet-4", "metadata_validated", baseEvidence())
    store.transition("anthropic", "claude-sonnet-4", "probed", baseEvidence())
    advance(MIN_PROBATION_MS + 1)
    store.transition("anthropic", "claude-sonnet-4", "low_risk_eligible", {
      independentSourceCount: 1,
      health: baseHealth({ availabilityScore: LOW_RISK_MIN_AVAILABILITY, errorRate1h: LOW_RISK_MAX_ERROR_RATE }),
      hasBenchmarkResult: false,
    })
    return store
  }

  test("rejects deprecate action with neither replacement nor explicitlyNoReplacement", () => {
    const fc = makeFakeClock(T0)
    const store = eligibleStore(fc.clock, fc.advance)
    expect(() =>
      store.transition("anthropic", "claude-sonnet-4", "deprecated", {
        ...baseEvidence(),
        explicitAction: {
          kind: "deprecate",
          actor: "erwan",
          reason: "superseded by claude-sonnet-5",
          replacement: null,
          explicitlyNoReplacement: false,
        },
      }),
    ).toThrow(MissingReplacementPolicyError)
    // store left unchanged on rejection
    expect(store.getStage("anthropic", "claude-sonnet-4").stage).toBe("low_risk_eligible")
  })

  test("accepts deprecate action with an explicit replacement model, warning mentions it", () => {
    const fc = makeFakeClock(T0)
    const store = eligibleStore(fc.clock, fc.advance)
    const record = store.transition("anthropic", "claude-sonnet-4", "deprecated", {
      ...baseEvidence(),
      explicitAction: {
        kind: "deprecate",
        actor: "erwan",
        reason: "superseded by claude-sonnet-5",
        replacement: { providerID: "anthropic", modelID: "claude-sonnet-5" },
        explicitlyNoReplacement: false,
      },
    })
    expect(record.deprecationSignal).not.toBeNull()
    expect(record.deprecationSignal!.policy.replacement).toEqual({ providerID: "anthropic", modelID: "claude-sonnet-5" })
    expect(record.deprecationSignal!.warning).toContain("anthropic/claude-sonnet-5")
    expect(record.deprecationSignal!.warning.length).toBeGreaterThan(0)
  })

  test("accepts deprecate action with explicitlyNoReplacement: true and no replacement model", () => {
    const fc = makeFakeClock(T0)
    const store = eligibleStore(fc.clock, fc.advance)
    const record = store.transition("anthropic", "claude-sonnet-4", "deprecated", {
      ...baseEvidence(),
      explicitAction: {
        kind: "deprecate",
        actor: "erwan",
        reason: "discontinued, no successor planned",
        replacement: null,
        explicitlyNoReplacement: true,
      },
    })
    expect(record.deprecationSignal).not.toBeNull()
    expect(record.deprecationSignal!.policy.replacement).toBeNull()
    expect(record.deprecationSignal!.policy.explicitlyNoReplacement).toBe(true)
    expect(record.deprecationSignal!.warning).toContain("no replacement is currently designated")
  })
})

// =====================================================================
// F1 regression — LifecycleStore end-to-end: the clock is the ONLY
// source of `enteredAtUTC` / audit `atUTC`, and cannot be overridden
// per-call even by a caller that bypasses TypeScript.
// =====================================================================

describe("F1 regression — LifecycleStore clock governance (independent E2 review)", () => {
  test("enteredAtUTC and the audit log's atUTC always come from the store's injected clock, never from evidence", () => {
    const fc = makeFakeClock(T0)
    const store = new LifecycleStore(fc.clock)
    store.initialize("anthropic", "claude-sonnet-5")
    fc.advance(500)
    const record = store.transition("anthropic", "claude-sonnet-5", "metadata_validated", baseEvidence())
    expect(record.atUTC).toBe(isoAt(T0 + 500))
    expect(store.getStage("anthropic", "claude-sonnet-5").enteredAtUTC).toBe(isoAt(T0 + 500))
  })

  test("a caller cannot shorten a probation window by advancing the clock less than the real threshold — the same trusted clock instance is the only timeline", () => {
    const fc = makeFakeClock(T0)
    const store = new LifecycleStore(fc.clock)
    store.initialize("anthropic", "claude-sonnet-5")
    store.transition("anthropic", "claude-sonnet-5", "metadata_validated", baseEvidence())
    store.transition("anthropic", "claude-sonnet-5", "probed", baseEvidence())

    // Advance by far less than MIN_PROBATION_MS.
    fc.advance(1000)
    expect(() =>
      store.transition("anthropic", "claude-sonnet-5", "low_risk_eligible", {
        independentSourceCount: 1,
        health: baseHealth({ availabilityScore: 0.99, errorRate1h: 0.01 }),
        hasBenchmarkResult: false,
      }),
    ).toThrow(LifecyclePromotionConditionsNotMetError)
    expect(store.getStage("anthropic", "claude-sonnet-5").stage).toBe("probed")
  })

  test("TransitionEvidence has no timestamp field to spoof in the first place — even a caller that bypasses TypeScript and injects a nowUTC-shaped property gets no effect, because transition() never reads anything but this.clock()", () => {
    const fc = makeFakeClock(T0)
    const store = new LifecycleStore(fc.clock)
    store.initialize("anthropic", "claude-sonnet-5")
    store.transition("anthropic", "claude-sonnet-5", "metadata_validated", baseEvidence())
    store.transition("anthropic", "claude-sonnet-5", "probed", baseEvidence())

    // Simulate a non-TypeScript caller (or a `.d.ts` mismatch) attaching a
    // spoofed timestamp-shaped field onto the evidence object. The real
    // TransitionEvidence type has no such field, so this requires an
    // explicit unsafe cast — proving the attempt is only possible by
    // deliberately defeating the type system, and that doing so still has
    // no effect at runtime.
    const spoofed = {
      ...baseEvidence({ health: baseHealth({ availabilityScore: 0.99, errorRate1h: 0.01 }) }),
      nowUTC: "2099-01-01T00:00:00.000Z",
    } as unknown as TransitionEvidence

    fc.advance(1) // only 1ms of real elapsed time on the trusted clock
    expect(() => store.transition("anthropic", "claude-sonnet-5", "low_risk_eligible", spoofed)).toThrow(
      LifecyclePromotionConditionsNotMetError,
    )
    expect(store.getStage("anthropic", "claude-sonnet-5").stage).toBe("probed")
  })

  test("initialize() no longer accepts a caller-supplied atUTC — the signature only takes providerID/modelID", () => {
    const fc = makeFakeClock(T0)
    const store = new LifecycleStore(fc.clock)
    store.initialize("anthropic", "claude-sonnet-5")
    expect(store.getStage("anthropic", "claude-sonnet-5").enteredAtUTC).toBe(isoAt(T0))
  })
})
