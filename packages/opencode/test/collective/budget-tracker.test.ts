import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { BudgetTracker } from "../../src/collective/budget-tracker"
import { Collective } from "../../src/collective/types"

describe("BudgetTracker.tierDefaults", () => {
  test("returns correct defaults per tier", () => {
    const free = BudgetTracker.tierDefaults("free")
    expect(free.maxTotalTokens).toBe(50_000)
    expect(free.maxCostUsd).toBe(0)

    const quick = BudgetTracker.tierDefaults("quick")
    expect(quick.maxTotalTokens).toBe(200_000)

    const standard = BudgetTracker.tierDefaults("standard")
    expect(standard.maxTotalTokens).toBe(500_000)

    const deep = BudgetTracker.tierDefaults("deep")
    expect(deep.maxTotalTokens).toBe(1_500_000)
  })
})

describe("BudgetTracker.estimate", () => {
  test("produces breakdown with correct phases", () => {
    const config: Collective.DebateConfig = {
      question: "Test question",
      tier: "standard",
      redTeam: "auto",
      enableMeta: true,
      enableCanary: false,
      enableShadowBaseline: true,
      noMemory: false,
      maxRounds: 2,
    }

    const participants = [
      { providerID: "anthropic", modelID: "claude-sonnet-4-20250514" },
      { providerID: "openai", modelID: "gpt-4.1" },
      { providerID: "google", modelID: "gemini-2.5-pro" },
    ]

    const estimate = BudgetTracker.estimate(config, participants)

    expect(estimate.estimatedTokens).toBeGreaterThan(0)
    expect(estimate.estimatedCostUsd).toBeGreaterThan(0)

    const phases = estimate.breakdown.map((b) => b.phase)
    expect(phases).toContain("phase1_diverge")
    expect(phases).toContain("phase2_extract")
    expect(phases).toContain("phase4_synthesize")
    expect(phases.some((p) => p.startsWith("phase3_converge"))).toBe(true)
  })

  test("quick tier skips convergence", () => {
    const config: Collective.DebateConfig = {
      question: "Simple question",
      tier: "quick",
      redTeam: "auto",
      enableMeta: true,
      enableCanary: false,
      enableShadowBaseline: true,
      noMemory: false,
      maxRounds: 2,
    }

    const participants = [
      { providerID: "anthropic", modelID: "claude-sonnet-4-20250514" },
      { providerID: "openai", modelID: "gpt-4.1" },
    ]

    const estimate = BudgetTracker.estimate(config, participants)
    const phases = estimate.breakdown.map((b) => b.phase)
    expect(phases.some((p) => p.startsWith("phase3"))).toBe(false)
  })
})

describe('BudgetTracker.unlimited', () => {
  test('does not impose a practical default stop', async () => {
    const tracker = BudgetTracker.create(BudgetTracker.unlimited())
    tracker.record('phase1', 'test', 1_000, 50)
    await Effect.runPromise(tracker.check())
    expect(tracker.checkWarn('dbt_test' as any).warn).toBe(false)
  })
})

describe("BudgetTracker.create", () => {
  test("tracks tokens and cost", () => {
    const tracker = BudgetTracker.create({
      maxTotalTokens: 100_000,
      maxCostUsd: 1.0,
      warnAtPercent: 80,
    })

    tracker.record("phase1", "anthropic", 1000, 500)
    const snap = tracker.snapshot()
    expect(snap.tokensUsed).toBe(1500)
    expect(snap.costUsd).toBeGreaterThan(0)
    expect(snap.byPhase["phase1"]).toBe(1500)
    expect(snap.byProvider["anthropic"]).toBe(1500)
  })

  test("check succeeds within budget", async () => {
    const tracker = BudgetTracker.create({
      maxTotalTokens: 100_000,
      maxCostUsd: 10.0,
      warnAtPercent: 80,
    })

    tracker.record("phase1", "test", 1000, 500)
    await Effect.runPromise(tracker.check())
  })

  test("check fails when budget exceeded", async () => {
    const tracker = BudgetTracker.create({
      maxTotalTokens: 100,
      maxCostUsd: 10.0,
      warnAtPercent: 80,
    })

    tracker.record("phase1", "test", 200, 200)

    try {
      await Effect.runPromise(tracker.check())
      expect(false).toBe(true)
    } catch (e: any) {
      expect(e.data.tokensUsed).toBe(400)
      expect(e.data.tokenLimit).toBe(100)
    }
  })

  test("checkWarn detects warning threshold", () => {
    const tracker = BudgetTracker.create({
      maxTotalTokens: 1000,
      maxCostUsd: 10.0,
      warnAtPercent: 80,
    })

    tracker.record("phase1", "test", 850, 0)
    const result = tracker.checkWarn("dbt_test" as any)
    expect(result.warn).toBe(true)
    expect(result.percent).toBe(85)
  })
})
