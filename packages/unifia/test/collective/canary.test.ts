import { describe, expect, test } from "bun:test"
import { Canary } from "../../src/collective/canary"
import type { Collective } from "../../src/collective/types"

describe("Canary.injectIntoContext", () => {
  test("appends canary to context", () => {
    const canary: Canary.CanaryBug = {
      bug: "SQLite WAL mode guarantees no write locks during reads",
      category: "correctness",
      detectionHint: "WAL still needs locks for checkpointing",
      injected: true,
    }

    const result = Canary.injectIntoContext("Existing context", canary)
    expect(result).toContain("Existing context")
    expect(result).toContain("SQLite WAL mode")
    expect(result).toContain("previous analysis")
  })

  test("handles undefined context", () => {
    const canary: Canary.CanaryBug = {
      bug: "Test bug",
      category: "security",
      detectionHint: "hint",
      injected: true,
    }

    const result = Canary.injectIntoContext(undefined, canary)
    expect(result).toContain("Test bug")
  })
})

describe("Canary.checkDetection", () => {
  const canary: Canary.CanaryBug = {
    bug: "Express default CORS allows credentials from any origin",
    category: "security",
    detectionHint: "default is same-origin",
    injected: true,
  }

  function makeResponse(
    hash: string,
    content: string,
  ): Collective.PhaseOneResponse {
    return {
      participantHash: hash,
      providerID: "test" as any,
      modelID: "test" as any,
      content,
      outOfRoleInsights: [],
      tokenUsage: { input: 0, output: 0 },
      durationMs: 0,
    }
  }

  test("detects when model identifies canary as incorrect", () => {
    const responses = [
      makeResponse("model_a", "The claim about Express default CORS allowing credentials is incorrect. The default CORS policy is same-origin."),
      makeResponse("model_b", "I agree with the analysis about CORS security."),
    ]

    const result = Canary.checkDetection(responses, canary)
    expect(result.detected).toBe(true)
    expect(result.detectedBy).toContain("model_a")
    expect(result.missedBy).toContain("model_b")
  })

  test("reports not detected when no model catches it", () => {
    const responses = [
      makeResponse("model_a", "The CORS setup looks standard."),
      makeResponse("model_b", "No security concerns found."),
    ]

    const result = Canary.checkDetection(responses, canary)
    expect(result.detected).toBe(false)
    expect(result.missedBy.length).toBe(2)
  })
})
