import { describe, expect, test } from "bun:test"
import { createGenerationTracker } from "./generation"

// FORK (PLAN-READONLY-VIEWER-REACTIVITY C1/Phase 2): guards the monotone
// generation counter that lets context/file.tsx's seed() drop a slower,
// superseded load() response instead of overwriting fresher content.

describe("createGenerationTracker", () => {
  test("a never-bumped key has no current generation", () => {
    const gen = createGenerationTracker()
    expect(gen.current("a.ts")).toBeUndefined()
    expect(gen.isCurrent("a.ts", 1)).toBe(false)
  })

  test("bump returns an increasing sequence per key, starting at 1", () => {
    const gen = createGenerationTracker()
    expect(gen.bump("a.ts")).toBe(1)
    expect(gen.bump("a.ts")).toBe(2)
    expect(gen.bump("a.ts")).toBe(3)
  })

  test("isCurrent is true only for the latest bump", () => {
    const gen = createGenerationTracker()
    const g1 = gen.bump("a.ts")
    expect(gen.isCurrent("a.ts", g1)).toBe(true)
    const g2 = gen.bump("a.ts")
    // The seed/load that captured g1 is now stale.
    expect(gen.isCurrent("a.ts", g1)).toBe(false)
    expect(gen.isCurrent("a.ts", g2)).toBe(true)
  })

  test("keys are independent — bumping one does not affect another", () => {
    const gen = createGenerationTracker()
    const a1 = gen.bump("a.ts")
    const b1 = gen.bump("b.ts")
    gen.bump("a.ts")
    expect(gen.isCurrent("a.ts", a1)).toBe(false)
    expect(gen.isCurrent("b.ts", b1)).toBe(true)
  })

  test("clear() resets every key", () => {
    const gen = createGenerationTracker()
    const g1 = gen.bump("a.ts")
    gen.bump("b.ts")
    gen.clear()
    expect(gen.current("a.ts")).toBeUndefined()
    expect(gen.current("b.ts")).toBeUndefined()
    expect(gen.isCurrent("a.ts", g1)).toBe(false)
  })

  test("simulates a slow superseded response: seed then a stale in-flight load must lose", () => {
    // This is the exact race PLAN-READONLY-VIEWER-REACTIVITY C1 fixes:
    // 1. A load() starts (captures gen A).
    // 2. Before it resolves, a seed() (a save) bumps the generation.
    // 3. The load()'s late response must be recognized as stale.
    const gen = createGenerationTracker()
    const loadGen = gen.bump("a.ts") // load() in flight
    const seedGen = gen.bump("a.ts") // seed() from a save completes first
    expect(gen.isCurrent("a.ts", loadGen)).toBe(false) // the late load response is dropped
    expect(gen.isCurrent("a.ts", seedGen)).toBe(true) // the seed's content stands
  })
})
