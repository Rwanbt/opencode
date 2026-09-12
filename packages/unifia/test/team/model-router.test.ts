import { describe, expect, it } from "bun:test"
import {
  BUILTIN_ROUTING_POLICIES,
  customRoutingPolicy,
  estimateExpectedCost,
  ModelRouterInputError,
  ROUTING_POLICY_VERSION,
  ROUTING_SNAPSHOT_VERSION,
  routeModel,
  type RoutingCandidate,
  type TaskProfile,
} from "../../src/team/model-router"

function candidate(overrides: Partial<RoutingCandidate> = {}): RoutingCandidate {
  return {
    providerID: "anthropic",
    modelID: "sonnet",
    releaseKey: "sonnet-4.5",
    family: "claude",
    costPerMillionInputTokens: 3,
    costPerMillionOutputTokens: 15,
    contextTotalTokens: 200_000,
    availabilityScore: 0.99,
    perAttemptSuccessProbability: 0.9,
    qualitySource: "benchmark",
    qualityConfidence: 0.9,
    ...overrides,
  }
}

function task(overrides: Partial<TaskProfile> = {}): TaskProfile {
  return {
    expectedInputTokens: 20_000,
    expectedOutputTokens: 4_000,
    maxAttempts: 3,
    repairCostFactor: 0.5,
    requiresIndependentReviewer: false,
    requiredContextTokens: 32_000,
    ...overrides,
  }
}

describe("estimateExpectedCost", () => {
  const resolved = {
    expectedInputTokens: 1_000_000,
    expectedOutputTokens: 0,
    maxAttempts: 2,
    repairCostFactor: 0,
    requiresIndependentReviewer: false,
    requiredContextTokens: 1,
  } as const

  it("costs every expected attempt, not just the first", () => {
    const certain = estimateExpectedCost(
      candidate({ perAttemptSuccessProbability: 1, costPerMillionInputTokens: 10 }),
      resolved,
      null,
      0,
    )
    const flaky = estimateExpectedCost(
      candidate({ perAttemptSuccessProbability: 0.5, costPerMillionInputTokens: 10 }),
      resolved,
      null,
      0,
    )

    expect(certain.expectedAttempts).toBe(1)
    expect(certain.implementationCostUsd).toBeCloseTo(10, 6)
    // 1 + (1-0.5) = 1.5 expected attempts under a 2-attempt cap.
    expect(flaky.expectedAttempts).toBeCloseTo(1.5, 6)
    expect(flaky.implementationCostUsd).toBeCloseTo(15, 6)
  })

  it("spends every attempt when success is impossible", () => {
    const hopeless = estimateExpectedCost(candidate({ perAttemptSuccessProbability: 0 }), resolved, null, 0)

    expect(hopeless.expectedAttempts).toBe(2)
    expect(hopeless.successProbability).toBe(0)
  })

  it("charges the fallback leg in proportion to the chance of needing it", () => {
    const withFallback = estimateExpectedCost(
      candidate({ perAttemptSuccessProbability: 0.5, costPerMillionInputTokens: 0 }),
      resolved,
      null,
      100,
    )

    // (1-0.5)^2 = 0.25 chance of exhausting attempts.
    expect(withFallback.fallbackCostUsd).toBeCloseTo(25, 6)
    expect(withFallback.successProbability).toBeCloseTo(0.75, 6)
  })

  it("adds repair and review cost on top of implementation", () => {
    const bare = estimateExpectedCost(candidate({ perAttemptSuccessProbability: 0.5 }), resolved, null, 0)
    const withExtras = estimateExpectedCost(
      candidate({ perAttemptSuccessProbability: 0.5 }),
      { ...resolved, repairCostFactor: 1 },
      candidate({ providerID: "other", family: "gpt" }),
      0,
    )

    expect(withExtras.repairCostUsd).toBeGreaterThan(0)
    expect(withExtras.reviewCostUsd).toBeGreaterThan(0)
    expect(withExtras.totalCostUsd).toBeGreaterThan(bare.totalCostUsd)
  })
})

describe("routeModel — acceptance: no premium model without required gain", () => {
  const cheapAdequate = candidate({
    providerID: "budget",
    modelID: "small",
    family: "small",
    costPerMillionInputTokens: 1,
    costPerMillionOutputTokens: 2,
    perAttemptSuccessProbability: 0.95,
  })
  const premiumMarginal = candidate({
    providerID: "premium",
    modelID: "xl",
    family: "xl",
    costPerMillionInputTokens: 60,
    costPerMillionOutputTokens: 120,
    // Only a hair better per attempt; over 3 attempts the overall gain is tiny.
    perAttemptSuccessProbability: 0.96,
  })

  it("economy keeps the cheap adequate model and explains the rejection", () => {
    const result = routeModel({
      candidates: [cheapAdequate, premiumMarginal],
      task: task(),
      policy: BUILTIN_ROUTING_POLICIES.economy,
    })

    expect(result.selected!.providerID).toBe("budget")
    const cut = result.eliminated.find((item) => item.providerID === "premium")!
    // Under economy every candidate is inside the quality band (its
    // threshold is unreachable), so the premium option loses purely on cost.
    expect(cut.rejection).toBe("NOT_SELECTED_COSTLIER_EQUAL_QUALITY")
    expect(cut.reason).toContain("quality band")
  })

  it("quality also refuses the premium model when the gain is below its threshold", () => {
    const result = routeModel({
      candidates: [cheapAdequate, premiumMarginal],
      task: task(),
      policy: BUILTIN_ROUTING_POLICIES.quality,
    })

    // Both clear quality's 0.9 floor; over 3 attempts 0.95 -> 0.999875 and
    // 0.96 -> 0.999936, a gain far under quality's 0.02 requirement.
    expect(result.selected!.providerID).toBe("budget")
  })

  it("never pays more than a cheaper candidate inside the same quality band", () => {
    // Regression for a greedy-chain selection that compared each candidate
    // only against the running incumbent: "mid" was rejected against
    // "cheap", then "dear" cleared the threshold against "cheap" and won —
    // paying ~10x more than "mid" for +0.02 success. Values are chosen to
    // subtract cleanly in binary floating point.
    const threshold = 0.09
    const policy = customRoutingPolicy({
      minSuccessProbability: 0.15,
      maxExpectedCostUsd: null,
      minSuccessGainForUpgrade: threshold,
      minAvailabilityScore: 0.5,
      minReviewerSuccessProbability: 0.5,
    })
    const oneAttempt = task({
      expectedInputTokens: 1_000_000,
      expectedOutputTokens: 0,
      maxAttempts: 1,
      repairCostFactor: 0,
      requiredContextTokens: 1_000,
    })
    const candidates = [
      candidate({ providerID: "pa", modelID: "cheap", costPerMillionInputTokens: 1, perAttemptSuccessProbability: 0.2 }),
      candidate({ providerID: "pb", modelID: "mid", costPerMillionInputTokens: 10, perAttemptSuccessProbability: 0.28 }),
      candidate({ providerID: "pc", modelID: "dear", costPerMillionInputTokens: 99, perAttemptSuccessProbability: 0.3 }),
    ]

    const result = routeModel({ candidates, task: oneAttempt, policy })

    expect(result.selected!.modelID).toBe("mid")

    // The invariant is anchored on the BEST available option, not on
    // pairwise comparisons — pairwise chaining is what produced the bug.
    // Selected must sit inside the quality band, and nothing cheaper may.
    const best = Math.max(...candidates.map((item) => item.perAttemptSuccessProbability))
    const selected = candidates.find((item) => item.modelID === result.selected!.modelID)!
    expect(best - selected.perAttemptSuccessProbability).toBeLessThanOrEqual(threshold)
    for (const other of candidates) {
      if (other.costPerMillionInputTokens >= selected.costPerMillionInputTokens) continue
      expect(best - other.perAttemptSuccessProbability).toBeGreaterThan(threshold)
    }
  })

  it("is unaffected by an intermediate candidate appearing or disappearing", () => {
    const policy = customRoutingPolicy({
      minSuccessProbability: 0.15,
      maxExpectedCostUsd: null,
      minSuccessGainForUpgrade: 0.09,
      minAvailabilityScore: 0.5,
      minReviewerSuccessProbability: 0.5,
    })
    const oneAttempt = task({
      expectedInputTokens: 1_000_000,
      expectedOutputTokens: 0,
      maxAttempts: 1,
      repairCostFactor: 0,
      requiredContextTokens: 1_000,
    })
    const cheap = candidate({
      providerID: "pa",
      modelID: "cheap",
      costPerMillionInputTokens: 1,
      perAttemptSuccessProbability: 0.2,
    })
    const dear = candidate({
      providerID: "pc",
      modelID: "dear",
      costPerMillionInputTokens: 99,
      perAttemptSuccessProbability: 0.3,
    })
    const mid = candidate({
      providerID: "pb",
      modelID: "mid",
      costPerMillionInputTokens: 10,
      perAttemptSuccessProbability: 0.28,
    })

    // Without "mid", "dear" is the only way to reach the top of the band.
    expect(routeModel({ candidates: [cheap, dear], task: oneAttempt, policy }).selected!.modelID).toBe("dear")
    // Adding "mid" must make it the winner — a cheaper route to the same
    // band — and must never leave "dear" selected.
    expect(routeModel({ candidates: [cheap, mid, dear], task: oneAttempt, policy }).selected!.modelID).toBe("mid")
  })

  it("does buy the premium model when the gain is real", () => {
    const weakCheap = candidate({
      providerID: "budget",
      modelID: "small",
      family: "small",
      costPerMillionInputTokens: 1,
      costPerMillionOutputTokens: 2,
      perAttemptSuccessProbability: 0.5,
    })
    const strongPremium = candidate({
      providerID: "premium",
      modelID: "xl",
      family: "xl",
      costPerMillionInputTokens: 60,
      costPerMillionOutputTokens: 120,
      perAttemptSuccessProbability: 0.99,
    })

    const result = routeModel({
      candidates: [weakCheap, strongPremium],
      task: task({ maxAttempts: 1 }),
      policy: BUILTIN_ROUTING_POLICIES.balanced,
    })

    expect(result.selected!.providerID).toBe("premium")
    const cut = result.eliminated.find((item) => item.providerID === "budget")!
    expect(cut.rejection).toBe("BELOW_MIN_SUCCESS_PROBABILITY")
  })
})

describe("routeModel — acceptance: incompatible economy model is rejected", () => {
  it("rejects a cheap model that cannot reach the minimum success probability", () => {
    const tooWeak = candidate({
      providerID: "budget",
      modelID: "tiny",
      costPerMillionInputTokens: 0.1,
      costPerMillionOutputTokens: 0.2,
      perAttemptSuccessProbability: 0.1,
    })

    const result = routeModel({
      candidates: [tooWeak],
      task: task({ maxAttempts: 1 }),
      policy: BUILTIN_ROUTING_POLICIES.economy,
    })

    expect(result.blocked).toBe(true)
    expect(result.selected).toBeNull()
    expect(result.eliminated[0]!.rejection).toBe("BELOW_MIN_SUCCESS_PROBABILITY")
  })

  it("rejects a cheap model whose context is too small for the task", () => {
    const result = routeModel({
      candidates: [candidate({ providerID: "budget", contextTotalTokens: 8_000 })],
      task: task({ requiredContextTokens: 128_000 }),
      policy: BUILTIN_ROUTING_POLICIES.economy,
    })

    expect(result.blocked).toBe(true)
    expect(result.eliminated[0]!.rejection).toBe("CONTEXT_TOO_SMALL")
  })

  it("rejects a cheap model below the policy's availability floor", () => {
    const result = routeModel({
      candidates: [candidate({ providerID: "budget", availabilityScore: 0.5 })],
      task: task(),
      policy: BUILTIN_ROUTING_POLICIES.economy,
    })

    expect(result.blocked).toBe(true)
    expect(result.eliminated[0]!.rejection).toBe("BELOW_MIN_AVAILABILITY")
  })
})

describe("routeModel — no silent degradation", () => {
  it("blocks instead of returning the least-bad option when nothing clears the policy", () => {
    const result = routeModel({
      candidates: [
        candidate({ providerID: "a", modelID: "1", perAttemptSuccessProbability: 0.2 }),
        candidate({ providerID: "b", modelID: "2", perAttemptSuccessProbability: 0.3 }),
      ],
      task: task({ maxAttempts: 1 }),
      policy: BUILTIN_ROUTING_POLICIES.quality,
    })

    expect(result.blocked).toBe(true)
    expect(result.selected).toBeNull()
    expect(result.blockingReasons[0]).toContain("minimum success probability")
    // Every candidate still gets an explanation.
    expect(result.eliminated).toHaveLength(2)
  })

  it("blocks when a budget ceiling excludes every candidate", () => {
    const result = routeModel({
      candidates: [candidate()],
      task: task(),
      policy: customRoutingPolicy({
        minSuccessProbability: 0.5,
        maxExpectedCostUsd: 0.000_001,
        minSuccessGainForUpgrade: 0.1,
        minAvailabilityScore: 0.5,
        minReviewerSuccessProbability: 0.5,
      }),
    })

    expect(result.blocked).toBe(true)
    expect(result.eliminated[0]!.rejection).toBe("OVER_EXPECTED_BUDGET")
  })

  it("blocks when an independent reviewer is required but none is independent", () => {
    const result = routeModel({
      // Same family throughout: nobody can review anybody.
      candidates: [
        candidate({ providerID: "a", modelID: "1", family: "claude" }),
        candidate({ providerID: "b", modelID: "2", family: "claude" }),
      ],
      task: task({ requiresIndependentReviewer: true }),
      policy: BUILTIN_ROUTING_POLICIES.balanced,
    })

    expect(result.blocked).toBe(true)
    expect(result.selected).toBeNull()
    expect(result.blockingReasons.some((reason) => reason.includes("independent reviewer"))).toBe(true)
  })

  it("blocks on an empty candidate set rather than inventing a route", () => {
    const result = routeModel({ candidates: [], task: task(), policy: BUILTIN_ROUTING_POLICIES.balanced })

    expect(result.blocked).toBe(true)
    expect(result.blockingReasons).toEqual(["no candidate supplied"])
  })
})

describe("routeModel — reviewer and fallback selection", () => {
  it("picks a reviewer from a different family and a fallback from a different provider", () => {
    const result = routeModel({
      candidates: [
        candidate({ providerID: "anthropic", modelID: "sonnet", family: "claude" }),
        candidate({ providerID: "openai", modelID: "gpt", family: "gpt", costPerMillionInputTokens: 4 }),
      ],
      task: task({ requiresIndependentReviewer: true }),
      policy: BUILTIN_ROUTING_POLICIES.balanced,
    })

    expect(result.blocked).toBe(false)
    expect(result.reviewerEndpointKey).toBe("openai::gpt")
    expect(result.fallbackEndpointKey).toBe("openai::gpt")
  })

  it("never proposes a same-provider fallback", () => {
    const result = routeModel({
      candidates: [
        candidate({ providerID: "solo", modelID: "a", family: "x" }),
        candidate({ providerID: "solo", modelID: "b", family: "x", costPerMillionInputTokens: 4 }),
      ],
      task: task(),
      policy: BUILTIN_ROUTING_POLICIES.balanced,
    })

    expect(result.fallbackEndpointKey).toBeNull()
    expect(result.confidenceFactors.some((factor) => factor.includes("fallback"))).toBe(true)
  })

  it("never treats a null-family endpoint as an independent reviewer", () => {
    const result = routeModel({
      candidates: [
        candidate({ providerID: "a", modelID: "1", family: "claude" }),
        candidate({ providerID: "b", modelID: "2", family: null }),
      ],
      task: task({ requiresIndependentReviewer: true }),
      policy: BUILTIN_ROUTING_POLICIES.balanced,
    })

    expect(result.blocked).toBe(true)
    expect(result.blockingReasons.some((reason) => reason.includes("independent reviewer"))).toBe(true)
  })
})

describe("routeModel — versioned, reproducible snapshots", () => {
  const candidates = [
    candidate({ providerID: "a", modelID: "1", family: "x", costPerMillionInputTokens: 2 }),
    candidate({ providerID: "b", modelID: "2", family: "y", costPerMillionInputTokens: 5 }),
  ]

  it("stamps the snapshot and policy versions", () => {
    const result = routeModel({ candidates, task: task(), policy: BUILTIN_ROUTING_POLICIES.balanced })

    expect(result.snapshotVersion).toBe(ROUTING_SNAPSHOT_VERSION)
    expect(result.policyVersion).toBe(ROUTING_POLICY_VERSION)
    expect(result.policyName).toBe("balanced")
  })

  it("is reproducible for the same input and independent of candidate order", () => {
    const first = routeModel({ candidates, task: task(), policy: BUILTIN_ROUTING_POLICIES.balanced })
    const reordered = routeModel({
      candidates: [...candidates].reverse(),
      task: task(),
      policy: BUILTIN_ROUTING_POLICIES.balanced,
    })

    expect(reordered.reproducibilityKey).toBe(first.reproducibilityKey)
    expect(reordered.selected!.endpointKey).toBe(first.selected!.endpointKey)
    expect(reordered.consideredEndpointKeys).toEqual(first.consideredEndpointKeys)
  })

  it("changes the reproducibility key when the policy changes", () => {
    const balanced = routeModel({ candidates, task: task(), policy: BUILTIN_ROUTING_POLICIES.balanced })
    const economy = routeModel({ candidates, task: task(), policy: BUILTIN_ROUTING_POLICIES.economy })

    expect(economy.reproducibilityKey).not.toBe(balanced.reproducibilityKey)
  })

  it("changes the reproducibility key when a quality signal changes", () => {
    const base = routeModel({ candidates, task: task(), policy: BUILTIN_ROUTING_POLICIES.balanced })
    const shifted = routeModel({
      candidates: [{ ...candidates[0]!, perAttemptSuccessProbability: 0.91 }, candidates[1]!],
      task: task(),
      policy: BUILTIN_ROUTING_POLICIES.balanced,
    })

    expect(shifted.reproducibilityKey).not.toBe(base.reproducibilityKey)
  })

  it("records signal provenance and every considered candidate", () => {
    const result = routeModel({
      candidates: [
        candidate({ providerID: "a", modelID: "1", family: "x", qualitySource: "benchmark" }),
        candidate({ providerID: "b", modelID: "2", family: "y", qualitySource: "default" }),
      ],
      task: task(),
      policy: BUILTIN_ROUTING_POLICIES.balanced,
    })

    expect(result.qualitySources).toEqual({ benchmark: 1, default: 1 })
    expect(result.consideredEndpointKeys).toEqual(["a::1", "b::2"])
  })

  it("caps confidence at the weakest load-bearing signal", () => {
    const result = routeModel({
      candidates: [
        candidate({ providerID: "a", modelID: "1", family: "x", qualityConfidence: 0.3, qualitySource: "default" }),
        candidate({ providerID: "b", modelID: "2", family: "y", costPerMillionInputTokens: 40 }),
      ],
      task: task(),
      policy: BUILTIN_ROUTING_POLICIES.economy,
    })

    expect(result.selected!.endpointKey).toBe("a::1")
    expect(result.confidence).toBeLessThanOrEqual(0.3)
    expect(result.confidenceFactors[0]).toContain("default")
  })
})

describe("routeModel — policy identity", () => {
  it("built-in policies are frozen so a caller cannot mutate shared rules", () => {
    expect(Object.isFrozen(BUILTIN_ROUTING_POLICIES)).toBe(true)
    expect(Object.isFrozen(BUILTIN_ROUTING_POLICIES.economy)).toBe(true)
  })

  it("economy never upgrades on price by construction", () => {
    // Probabilities live in [0,1], so a gain of >1 can never be observed.
    expect(BUILTIN_ROUTING_POLICIES.economy.minSuccessGainForUpgrade).toBeGreaterThan(1)
  })

  it("orders the built-in policies from permissive to demanding", () => {
    const { economy, balanced, quality } = BUILTIN_ROUTING_POLICIES

    expect(economy.minSuccessProbability).toBeLessThan(balanced.minSuccessProbability)
    expect(balanced.minSuccessProbability).toBeLessThan(quality.minSuccessProbability)
    expect(quality.minSuccessGainForUpgrade).toBeLessThan(balanced.minSuccessGainForUpgrade)
  })

  it("rejects a custom policy with out-of-range thresholds", () => {
    expect(() =>
      customRoutingPolicy({
        minSuccessProbability: 1.5,
        maxExpectedCostUsd: null,
        minSuccessGainForUpgrade: 0.1,
        minAvailabilityScore: 0.5,
        minReviewerSuccessProbability: 0.5,
      }),
    ).toThrow(ModelRouterInputError)
  })
})

describe("routeModel — boundaries", () => {
  it("rejects duplicate candidates", () => {
    expect(() => routeModel({ candidates: [candidate(), candidate()], task: task(), policy: BUILTIN_ROUTING_POLICIES.balanced })).toThrow(
      ModelRouterInputError,
    )
  })

  it("rejects a malformed task profile", () => {
    expect(() =>
      // @ts-expect-error deliberately malformed for the boundary test
      routeModel({ candidates: [candidate()], task: { expectedInputTokens: -1 }, policy: BUILTIN_ROUTING_POLICIES.balanced }),
    ).toThrow(ModelRouterInputError)
  })

  it("rejects a success probability outside 0..1", () => {
    expect(() =>
      routeModel({
        candidates: [candidate({ perAttemptSuccessProbability: 1.2 })],
        task: task(),
        policy: BUILTIN_ROUTING_POLICIES.balanced,
      }),
    ).toThrow(ModelRouterInputError)
  })

  it("explains every candidate exactly once across selection and elimination", () => {
    const candidates = [
      candidate({ providerID: "a", modelID: "1", family: "x", costPerMillionInputTokens: 1 }),
      candidate({ providerID: "b", modelID: "2", family: "y", costPerMillionInputTokens: 5 }),
      candidate({ providerID: "c", modelID: "3", family: "z", contextTotalTokens: 1_000 }),
    ]
    const result = routeModel({ candidates, task: task(), policy: BUILTIN_ROUTING_POLICIES.economy })

    const accounted = [result.selected!.endpointKey, ...result.eliminated.map((item) => item.endpointKey)].sort()
    expect(accounted).toEqual(["a::1", "b::2", "c::3"])
  })
})
