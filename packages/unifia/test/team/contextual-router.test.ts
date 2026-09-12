import { describe, expect, it } from "bun:test"
import {
  DEFAULT_CONTEXTUAL_ROUTER_CONFIG,
  routeContextually,
  type ContextFeatureVector,
  type ContextualRouteInput,
} from "../../src/team/contextual-router"

function context(overrides: Partial<ContextFeatureVector> = {}): ContextFeatureVector {
  return {
    domain: "typescript",
    taskKind: "implementation",
    riskLevel: "TRIVIAL",
    expectedInputTokens: 1000,
    expectedOutputTokens: 500,
    baselineConfidence: 0.95,
    learnedConfidence: 0.92,
    driftScore: 0.05,
    ...overrides,
  }
}

function input(overrides: Partial<ContextualRouteInput> = {}): ContextualRouteInput {
  return {
    context: context(),
    baselineEndpointKey: "rules::balanced",
    learnedCandidate: { endpointKey: "learned::fast", learnedScore: 0.9 },
    explorationEndpointKey: "explore::candidate",
    explorationRequested: false,
    offlineEvaluation: { baselineReward: 0.8, learnedReward: 0.81, sampleCount: 30 },
    config: DEFAULT_CONTEXTUAL_ROUTER_CONFIG,
    ...overrides,
  }
}

describe("routeContextually — bounded learned routing", () => {
  it("uses the learned candidate after all safety gates pass", () => {
    const decision = routeContextually(input())
    expect(decision.mode).toBe("learned")
    expect(decision.endpointKey).toBe("learned::fast")
  })

  it("falls back when confidence is insufficient", () => {
    const decision = routeContextually(input({ context: context({ learnedConfidence: 0.79 }) }))
    expect(decision.mode).toBe("rules_fallback")
    expect(decision.reason).toContain("confidence")
  })

  it("falls back when offline evidence is insufficient", () => {
    const decision = routeContextually(input({ offlineEvaluation: { baselineReward: 0.8, learnedReward: 0.9, sampleCount: 19 } }))
    expect(decision.mode).toBe("rules_fallback")
    expect(decision.reason).toContain("insufficient")
  })

  it("rejects a learned regression beyond the configured threshold", () => {
    const decision = routeContextually(input({ offlineEvaluation: { baselineReward: 0.9, learnedReward: 0.87, sampleCount: 30 } }))
    expect(decision.mode).toBe("rules_fallback")
    expect(decision.reason).toContain("regression")
  })

  it("honors the kill switch even when learned routing is otherwise eligible", () => {
    const decision = routeContextually(input({ config: { ...DEFAULT_CONTEXTUAL_ROUTER_CONFIG, killSwitch: true } }))
    expect(decision.mode).toBe("rules_fallback")
    expect(decision.reason).toContain("kill switch")
  })

  it("allows exploration only for trivial-risk contexts", () => {
    const decision = routeContextually(input({ explorationRequested: true }))
    expect(decision.mode).toBe("exploration")
    expect(decision.endpointKey).toBe("explore::candidate")
    expect(decision.explorationAllowed).toBe(true)
  })

  it("never explores critical contexts", () => {
    const decision = routeContextually(
      input({ context: context({ riskLevel: "CRITICAL" }), explorationRequested: true }),
    )
    expect(decision.mode).toBe("learned")
    expect(decision.explorationAllowed).toBe(false)
  })

  it("falls back when context drift exceeds the monitor threshold", () => {
    const decision = routeContextually(input({ context: context({ driftScore: 0.21 }) }))
    expect(decision.mode).toBe("rules_fallback")
    expect(decision.driftDetected).toBe(true)
  })

  it("falls back when no learned candidate is available", () => {
    const decision = routeContextually(input({ learnedCandidate: null }))
    expect(decision.mode).toBe("rules_fallback")
    expect(decision.endpointKey).toBe("rules::balanced")
  })

  it("rejects malformed boundary input", () => {
    expect(() => routeContextually(input({ baselineEndpointKey: "" }))).toThrow("baselineEndpointKey")
  })
})
