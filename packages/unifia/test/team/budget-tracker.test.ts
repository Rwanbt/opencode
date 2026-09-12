import { describe, expect, test } from "bun:test"
import { BudgetCancelledError, BudgetExceededError, BudgetTracker, BUDGET_THRESHOLDS } from "../../src/team/budget-tracker"

const config = (parentSignal?: AbortSignal) => ({
  phase: { maxTokens: 100, maxCostUsd: 1 },
  task: { maxTokens: 80, maxCostUsd: 0.8 },
  provider: { anthropic: { maxTokens: 60, maxCostUsd: 0.6 } },
  pricing: { version: "price-2026-07-27", capturedAtUTC: "2026-07-27T12:00:00.000Z", providerID: "anthropic", modelID: "claude", inputUsdPerMillionTokens: 1, outputUsdPerMillionTokens: 2 },
  parentSignal,
})

const run = (tracker: BudgetTracker, inputTokens: number, outputTokens = 0) => tracker.run({ phaseID: "phase-1", taskID: "task-1", providerID: "anthropic", expected: { inputTokens, outputTokens }, execute: async () => ({ value: "ok", usage: { inputTokens, outputTokens } }) })

describe("BudgetTracker", () => {
  test("uses versioned historical pricing and records expected versus actual", async () => {
    const tracker = new BudgetTracker(config())
    const result = await run(tracker, 20, 10)
    expect(result.value).toBe("ok")
    expect(result.actual).toEqual({ inputTokens: 20, outputTokens: 10, totalTokens: 30, costUsd: 0.00004 })
    expect(tracker.pricingSnapshotHash).toMatch(/^[a-f0-9]{64}$/)
    expect(tracker.snapshot("provider", "anthropic").totalTokens).toBe(30)
  })

  test("emits each hard-limit threshold once for each dimension", async () => {
    const tracker = new BudgetTracker({ ...config(), phase: { maxTokens: 100, maxCostUsd: 100 }, task: { maxTokens: 100, maxCostUsd: 100 }, provider: { anthropic: { maxTokens: 100, maxCostUsd: 100 } } })
    const events: number[] = []
    tracker.onEvent((event) => { if (event.dimension === "task") events.push(event.threshold) })
    await run(tracker, 50)
    await run(tracker, 30)
    await run(tracker, 15)
    await expect(run(tracker, 5)).resolves.toBeDefined()
    expect(events).toEqual([...BUDGET_THRESHOLDS])
  })

  test("hard-stops before the provider callback and exposes no orphan call", async () => {
    const tracker = new BudgetTracker(config())
    let calls = 0
    await expect(tracker.run({ phaseID: "phase-1", taskID: "task-1", providerID: "anthropic", expected: { inputTokens: 61, outputTokens: 0 }, execute: async () => { calls++; return { value: true, usage: { inputTokens: 61, outputTokens: 0 } } } })).rejects.toBeInstanceOf(BudgetExceededError)
    expect(calls).toBe(0)
  })

  test("rejects actual provider usage transactionally", async () => {
    const tracker = new BudgetTracker(config())
    await expect(tracker.run({ phaseID: "phase-1", taskID: "task-1", providerID: "anthropic", expected: { inputTokens: 1, outputTokens: 1 }, execute: async () => ({ value: true, usage: { inputTokens: 61, outputTokens: 0 } }) })).rejects.toBeInstanceOf(BudgetExceededError)
    expect(tracker.snapshot("phase", "phase-1").totalTokens).toBe(0)
    expect(tracker.snapshot("task", "task-1").totalTokens).toBe(0)
    expect(tracker.snapshot("provider", "anthropic").totalTokens).toBe(0)
  })
  test("propagates cancellation to an in-flight operation and rejects later work", async () => {
    const tracker = new BudgetTracker(config())
    let seenSignal: AbortSignal | undefined
    const pending = tracker.run({ phaseID: "phase-1", taskID: "task-1", providerID: "anthropic", expected: { inputTokens: 1, outputTokens: 1 }, execute: async ({ signal }) => { seenSignal = signal; await new Promise((resolve) => setTimeout(resolve, 20)); return { value: true, usage: { inputTokens: 1, outputTokens: 1 } } } })
    tracker.cancel("operator cancelled")
    await expect(pending).rejects.toBeInstanceOf(BudgetCancelledError)
    expect(seenSignal?.aborted).toBe(true)
    await expect(run(tracker, 1)).rejects.toBeInstanceOf(BudgetCancelledError)
  })

  test("rejects non-historical or incomplete pricing snapshots", () => {
    expect(() => new BudgetTracker(config())).not.toThrow()
    expect(() => new BudgetTracker({ ...config(), pricing: { ...config().pricing, capturedAtUTC: "2026-07-27T12:00:00.000+02:00" } })).toThrow("UTC")
  })
})
