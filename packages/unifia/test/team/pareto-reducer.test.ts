import { describe, expect, it } from "bun:test"
import {
  dominates,
  isRetained,
  ParetoReducerInputError,
  reduceToParetoFront,
  type ParetoEndpoint,
} from "../../src/team/pareto-reducer"

function endpoint(overrides: Partial<ParetoEndpoint> = {}): ParetoEndpoint {
  return {
    providerID: "anthropic",
    modelID: "claude-sonnet",
    releaseKey: "claude-sonnet-4.5",
    costPerMillionInputTokens: 3,
    costPerMillionOutputTokens: 15,
    latencyP95Ms: 1_200,
    contextTotalTokens: 200_000,
    availabilityScore: 0.99,
    regions: ["US", "EU"],
    ...overrides,
  }
}

function outcomeOf(result: ReturnType<typeof reduceToParetoFront>, modelID: string) {
  return result.decisions.find((item) => item.modelID === modelID)!
}

describe("dominates", () => {
  it("is true when strictly better on one dimension and equal elsewhere", () => {
    expect(dominates(endpoint({ costPerMillionInputTokens: 1 }), endpoint())).toBe(true)
  })

  it("is false for an identical endpoint (no strict improvement)", () => {
    expect(dominates(endpoint(), endpoint())).toBe(false)
  })

  it("is false when the trade-off is mixed — cheaper but slower", () => {
    const cheapSlow = endpoint({ costPerMillionInputTokens: 1, latencyP95Ms: 5_000 })
    const dearFast = endpoint({ costPerMillionInputTokens: 10, latencyP95Ms: 100 })

    expect(dominates(cheapSlow, dearFast)).toBe(false)
    expect(dominates(dearFast, cheapSlow)).toBe(false)
  })

  it("treats an unmeasured latency as unknown, never as fast or slow", () => {
    const unknown = endpoint({ latencyP95Ms: null })
    const measured = endpoint({ latencyP95Ms: 10_000, costPerMillionInputTokens: 99 })

    // `measured` is worse on cost and slow, yet cannot be dominated because
    // the other endpoint's latency was never observed.
    expect(dominates(unknown, measured)).toBe(false)
    expect(dominates(measured, unknown)).toBe(false)
  })

  it("respects direction: larger context and higher availability are better", () => {
    expect(dominates(endpoint({ contextTotalTokens: 400_000 }), endpoint())).toBe(true)
    expect(dominates(endpoint({ availabilityScore: 1 }), endpoint())).toBe(true)
    expect(dominates(endpoint({ contextTotalTokens: 1_000 }), endpoint())).toBe(false)
  })
})

describe("reduceToParetoFront — core guarantee: no non-dominated endpoint is eliminated", () => {
  it("keeps every endpoint of an all-incomparable set", () => {
    const result = reduceToParetoFront([
      endpoint({ modelID: "cheap-slow", costPerMillionInputTokens: 1, latencyP95Ms: 5_000 }),
      endpoint({ modelID: "dear-fast", costPerMillionInputTokens: 10, latencyP95Ms: 100 }),
      endpoint({ modelID: "mid", costPerMillionInputTokens: 5, latencyP95Ms: 1_000 }),
    ])

    expect(result.eliminated).toHaveLength(0)
    expect(result.retained).toHaveLength(3)
    expect(result.decisions.every((item) => item.outcome === "RETAINED_PARETO_OPTIMAL")).toBe(true)
  })

  it("verifies exhaustively that nothing eliminated was actually non-dominated", () => {
    const endpoints = [
      endpoint({ modelID: "a", costPerMillionInputTokens: 1, latencyP95Ms: 100, availabilityScore: 1 }),
      endpoint({ modelID: "b", costPerMillionInputTokens: 5, latencyP95Ms: 900 }),
      endpoint({ modelID: "c", costPerMillionInputTokens: 9, latencyP95Ms: 2_000, availabilityScore: 0.5 }),
      endpoint({ modelID: "d", costPerMillionInputTokens: 2, latencyP95Ms: 4_000, contextTotalTokens: 900_000 }),
      endpoint({ modelID: "e", costPerMillionInputTokens: 1, latencyP95Ms: 100, availabilityScore: 0.2 }),
    ]
    const result = reduceToParetoFront(endpoints)

    // The card's acceptance criterion, checked directly rather than assumed:
    // every eliminated endpoint must have a real dominator in the input.
    for (const cut of result.eliminated) {
      const hasDominator = endpoints.some((other) => dominates(other, cut))
      expect(hasDominator).toBe(true)
    }
    // ...and every retained endpoint must be either non-dominated or kept
    // for an explicit, stated reason.
    for (const kept of result.retained) {
      const decision = result.decisions.find((item) => item.endpointKey === `${kept.providerID}::${kept.modelID}`)!
      const dominated = endpoints.some((other) => dominates(other, kept))
      if (dominated) expect(decision.outcome).toBe("RETAINED_REGION_COVERAGE")
      else expect(isRetained(decision.outcome)).toBe(true)
    }
  })

  it("eliminates a strictly worse endpoint and names its dominator", () => {
    const result = reduceToParetoFront([
      endpoint({ modelID: "good", costPerMillionInputTokens: 1 }),
      endpoint({ modelID: "worse", costPerMillionInputTokens: 9 }),
    ])

    expect(result.retained.map((item) => item.modelID)).toEqual(["good"])
    const cut = outcomeOf(result, "worse")
    expect(cut.outcome).toBe("ELIMINATED_DOMINATED")
    expect(cut.supersededBy).toBe("anthropic::good")
  })
})

describe("reduceToParetoFront — release scoping (never compare different products)", () => {
  it("never eliminates across different model releases", () => {
    const result = reduceToParetoFront([
      endpoint({ modelID: "big", releaseKey: "opus-4", costPerMillionInputTokens: 15 }),
      endpoint({ modelID: "small", releaseKey: "haiku-4", costPerMillionInputTokens: 1 }),
    ])

    // "small" is better on every dimension, but they are different products:
    // eliminating "big" here would be a ranking decision, not a dedup.
    expect(result.eliminated).toHaveLength(0)
    expect(result.stats.releaseGroupCount).toBe(2)
    expect(result.decisions.every((item) => item.outcome === "RETAINED_SOLE_OFFER")).toBe(true)
  })

  it("dedups the same release served by several providers, keeping the non-dominated ones", () => {
    const result = reduceToParetoFront([
      endpoint({ providerID: "bedrock", modelID: "sonnet", costPerMillionInputTokens: 9, latencyP95Ms: 3_000 }),
      endpoint({ providerID: "anthropic", modelID: "sonnet", costPerMillionInputTokens: 3, latencyP95Ms: 1_200 }),
      endpoint({ providerID: "vertex", modelID: "sonnet", costPerMillionInputTokens: 4, latencyP95Ms: 800 }),
    ])

    expect(result.stats.releaseGroupCount).toBe(1)
    // anthropic (cheapest) and vertex (fastest) are incomparable — both stay.
    // bedrock is worse than both on both dimensions — it goes.
    expect(result.retained.map((item) => item.providerID).sort()).toEqual(["anthropic", "vertex"])
    expect(outcomeOf(result, "sonnet").outcome).toBe("ELIMINATED_DOMINATED")
  })
})

describe("reduceToParetoFront — region coverage is never lost", () => {
  it("keeps a dominated endpoint when it is the only one serving a region", () => {
    const result = reduceToParetoFront([
      endpoint({ providerID: "anthropic", modelID: "fast", costPerMillionInputTokens: 1, regions: ["US"] }),
      // Strictly worse on cost, but the only endpoint serving JP.
      endpoint({ providerID: "local-jp", modelID: "slow", costPerMillionInputTokens: 9, regions: ["JP"] }),
    ])

    expect(result.retained).toHaveLength(2)
    const restored = result.decisions.find((item) => item.providerID === "local-jp")!
    expect(restored.outcome).toBe("RETAINED_REGION_COVERAGE")
    expect(restored.reason).toContain("JP")
  })

  it("guarantees the retained set covers exactly the regions the input covered", () => {
    const result = reduceToParetoFront([
      endpoint({ providerID: "p1", modelID: "a", costPerMillionInputTokens: 1, regions: ["US", "EU"] }),
      endpoint({ providerID: "p2", modelID: "b", costPerMillionInputTokens: 8, regions: ["JP"] }),
      endpoint({ providerID: "p3", modelID: "c", costPerMillionInputTokens: 9, regions: ["BR"] }),
      endpoint({ providerID: "p4", modelID: "d", costPerMillionInputTokens: 7, regions: ["US"] }),
    ])

    const retainedRegions = [...new Set(result.retained.flatMap((item) => item.regions))].sort()
    expect(retainedRegions).toEqual([...result.stats.coveredRegions])
    expect(retainedRegions).toEqual(["BR", "EU", "JP", "US"])
  })

  it("does not restore an endpoint whose regions are already covered by the front", () => {
    const result = reduceToParetoFront([
      endpoint({ providerID: "p1", modelID: "a", costPerMillionInputTokens: 1, regions: ["US", "EU"] }),
      endpoint({ providerID: "p2", modelID: "b", costPerMillionInputTokens: 9, regions: ["US"] }),
    ])

    expect(result.retained.map((item) => item.modelID)).toEqual(["a"])
    expect(outcomeOf(result, "b").outcome).toBe("ELIMINATED_DOMINATED")
  })

  it("restores one endpoint covering several missing regions rather than one per region", () => {
    const result = reduceToParetoFront([
      endpoint({ providerID: "p1", modelID: "a", costPerMillionInputTokens: 1, regions: ["US"] }),
      endpoint({ providerID: "p2", modelID: "multi", costPerMillionInputTokens: 8, regions: ["JP", "BR"] }),
      endpoint({ providerID: "p3", modelID: "jp-only", costPerMillionInputTokens: 9, regions: ["JP"] }),
    ])

    expect(result.retained.map((item) => item.modelID).sort()).toEqual(["a", "multi"])
    expect(outcomeOf(result, "jp-only").outcome).toBe("ELIMINATED_DOMINATED")
  })
})

describe("reduceToParetoFront — exact-tie dedup", () => {
  it("collapses endpoints identical on all dimensions and regions, keeping the smallest key", () => {
    const result = reduceToParetoFront([
      endpoint({ providerID: "zeta", modelID: "twin" }),
      endpoint({ providerID: "alpha", modelID: "twin" }),
    ])

    expect(result.retained.map((item) => item.providerID)).toEqual(["alpha"])
    const cut = result.decisions.find((item) => item.providerID === "zeta")!
    expect(cut.outcome).toBe("ELIMINATED_DUPLICATE")
    expect(cut.supersededBy).toBe("alpha::twin")
  })

  it("points every one of three twins at the endpoint that actually survived", () => {
    const result = reduceToParetoFront([
      endpoint({ providerID: "zeta", modelID: "t" }),
      endpoint({ providerID: "mid", modelID: "t" }),
      endpoint({ providerID: "alpha", modelID: "t" }),
    ])

    expect(result.retained.map((item) => item.providerID)).toEqual(["alpha"])
    // Resolving twins pairwise would make "zeta" cite "mid", which is itself
    // eliminated — a supersededBy pointing at a row absent from the result.
    const superseders = result.decisions
      .filter((item) => item.outcome === "ELIMINATED_DUPLICATE")
      .map((item) => item.supersededBy)
    expect(superseders).toEqual(["alpha::t", "alpha::t"])

    const retainedKeys = new Set(result.retained.map((item) => `${item.providerID}::${item.modelID}`))
    for (const key of superseders) expect(retainedKeys.has(key!)).toBe(true)
  })

  it("re-attributes a duplicate to the real dominator when its survivor is itself eliminated", () => {
    const result = reduceToParetoFront([
      endpoint({ providerID: "zeta", modelID: "t" }),
      endpoint({ providerID: "alpha", modelID: "t" }),
      endpoint({ providerID: "best", modelID: "t", costPerMillionInputTokens: 1 }),
    ])

    expect(result.retained.map((item) => item.providerID)).toEqual(["best"])
    // zeta is identical to alpha, and best dominates alpha — so best
    // dominates zeta too. Reporting zeta as a duplicate of the eliminated
    // alpha would leave the caller with nothing usable to follow.
    const zeta = result.decisions.find((item) => item.providerID === "zeta")!
    expect(zeta.outcome).toBe("ELIMINATED_DOMINATED")
    expect(zeta.supersededBy).toBe("best::t")
    expect(zeta.reason).toContain("transitively")
  })

  it("does NOT collapse metric-identical endpoints that cover different regions", () => {
    const result = reduceToParetoFront([
      endpoint({ providerID: "eu-host", modelID: "twin", regions: ["EU"] }),
      endpoint({ providerID: "jp-host", modelID: "twin", regions: ["JP"] }),
    ])

    expect(result.retained).toHaveLength(2)
    expect(result.eliminated).toHaveLength(0)
  })
})

describe("reduceToParetoFront — determinism and reporting", () => {
  const sample: ParetoEndpoint[] = [
    endpoint({ providerID: "p1", modelID: "a", costPerMillionInputTokens: 1, regions: ["US"] }),
    endpoint({ providerID: "p2", modelID: "b", costPerMillionInputTokens: 5, regions: ["EU"] }),
    endpoint({ providerID: "p3", modelID: "c", costPerMillionInputTokens: 9, regions: ["US"] }),
    endpoint({ providerID: "p4", modelID: "d", releaseKey: "other", costPerMillionInputTokens: 2 }),
  ]

  it("produces identical output across repeated runs", () => {
    expect(reduceToParetoFront(sample)).toEqual(reduceToParetoFront(sample))
  })

  it("emits exactly one decision per input endpoint, retentions included", () => {
    const result = reduceToParetoFront(sample)

    expect(result.decisions).toHaveLength(sample.length)
    expect(result.stats.retainedCount + result.stats.eliminatedCount).toBe(result.stats.totalEndpoints)
    expect(result.decisions.every((item) => item.reason.length > 0)).toBe(true)
  })

  it("never cites a superseder that is itself absent from the retained set", () => {
    const result = reduceToParetoFront([
      ...sample,
      endpoint({ providerID: "dup1", modelID: "z" }),
      endpoint({ providerID: "dup2", modelID: "z" }),
      endpoint({ providerID: "dup3", modelID: "z" }),
      endpoint({ providerID: "loser", modelID: "z", costPerMillionInputTokens: 99 }),
    ])

    const retainedKeys = new Set(result.retained.map((item) => `${item.providerID}::${item.modelID}`))
    for (const item of result.decisions) {
      if (item.supersededBy === null) continue
      expect(retainedKeys.has(item.supersededBy)).toBe(true)
    }
  })

  it("preserves input order in retained, eliminated and decisions", () => {
    const result = reduceToParetoFront(sample)

    expect(result.decisions.map((item) => item.modelID)).toEqual(["a", "b", "c", "d"])

    // retained and eliminated must each be an order-preserving subsequence
    // of the input, so the report diffs cleanly against the input listing.
    const inputOrder = sample.map((item) => item.modelID)
    const isSubsequence = (subset: readonly string[]) => {
      let cursor = 0
      for (const id of subset) {
        cursor = inputOrder.indexOf(id, cursor)
        if (cursor === -1) return false
        cursor++
      }
      return true
    }
    expect(isSubsequence(result.retained.map((item) => item.modelID))).toBe(true)
    expect(isSubsequence(result.eliminated.map((item) => item.modelID))).toBe(true)
  })

  it("attributes a stable dominator when several endpoints dominate the same one", () => {
    const endpoints = [
      endpoint({ providerID: "zeta", modelID: "x", costPerMillionInputTokens: 1 }),
      endpoint({ providerID: "alpha", modelID: "x", costPerMillionInputTokens: 1 }),
      endpoint({ providerID: "loser", modelID: "x", costPerMillionInputTokens: 9 }),
    ]
    const first = reduceToParetoFront(endpoints)
    const second = reduceToParetoFront([...endpoints].reverse())

    const dominatorOf = (r: ReturnType<typeof reduceToParetoFront>) =>
      r.decisions.find((item) => item.providerID === "loser")!.supersededBy
    // Smallest dominator key, not "whichever was scanned first".
    expect(dominatorOf(first)).toBe("alpha::x")
    expect(dominatorOf(second)).toBe("alpha::x")
  })
})

describe("reduceToParetoFront — boundaries", () => {
  it("handles an empty input", () => {
    const result = reduceToParetoFront([])

    expect(result.stats).toMatchObject({ totalEndpoints: 0, retainedCount: 0, eliminatedCount: 0 })
    expect(result.decisions).toHaveLength(0)
  })

  it("rejects a duplicate provider/model endpoint", () => {
    expect(() => reduceToParetoFront([endpoint(), endpoint()])).toThrow(ParetoReducerInputError)
  })

  it("rejects a lowercase region code", () => {
    expect(() => reduceToParetoFront([endpoint({ regions: ["eu"] })])).toThrow(ParetoReducerInputError)
  })

  it("rejects an availability score outside 0..1", () => {
    expect(() => reduceToParetoFront([endpoint({ availabilityScore: 1.5 })])).toThrow(ParetoReducerInputError)
  })

  it("freezes retained endpoints so a caller cannot corrupt the result", () => {
    const result = reduceToParetoFront([endpoint()])

    expect(Object.isFrozen(result.retained[0])).toBe(true)
  })

  it("rejects NaN and Infinity, which would silently corrupt every comparison", () => {
    expect(() => reduceToParetoFront([endpoint({ costPerMillionInputTokens: Number.NaN })])).toThrow(
      ParetoReducerInputError,
    )
    expect(() => reduceToParetoFront([endpoint({ costPerMillionInputTokens: Number.POSITIVE_INFINITY })])).toThrow(
      ParetoReducerInputError,
    )
    expect(() => reduceToParetoFront([endpoint({ latencyP95Ms: Number.NaN })])).toThrow(ParetoReducerInputError)
  })

  it("retains a lone endpoint as the sole offer without comparing it to anything", () => {
    const result = reduceToParetoFront([endpoint({ providerID: "lone", regions: [] })])

    expect(result.decisions[0]!.outcome).toBe("RETAINED_SOLE_OFFER")
    expect(result.stats.coveredRegions).toEqual([])
  })

  it("still reduces correctly when no endpoint declares a region", () => {
    const result = reduceToParetoFront([
      endpoint({ providerID: "a", costPerMillionInputTokens: 1, regions: [] }),
      endpoint({ providerID: "b", costPerMillionInputTokens: 9, regions: [] }),
    ])

    expect(result.retained.map((item) => item.providerID)).toEqual(["a"])
    expect(result.stats.coveredRegions).toEqual([])
  })

  it("handles a large single-release group and explains every endpoint", () => {
    const many = Array.from({ length: 500 }, (_, i) =>
      endpoint({
        providerID: `p${i}`,
        modelID: `m${i}`,
        costPerMillionInputTokens: i % 50,
        latencyP95Ms: (i % 37) * 10,
        availabilityScore: (i % 5) / 4,
        contextTotalTokens: 10_000 * (1 + (i % 9)),
        regions: [["US", "EU", "JP", "BR"][i % 4]!],
      }),
    )
    const result = reduceToParetoFront(many)

    expect(result.decisions).toHaveLength(500)
    expect(result.stats.retainedCount + result.stats.eliminatedCount).toBe(500)
    expect([...new Set(result.retained.flatMap((item) => item.regions))].sort()).toEqual(["BR", "EU", "JP", "US"])
  })
})
