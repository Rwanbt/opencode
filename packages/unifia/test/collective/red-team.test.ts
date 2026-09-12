import { describe, expect, test } from "bun:test"
import { RedTeam } from "../../src/collective/red-team"
import { Collective } from "../../src/collective/types"

describe("RedTeam.shouldActivate", () => {
  test("returns false when off", () => {
    expect(RedTeam.shouldActivate("standard", "off", 0.9)).toBe(false)
  })

  test("returns true when always", () => {
    expect(RedTeam.shouldActivate("standard", "always", 0)).toBe(true)
  })

  test("returns false for free tier even with auto", () => {
    expect(RedTeam.shouldActivate("free", "auto", 0.9)).toBe(false)
  })

  test("returns false for quick tier even with auto", () => {
    expect(RedTeam.shouldActivate("quick", "auto", 0.9)).toBe(false)
  })

  test("activates on standard when consensus exceeds threshold", () => {
    expect(RedTeam.shouldActivate("standard", "auto", 0.9)).toBe(true)
  })

  test("does not activate on standard below threshold", () => {
    expect(RedTeam.shouldActivate("standard", "auto", 0.7)).toBe(false)
  })

  test("deep tier has lower threshold", () => {
    expect(RedTeam.shouldActivate("deep", "auto", 0.8)).toBe(true)
  })
})

describe("RedTeam.computeConsensusRatio", () => {
  test("returns 0 for empty claims", () => {
    expect(RedTeam.computeConsensusRatio([])).toBe(0)
  })

  test("computes correct ratio", () => {
    const claims: Collective.Claim[] = [
      makeClaim("consensus"),
      makeClaim("consensus"),
      makeClaim("unique"),
      makeClaim("minority"),
    ]
    expect(RedTeam.computeConsensusRatio(claims)).toBe(0.5)
  })

  test("returns 1 when all consensus", () => {
    const claims = [makeClaim("consensus"), makeClaim("consensus")]
    expect(RedTeam.computeConsensusRatio(claims)).toBe(1)
  })
})

function makeClaim(novelty: Collective.NoveltyMarker): Collective.Claim {
  return {
    claimId: Collective.ClaimID.make(),
    sourceId: "test",
    sourceProvider: "test",
    category: "other",
    content: "test claim",
    confidenceSelf: 0.8,
    noveltyMarker: novelty,
    isActionable: false,
    supportedBy: [],
    contradictedBy: [],
  }
}
