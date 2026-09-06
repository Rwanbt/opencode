/* SPDX-License-Identifier: MIT */
/* Copyright (c) 2026 Unifia contributors */

/**
 * M2-04 — `control.merge` family configuration schema + parser (Plan V2.3.1 §198).
 *
 * ADR-002 (Workflow IR) + ADR-008 (scheduler/worker authority). The
 * `control.merge` node family and the `ControlMergeConfigSchema`,
 * `MergeStrategySchema`, and `parseControlMergeConfig` helper were
 * added to the IR by the M2-02/03/04 commit (HEAD = d24aa71e69). M2-04
 * is *not* a new family — the family was already wired into
 * `NodeFamilySchema` by that commit. M2-04 is the test net that locks
 * the contract: the strategy field (all / any / n-of-m), the cross-field
 * constraint on `n` for the n-of-m strategy, the branches array
 * (≥1, ≤CONTROL_MERGE_MAX_BRANCHES), the optional `timeoutMs`, and the
 * parse helper.
 *
 * Note on edge kinds: the M2-04 commit did *not* add a `merge-in-N`
 * `EdgeKind` value. The merge node identifies its fan-in branches
 * through its own `config.branches` (a flat array of node ids), not
 * through a typed edge. The same pattern is used by `control.if` (the
 * dual-channel `trueBranch` / `falseBranch` config + the
 * `branch-true` / `branch-false` edges). This test pins that decision
 * so a future refactor that silently re-introduces `merge-in-N` is
 * caught.
 *
 * Locked invariants (regression net):
 *   (1) `ControlMergeConfigSchema` accepts the three strategies with
 *       their cross-field constraints satisfied.
 *   (2) `n-of-m` requires `n` in [1, branches.length]; `all` / `any`
 *       must NOT specify `n`; the cross-field rule is a single
 *       `.refine(...)` that surfaces as one ZodError.
 *   (3) `branches` is bounded [1, CONTROL_MERGE_MAX_BRANCHES] and
 *       each branch id is a non-empty string.
 *   (4) `timeoutMs` is an optional non-negative integer; 0 means
 *       "no timeout" (a durable wait), negative values are rejected.
 *   (5) `parseControlMergeConfig` is a thin, throw-on-failure
 *       wrapper around the schema.
 *   (6) `NodeFamilySchema` lists `control.merge`; `EdgeKindSchema`
 *       does NOT have `merge-in-N` (the fan-in is config-driven).
 */
import { describe, expect, test } from "bun:test"
import {
  ControlMergeConfigSchema,
  MergeStrategySchema,
  parseControlMergeConfig,
  CONTROL_MERGE_MAX_BRANCHES,
  NodeFamilySchema,
  EdgeKindSchema,
} from "../src/workflow-ir.ts"

describe("ControlMergeConfigSchema — happy path (1, 2, 3)", () => {
  test("(1) ParsesStrategyAll — strategy=all, 3 branches, no `n`", () => {
    const parsed = ControlMergeConfigSchema.parse({
      strategy: "all",
      branches: ["n-1", "n-2", "n-3"],
    })
    expect(parsed.strategy).toBe("all")
    expect(parsed.branches).toEqual(["n-1", "n-2", "n-3"])
    expect(parsed.n).toBeUndefined()
    expect(parsed.timeoutMs).toBeUndefined()
  })

  test("(2) ParsesStrategyAny — strategy=any, 2 branches, no `n`", () => {
    const parsed = ControlMergeConfigSchema.parse({
      strategy: "any",
      branches: ["n-fast", "n-slow"],
    })
    expect(parsed.strategy).toBe("any")
    expect(parsed.branches).toEqual(["n-fast", "n-slow"])
    expect(parsed.n).toBeUndefined()
  })

  test("(3) ParsesStrategyNOfM_Valid — strategy=n-of-m, n=2 of 4 branches", () => {
    const parsed = ControlMergeConfigSchema.parse({
      strategy: "n-of-m",
      branches: ["n-1", "n-2", "n-3", "n-4"],
      n: 2,
    })
    expect(parsed.strategy).toBe("n-of-m")
    expect(parsed.branches).toHaveLength(4)
    expect(parsed.n).toBe(2)
  })

  test("(3+) ParsesWithTimeoutMs — timeoutMs is preserved as a non-negative int", () => {
    const parsed = ControlMergeConfigSchema.parse({
      strategy: "all",
      branches: ["n-1", "n-2"],
      timeoutMs: 30_000,
    })
    expect(parsed.timeoutMs).toBe(30_000)
  })
})

describe("ControlMergeConfigSchema — n-of-m cross-field (4, 5, 6, 7, 8)", () => {
  test("(4) RejectsStrategyNOfM_MissingN — n-of-m without `n` is rejected", () => {
    const result = ControlMergeConfigSchema.safeParse({
      strategy: "n-of-m",
      branches: ["n-1", "n-2", "n-3"],
    })
    expect(result.success).toBe(false)
    if (!result.success) {
      const msg = result.error.issues.map((i) => i.message).join(" | ")
      expect(msg).toMatch(/control\.merge/)
    }
  })

  test("(5) RejectsStrategyNOfM_NTooSmall — n=0 is rejected (n must be ≥ 1)", () => {
    const result = ControlMergeConfigSchema.safeParse({
      strategy: "n-of-m",
      branches: ["n-1", "n-2", "n-3"],
      n: 0,
    })
    expect(result.success).toBe(false)
  })

  test("(6) RejectsStrategyNOfM_NTooLarge — n=5 with 4 branches is rejected", () => {
    const result = ControlMergeConfigSchema.safeParse({
      strategy: "n-of-m",
      branches: ["n-1", "n-2", "n-3", "n-4"],
      n: 5,
    })
    expect(result.success).toBe(false)
    if (!result.success) {
      const msg = result.error.issues.map((i) => i.message).join(" | ")
      expect(msg).toMatch(/control\.merge/)
    }
  })

  test("(7) RejectsStrategyAllWithN — `all` with `n` is rejected by the refine", () => {
    const result = ControlMergeConfigSchema.safeParse({
      strategy: "all",
      branches: ["n-1", "n-2", "n-3"],
      n: 2,
    })
    expect(result.success).toBe(false)
    if (!result.success) {
      const msg = result.error.issues.map((i) => i.message).join(" | ")
      expect(msg).toMatch(/control\.merge/)
    }
  })

  test("(8) RejectsStrategyAnyWithN — `any` with `n` is rejected by the refine", () => {
    const result = ControlMergeConfigSchema.safeParse({
      strategy: "any",
      branches: ["n-1", "n-2"],
      n: 1,
    })
    expect(result.success).toBe(false)
    if (!result.success) {
      const msg = result.error.issues.map((i) => i.message).join(" | ")
      expect(msg).toMatch(/control\.merge/)
    }
  })
})

describe("ControlMergeConfigSchema — branches array (9, 10, 13)", () => {
  test("(9) RejectsZeroBranches — empty `branches` is rejected", () => {
    const result = ControlMergeConfigSchema.safeParse({
      strategy: "all",
      branches: [],
    })
    expect(result.success).toBe(false)
    if (!result.success) {
      const msg = result.error.issues.map((i) => i.message).join(" | ")
      expect(msg).toMatch(/at least 1 branch/)
    }
  })

  test("(10) RejectsTooManyBranches — 65 branches exceeds the upper bound", () => {
    const branches = Array.from({ length: CONTROL_MERGE_MAX_BRANCHES + 1 }, (_, i) => `n-${i}`)
    expect(branches).toHaveLength(65)
    const result = ControlMergeConfigSchema.safeParse({
      strategy: "all",
      branches,
    })
    expect(result.success).toBe(false)
    if (!result.success) {
      const msg = result.error.issues.map((i) => i.message).join(" | ")
      expect(msg).toMatch(/at most 64 branches/)
    }
  })

  test("(10+) AcceptsMaxBranches — exactly CONTROL_MERGE_MAX_BRANCHES branches parses", () => {
    const branches = Array.from({ length: CONTROL_MERGE_MAX_BRANCHES }, (_, i) => `n-${i}`)
    const parsed = ControlMergeConfigSchema.parse({
      strategy: "all",
      branches,
    })
    expect(parsed.branches).toHaveLength(CONTROL_MERGE_MAX_BRANCHES)
  })

  test("(13) RejectsEmptyBranchId — branch with `''` is rejected", () => {
    const result = ControlMergeConfigSchema.safeParse({
      strategy: "all",
      branches: ["n-1", "", "n-3"],
    })
    expect(result.success).toBe(false)
    if (!result.success) {
      const msg = result.error.issues.map((i) => i.message).join(" | ")
      expect(msg).toMatch(/non-empty/)
    }
  })
})

describe("ControlMergeConfigSchema — timeoutMs (11, 12)", () => {
  test("(11) RejectsNegativeTimeoutMs — timeoutMs: -1 is rejected", () => {
    const result = ControlMergeConfigSchema.safeParse({
      strategy: "all",
      branches: ["n-1", "n-2"],
      timeoutMs: -1,
    })
    expect(result.success).toBe(false)
  })

  test("(12) AcceptsZeroTimeoutMs — timeoutMs: 0 means 'no timeout'", () => {
    const parsed = ControlMergeConfigSchema.parse({
      strategy: "all",
      branches: ["n-1", "n-2"],
      timeoutMs: 0,
    })
    expect(parsed.timeoutMs).toBe(0)
  })
})

describe("parseControlMergeConfig — helper (14, 15)", () => {
  test("(14) RoundTripsValid — parse → JSON → re-parse is equal (3 strategies)", () => {
    const fixtures = [
      { strategy: "all" as const, branches: ["a", "b", "c"] },
      { strategy: "any" as const, branches: ["x", "y"] },
      { strategy: "n-of-m" as const, branches: ["p", "q", "r", "s"], n: 3 },
    ]
    for (const original of fixtures) {
      const first = parseControlMergeConfig(original)
      const roundTripped = parseControlMergeConfig(JSON.parse(JSON.stringify(first)))
      expect(roundTripped).toEqual(first)
      expect(roundTripped.strategy).toBe(original.strategy)
      expect(roundTripped.branches).toEqual(original.branches)
      if ("n" in original) {
        expect(roundTripped.n).toBe(original.n)
      }
    }
  })

  test("(15) ThrowsOnInvalid — wrong type for `branches` (string) throws ZodError", () => {
    expect(() => parseControlMergeConfig({ strategy: "all", branches: "not-an-array" })).toThrow()
  })
})

describe("M2-04 — IR-level integration (16, 17, 18)", () => {
  test("(16) NodeFamilySchema_AcceptsControlMerge — `control.merge` is in the enum", () => {
    expect(NodeFamilySchema.options).toContain("control.merge")
  })

  test("(17) EdgeKindSchema_DoesNotHaveMergeIn — fan-in is config-driven, not edge-driven", () => {
    // The merge node identifies its fan-in through `config.branches`
    // (a flat array of node ids), not through a typed edge. The M2-04
    // commit intentionally did NOT add a `merge-in-N` EdgeKind —
    // matching the dual-channel pattern of `control.if` (where the
    // config and the `branch-true` / `branch-false` edges coexist).
    expect(EdgeKindSchema.options).not.toContain("merge-in-N")
    // Sanity check: the 6 documented kinds are still present so the
    // negative assertion is meaningful.
    expect(EdgeKindSchema.options).toEqual([
      "flow",
      "branch-true",
      "branch-false",
      "case-value",
      "branch-N",
      "on-failure",
    ])
  })

  test("(18) MergeStrategySchema_AcceptsAllThreeStrategies — enum lists all 3 values", () => {
    expect(MergeStrategySchema.options).toEqual(["all", "any", "n-of-m"])
  })
})
