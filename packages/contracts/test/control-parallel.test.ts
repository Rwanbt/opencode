/* SPDX-License-Identifier: MIT */
/* Copyright (c) 2026 Unifia contributors */

/**
 * M2-03 — `control.parallel` family configuration schema + parser (Plan V2.3.1 §198).
 *
 * ADR-002 (Workflow IR) + ADR-008 (scheduler/worker time authority). M2-03
 * adds the new `control.parallel` family to `NodeFamilySchema` (M2-03 commit
 * `d24aa71e69`), the new `branch-N` `EdgeKind` to `EdgeKindSchema`, and the
 * `ControlParallelConfigSchema` / `ControlParallelBranchSchema` / parser
 * pair. The IR keeps `Node.config` opaque, so the family-specific schema is
 * applied only at the family's trust boundary via
 * `parseControlParallelConfig(node.config)` — exactly the same dual-channel
 * contract as M2-01 (`control.if`).
 *
 * Locked invariants (regression net):
 *   (1) `ControlParallelBranchSchema` requires a `branchId` matching
 *       `CONTROL_PARALLEL_BRANCH_ID_PATTERN` (`/^[a-z][a-z0-9-]{0,63}$/`,
 *       anchored) and a non-empty `target` node id.
 *   (2) `ControlParallelConfigSchema` requires at least 1 branch
 *       (`branches.min(1)`) and rejects more than
 *       `CONTROL_PARALLEL_MAX_BRANCHES = 64` branches
 *       (`branches.max(64)`), with duplicate `branchId` rejected by
 *       `.refine()`.
 *   (3) `maxConcurrency`, when present, is a positive integer bounded by
 *       `CONTROL_PARALLEL_MAX_CONCURRENCY = 64`.
 *   (4) `failFast` defaults to `true` (the safe, common behavior) — the
 *       parser is the only place that applies this default.
 *   (5) `parseControlParallelConfig` is a thin, throw-on-failure wrapper
 *       around the schema (mirror of `parseControlIfConfig` and
 *       `parseControlSwitchConfig`).
 *   (6) A `Node` with `family: "control.parallel"` and an *opaque* config
 *       still parses at the IR level (the IR keeps `config` opaque), and
 *       the family validator catches malformed configs at the trust
 *       boundary.
 *   (7) `NodeFamilySchema.options` includes `"control.parallel"` and
 *       `EdgeKindSchema.options` includes `"branch-N"` — additive growth
 *       of the enums (no removal of the existing M1 + M2-01/02 literals).
 */
import { describe, expect, test } from "bun:test"
import {
  ControlParallelConfigSchema,
  ControlParallelBranchSchema,
  parseControlParallelConfig,
  CONTROL_PARALLEL_MAX_BRANCHES,
  CONTROL_PARALLEL_BRANCH_ID_PATTERN,
  CONTROL_PARALLEL_MAX_CONCURRENCY,
  NodeFamilySchema,
  EdgeKindSchema,
  NodeSchema,
  WorkflowDefinitionSchema,
} from "../src/workflow-ir.ts"

/**
 * Helper that builds a valid branch with overridable `branchId` and
 * `target`. Keeping this in one place means the rejection tests can use
 * the same shape and only mutate the field under test.
 */
function makeBranch(branchId: string, target: string) {
  return { branchId, target }
}

/**
 * Build a fully-valid minimal `WorkflowDefinition` carrying a
 * `control.parallel` node + `branch-N` edges, used by the regression
 * test (15). Mirrors the M2-01 `baseDefinition` fixture so the two
 * test files share the same structure.
 */
const baseDefinition = {
  definitionId: "d-m2-03",
  ownershipScope: { organizationId: "o1", workspaceId: "w1" },
  displayName: "M2-03 regression fixture",
  nodes: [
    {
      id: "n-par",
      family: "control.parallel",
      config: {
        branches: [
          makeBranch("alpha", "n-a"),
          makeBranch("beta", "n-b"),
        ],
        failFast: true,
      },
    },
    { id: "n-a", family: "tool.http", config: {} },
    { id: "n-b", family: "tool.http", config: {} },
  ] as const,
  edges: [
    { from: "n-par", to: "n-a", kind: "branch-N" as const },
    { from: "n-par", to: "n-b", kind: "branch-N" as const },
  ] as const,
  concurrency: { kind: "none" as const },
  defaultFailurePolicy: { kind: "propagate" as const },
  defaultTimeoutMs: 30_000,
  createdAt: 1_700_000_000,
  updatedAt: 1_700_000_000,
}

describe("ControlParallelConfigSchema — happy path (1, 2, 3, 8)", () => {
  test("(1) ParsesValidMinimalConfig — 1 branch, no maxConcurrency, failFast defaults to true", () => {
    const parsed = ControlParallelConfigSchema.parse({
      branches: [makeBranch("alpha", "n-a")],
    })
    expect(parsed.branches).toHaveLength(1)
    expect(parsed.branches[0]?.branchId).toBe("alpha")
    expect(parsed.branches[0]?.target).toBe("n-a")
    expect(parsed.maxConcurrency).toBeUndefined()
    // failFast is the family default; the parser applies it.
    expect(parsed.failFast).toBe(true)
  })

  test("(2) ParsesValidFullConfig — 3 branches, maxConcurrency=2, failFast=false", () => {
    const parsed = ControlParallelConfigSchema.parse({
      branches: [
        makeBranch("alpha", "n-a"),
        makeBranch("beta", "n-b"),
        makeBranch("gamma", "n-c"),
      ],
      maxConcurrency: 2,
      failFast: false,
    })
    expect(parsed.branches).toHaveLength(3)
    expect(parsed.maxConcurrency).toBe(2)
    expect(parsed.failFast).toBe(false)
  })

  test("(3) ParsesMaxBranches — 64 branches (= CONTROL_PARALLEL_MAX_BRANCHES) accepted", () => {
    const branches = Array.from({ length: CONTROL_PARALLEL_MAX_BRANCHES }, (_, i) =>
      makeBranch(`branch-${i}`, `n-${i}`),
    )
    const parsed = ControlParallelConfigSchema.parse({ branches })
    expect(parsed.branches).toHaveLength(CONTROL_PARALLEL_MAX_BRANCHES)
    expect(parsed.branches[0]?.branchId).toBe("branch-0")
    expect(parsed.branches[CONTROL_PARALLEL_MAX_BRANCHES - 1]?.branchId).toBe(
      `branch-${CONTROL_PARALLEL_MAX_BRANCHES - 1}`,
    )
  })

  test("(8) DefaultFailFastIsTrue — minimal config still gets failFast: true", () => {
    // Same shape as (1) but called through `parseControlParallelConfig` —
    // proves the default is applied by the parser, not the schema's
    // `.parse` only.
    const parsed = parseControlParallelConfig({
      branches: [makeBranch("b0", "n0")],
    })
    expect(parsed.failFast).toBe(true)
    expect(parsed.branches[0]?.branchId).toBe("b0")
  })
})

describe("ControlParallelConfigSchema — rejection (4, 5, 6, 7, 11)", () => {
  test("(4) RejectsZeroBranches — empty `branches` array rejected", () => {
    expect(() => ControlParallelConfigSchema.parse({ branches: [] })).toThrow(
      /at least 1 branch/i,
    )
  })

  test("(5) RejectsTooManyBranches — 65 branches rejected", () => {
    const branches = Array.from({ length: CONTROL_PARALLEL_MAX_BRANCHES + 1 }, (_, i) =>
      makeBranch(`branch-${i}`, `n-${i}`),
    )
    expect(() => ControlParallelConfigSchema.parse({ branches })).toThrow(
      new RegExp(`at most ${CONTROL_PARALLEL_MAX_BRANCHES}`),
    )
  })

  test("(6) RejectsZeroMaxConcurrency — maxConcurrency: 0 rejected", () => {
    expect(() =>
      ControlParallelConfigSchema.parse({
        branches: [makeBranch("b0", "n0")],
        maxConcurrency: 0,
      }),
    ).toThrow(/maxConcurrency must be positive/i)
  })

  test("(7) RejectsTooLargeMaxConcurrency — 65 (= MAX + 1) rejected", () => {
    expect(() =>
      ControlParallelConfigSchema.parse({
        branches: [makeBranch("b0", "n0")],
        maxConcurrency: CONTROL_PARALLEL_MAX_CONCURRENCY + 1,
      }),
    ).toThrow(
      new RegExp(`maxConcurrency must be ≤ ${CONTROL_PARALLEL_MAX_CONCURRENCY}`),
    )
  })

  test("(11) RejectsDuplicateBranchIds — 2 branches with the same `branchId` rejected", () => {
    expect(() =>
      ControlParallelConfigSchema.parse({
        branches: [makeBranch("alpha", "n-a"), makeBranch("alpha", "n-a2")],
      }),
    ).toThrow(/duplicate branchId/i)
  })
})

describe("ControlParallelBranchSchema — branchId pattern (9, 10, 17)", () => {
  test("(9) RejectsInvalidBranchIdPattern — branchId '1abc' rejected (must start with a letter)", () => {
    expect(() => ControlParallelBranchSchema.parse(makeBranch("1abc", "n0"))).toThrow(
      /branchId must match/,
    )
  })

  test("(10) RejectsInvalidBranchIdPattern_Uppercase — branchId 'BranchA' rejected", () => {
    expect(() => ControlParallelBranchSchema.parse(makeBranch("BranchA", "n0"))).toThrow(
      /branchId must match/,
    )
  })

  test("(17) AcceptsValidBranchId — typical lowercase patterns accepted", () => {
    const validIds = ["b0", "long-branch-name-with-dashes", "abc123"]
    for (const branchId of validIds) {
      const parsed = ControlParallelBranchSchema.parse(makeBranch(branchId, "n0"))
      expect(parsed.branchId).toBe(branchId)
    }
    // The exported regex is the same one the schema uses — pin it so a
    // silent edit to one without the other is caught.
    expect(CONTROL_PARALLEL_BRANCH_ID_PATTERN.test("alpha")).toBe(true)
    expect(CONTROL_PARALLEL_BRANCH_ID_PATTERN.test("a-1-b")).toBe(true)
  })
})

describe("ControlParallelBranchSchema — target (16)", () => {
  test("(16) RejectsEmptyTarget — target: '' rejected", () => {
    expect(() => ControlParallelBranchSchema.parse(makeBranch("b0", ""))).toThrow(
      /branch\.target must be a non-empty node id/i,
    )
  })
})

describe("parseControlParallelConfig — helper (12, 13)", () => {
  test("(12) RoundTripsValid — parse → JSON → re-parse is equal", () => {
    const original = {
      branches: [
        makeBranch("alpha", "n-a"),
        makeBranch("beta", "n-b"),
      ],
      maxConcurrency: 2,
      failFast: false,
    }
    const first = parseControlParallelConfig(original)
    const roundTripped = parseControlParallelConfig(JSON.parse(JSON.stringify(first)))
    expect(roundTripped).toEqual(first)
    expect(roundTripped.branches).toHaveLength(2)
    expect(roundTripped.maxConcurrency).toBe(2)
    expect(roundTripped.failFast).toBe(false)
  })

  test("(13) ThrowsOnInvalid — wrong type for `branches` (string) throws ZodError", () => {
    let caught: unknown = null
    try {
      parseControlParallelConfig({ branches: "not-an-array" })
    } catch (e) {
      caught = e
    }
    expect(caught).not.toBeNull()
    // Zod surfaces its errors with the `ZodError` class; the message
    // references the `branches` field path.
    expect(String(caught)).toMatch(/branches/)
  })
})

describe("M2-03 — non-regression on the IR (14, 15)", () => {
  test("(14) NodeFamilySchema_AcceptsControlParallel — enum includes 'control.parallel'", () => {
    expect(NodeFamilySchema.options).toContain("control.parallel")
    // The pre-M2-03 families must still be present (additive growth).
    expect(NodeFamilySchema.options).toContain("control.if")
    expect(NodeFamilySchema.options).toContain("control.switch")
    expect(NodeFamilySchema.options).toContain("trigger.manual")
  })

  test("(14+) EdgeKindSchema_AcceptsBranchN — enum includes 'branch-N'", () => {
    expect(EdgeKindSchema.options).toContain("branch-N")
    // Pre-M2-03 edge kinds still present (additive growth).
    expect(EdgeKindSchema.options).toContain("flow")
    expect(EdgeKindSchema.options).toContain("branch-true")
    expect(EdgeKindSchema.options).toContain("branch-false")
    expect(EdgeKindSchema.options).toContain("case-value")
    expect(EdgeKindSchema.options).toContain("on-failure")
  })

  test("(15) ControlParallelFamilyParse — a `control.parallel` Node is accepted at IR level", () => {
    // The IR keeps `config` opaque. A `control.parallel` node with a
    // *valid* config is fine. A malformed config (e.g. empty target)
    // is also accepted at the IR level — the family validator catches
    // it later. This is by design (see the M2-01 briefing comment on
    // the dual-channel contract).
    const good = NodeSchema.safeParse({
      id: "n-par",
      family: "control.parallel",
      config: { branches: [makeBranch("b0", "n0")] },
    })
    expect(good.success).toBe(true)

    const opaqueBad = NodeSchema.safeParse({
      id: "n-par",
      family: "control.parallel",
      config: { branches: [makeBranch("b0", "")] },
    })
    expect(opaqueBad.success).toBe(true) // IR still accepts the opaque record

    // Family-specific schema catches the bad shape.
    expect(() =>
      parseControlParallelConfig({ branches: [makeBranch("b0", "")] }),
    ).toThrow(/branch\.target/)
  })

  test("(15+) BranchNEdges — WorkflowDefinition with `branch-N` edges round-trips through IR parse", () => {
    // Full regression: a `WorkflowDefinition` carrying a
    // `control.parallel` node + `branch-N` edges parses exactly like
    // the pre-M2-03 `branch-true` / `branch-false` flow.
    const parsed = WorkflowDefinitionSchema.parse(baseDefinition)
    expect(parsed.nodes).toHaveLength(3)
    expect(parsed.edges).toHaveLength(2)
    const kinds = parsed.edges.map((e) => e.kind).sort()
    expect(kinds).toEqual(["branch-N", "branch-N"])
    const families = parsed.nodes.map((n) => n.family).sort()
    expect(families).toEqual(["control.parallel", "tool.http", "tool.http"])
  })
})
