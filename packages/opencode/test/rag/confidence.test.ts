import { describe, it, expect } from "bun:test"
import { confidence, adjustScores } from "../../src/rag/confidence"

describe("confidence scoring", () => {
  it("returns base confidence for brand new embeddings", () => {
    const now = Date.now()
    expect(confidence("file", now, now)).toBeCloseTo(0.8, 1)
    expect(confidence("learning", now, now)).toBeCloseTo(0.9, 1)
    expect(confidence("summary", now, now)).toBeCloseTo(0.7, 1)
  })

  it("decays over time", () => {
    const now = Date.now()
    const thirtyDaysAgo = now - 30 * 24 * 60 * 60 * 1000
    const fresh = confidence("file", now, now)
    const old = confidence("file", thirtyDaysAgo, now)
    expect(old).toBeLessThan(fresh)
    // After one half-life (30 days for file), should be ~half
    expect(old).toBeCloseTo(fresh * 0.5, 1)
  })

  it("unknown source types get default values", () => {
    const now = Date.now()
    const score = confidence("unknown", now, now)
    expect(score).toBeCloseTo(0.5, 1)
  })

  it("adjustScores re-ranks by confidence", () => {
    const now = Date.now()
    const results = [
      { id: "old", score: 0.95, sourceType: "file", createdAt: now - 90 * 24 * 60 * 60 * 1000 },
      { id: "new", score: 0.90, sourceType: "file", createdAt: now },
    ]
    const adjusted = adjustScores(results, 0.5)
    // The newer result should rank higher despite lower raw score
    expect(adjusted[0].id).toBe("new")
  })
})
