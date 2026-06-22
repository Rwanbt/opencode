import { describe, expect, test } from "bun:test"
import { TierClassifier } from "../../src/collective/tier-classifier"

describe("TierClassifier.classifyHeuristic", () => {
  test("simple question gets quick tier", () => {
    const result = TierClassifier.classifyHeuristic("How do I rename a variable?")
    expect(["free", "quick"]).toContain(result.tier)
    expect(result.score).toBeLessThan(12)
  })

  test("security question gets boosted stakes", () => {
    const result = TierClassifier.classifyHeuristic(
      "How should we handle authentication and authorization for our API endpoints?",
    )
    expect(result.classification.stakes).toBeGreaterThanOrEqual(6)
    expect(["standard", "deep"]).toContain(result.tier)
  })

  test("architecture question gets boosted controversy", () => {
    const result = TierClassifier.classifyHeuristic(
      "Should we use microservices vs monolith architecture for this system?",
    )
    expect(result.classification.controversyPotential).toBeGreaterThanOrEqual(5)
  })

  test("concurrency question gets boosted complexity", () => {
    const result = TierClassifier.classifyHeuristic(
      "How to handle concurrent writes with lock-free data structures to avoid deadlocks?",
    )
    expect(result.classification.complexity).toBeGreaterThanOrEqual(6)
  })

  test("payment+security question gets deep tier", () => {
    const result = TierClassifier.classifyHeuristic(
      "Review the security of our payment processing pipeline for encryption vulnerabilities and concurrent transaction handling",
    )
    expect(["standard", "deep"]).toContain(result.tier)
    expect(result.score).toBeGreaterThanOrEqual(15)
  })

  test("long question gets complexity boost", () => {
    const longQuestion = "Question about " + "something ".repeat(100)
    const result = TierClassifier.classifyHeuristic(longQuestion)
    expect(result.classification.complexity).toBeGreaterThanOrEqual(4)
  })

  test("returns valid tier for any input", () => {
    const tiers = ["free", "quick", "standard", "deep"]
    const inputs = ["", "a", "How?", "x".repeat(1000)]
    for (const input of inputs) {
      const result = TierClassifier.classifyHeuristic(input)
      expect(tiers).toContain(result.tier)
      expect(result.score).toBeGreaterThanOrEqual(0)
    }
  })
})
