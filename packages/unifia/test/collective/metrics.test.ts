import { describe, expect, test } from "bun:test"
import { Metrics } from "../../src/collective/metrics"
import { Collective } from "../../src/collective/types"

function makeClaim(overrides: Partial<Collective.Claim> = {}): Collective.Claim {
  return {
    claimId: Collective.ClaimID.make(),
    sourceId: "test",
    sourceProvider: "test",
    category: "security",
    content: "test claim",
    confidenceSelf: 0.8,
    noveltyMarker: "consensus",
    isActionable: false,
    supportedBy: ["a"],
    contradictedBy: [],
    ...overrides,
  }
}

describe("Metrics.computeValueMetrics", () => {
  test("counts blind spots correctly", () => {
    const claims = [
      makeClaim({ noveltyMarker: "unique" }),
      makeClaim({ noveltyMarker: "unique" }),
      makeClaim({ noveltyMarker: "consensus" }),
    ]
    const metrics = Metrics.computeValueMetrics(claims, 1.0)
    expect(metrics.blindSpotCount).toBe(2)
  })

  test("computes coverage dimensionality", () => {
    const claims = [
      makeClaim({ category: "security" }),
      makeClaim({ category: "performance" }),
      makeClaim({ category: "architecture" }),
      makeClaim({ category: "security" }),
    ]
    const metrics = Metrics.computeValueMetrics(claims, 1.0)
    expect(metrics.coverageDimensionality).toBe(3)
  })

  test("computes cost per valid insight", () => {
    const claims = [
      makeClaim({ isActionable: true }),
      makeClaim({ isActionable: true }),
      makeClaim({ isActionable: false }),
    ]
    const metrics = Metrics.computeValueMetrics(claims, 2.0)
    expect(metrics.costPerValidInsight).toBe(1.0)
  })

  test("handles no actionable claims", () => {
    const claims = [makeClaim({ isActionable: false })]
    const metrics = Metrics.computeValueMetrics(claims, 1.0)
    expect(metrics.costPerValidInsight).toBeUndefined()
  })
})

describe("Metrics.computeFragility", () => {
  test("returns 0 when no initial disagreements", () => {
    expect(Metrics.computeFragility(0, 0)).toBe(0)
  })

  test("computes ratio correctly", () => {
    expect(Metrics.computeFragility(10, 6)).toBeCloseTo(0.6)
    expect(Metrics.computeFragility(10, 10)).toBe(1)
    expect(Metrics.computeFragility(10, 0)).toBe(0)
  })
})

describe("Metrics.computeDiversityScore", () => {
  test("returns 0 for empty claims", () => {
    expect(Metrics.computeDiversityScore([])).toBe(0)
  })

  test("higher score with more unique claims", () => {
    const allConsensus = [makeClaim({ noveltyMarker: "consensus" }), makeClaim({ noveltyMarker: "consensus" })]
    const mixed = [makeClaim({ noveltyMarker: "unique" }), makeClaim({ noveltyMarker: "consensus" })]
    const allUnique = [makeClaim({ noveltyMarker: "unique" }), makeClaim({ noveltyMarker: "unique" })]

    const scoreConsensus = Metrics.computeDiversityScore(allConsensus)
    const scoreMixed = Metrics.computeDiversityScore(mixed)
    const scoreUnique = Metrics.computeDiversityScore(allUnique)

    expect(scoreConsensus).toBeLessThan(scoreMixed)
    expect(scoreMixed).toBeLessThan(scoreUnique)
  })
})
