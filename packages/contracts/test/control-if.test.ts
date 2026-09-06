/* SPDX-License-Identifier: MIT */
/* Copyright (c) 2026 Unifia contributors */

/**
 * M2-01 — `control.if` family configuration schema + parser (Plan V2.3.1 §198).
 *
 * ADR-002 (Workflow IR) + ADR-003 (expression language). The `control.if`
 * node family was already present in `NodeFamilySchema` since M1, and the
 * `branch-true` / `branch-false` `EdgeKind` values already cover the
 * routing semantics. M2-01 is *not* a new family — it is the explicit
 * shape of the family's `config` object, which the IR kept opaque
 * (`z.record(z.string(), z.unknown())`) so a new family cannot break an
 * existing one.
 *
 * Locked invariants (regression net):
 *   (1) `ControlIfConfigSchema` requires a non-empty `condition` bounded
 *       at 1024 chars (ADR-003 surface), and accepts an optional
 *       `trueBranch` / `falseBranch` (node id, nullish) and a `description`
 *       bounded at 280 chars.
 *   (2) `parseControlIfConfig` is a thin, throw-on-failure wrapper around
 *       the schema (mirror of `parseArtifactManifest`).
 *   (3) The opaque `NodeSchema.config` for `family: "control.if"` still
 *       parses at the IR level — the family-specific schema is applied
 *       only at the family's trust boundary, never at the IR parse step
 *       (that is the whole point of keeping `config` opaque).
 *   (4) A `WorkflowDefinition` with `branch-true` / `branch-false` edges
 *       round-trips through `WorkflowDefinitionSchema.parse` unchanged.
 */
import { describe, expect, test } from "bun:test"
import {
  ControlIfConfigSchema,
  parseControlIfConfig,
  NodeSchema,
  WorkflowDefinitionSchema,
  CONTROL_IF_CONDITION_MAX_CHARS,
  CONTROL_IF_DESCRIPTION_MAX_CHARS,
} from "../src/workflow-ir.ts"

/**
 * A fully-valid minimal `WorkflowDefinition` (no `control.if` node) that
 * the regression test (8) can clone and extend with a `control.if` node
 * and the corresponding `branch-true` / `branch-false` edges. Keeping
 * the fixture here means the regression test does not depend on any
 * other test file's helpers.
 */
const baseDefinition = {
  definitionId: "d-m2-01",
  ownershipScope: { organizationId: "o1", workspaceId: "w1" },
  displayName: "M2-01 regression fixture",
  nodes: [
    {
      id: "n-if",
      family: "control.if",
      config: { condition: "input.amount > 100" },
    },
    { id: "n-true", family: "tool.http", config: {} },
    { id: "n-false", family: "tool.http", config: {} },
  ] as const,
  edges: [
    { from: "n-if", to: "n-true", kind: "branch-true" as const },
    { from: "n-if", to: "n-false", kind: "branch-false" as const },
  ] as const,
  concurrency: { kind: "none" as const },
  defaultFailurePolicy: { kind: "propagate" as const },
  defaultTimeoutMs: 30_000,
  createdAt: 1_700_000_000,
  updatedAt: 1_700_000_000,
}

describe("ControlIfConfigSchema — happy path (1, 2)", () => {
  test("(1) ParsesValidMinimalConfig — only `condition` set", () => {
    const parsed = ControlIfConfigSchema.parse({ condition: "input.amount > 100" })
    expect(parsed.condition).toBe("input.amount > 100")
    // Optionals are absent.
    expect(parsed.trueBranch).toBeUndefined()
    expect(parsed.falseBranch).toBeUndefined()
    expect(parsed.description).toBeUndefined()
  })

  test("(2) ParsesValidFullConfig — all 4 fields set", () => {
    const parsed = ControlIfConfigSchema.parse({
      condition: "input.x === 'go'",
      trueBranch: "node-true",
      falseBranch: "node-false",
      description: "route by input.x",
    })
    expect(parsed.condition).toBe("input.x === 'go'")
    expect(parsed.trueBranch).toBe("node-true")
    expect(parsed.falseBranch).toBe("node-false")
    expect(parsed.description).toBe("route by input.x")
  })

  test("(2+) ParsesWithNullBranches — null is accepted (falls back to the edge)", () => {
    const parsed = ControlIfConfigSchema.parse({
      condition: "input.x",
      trueBranch: null,
      falseBranch: null,
    })
    expect(parsed.trueBranch).toBeNull()
    expect(parsed.falseBranch).toBeNull()
  })
})

describe("ControlIfConfigSchema — rejection (3, 4, 5)", () => {
  test("(3) RejectsEmptyCondition — condition: '' throws", () => {
    expect(() => ControlIfConfigSchema.parse({ condition: "" })).toThrow(/condition/)
  })

  test("(4) RejectsMissingCondition — config without condition throws", () => {
    expect(() => ControlIfConfigSchema.parse({})).toThrow(/condition/)
    expect(() =>
      ControlIfConfigSchema.parse({ trueBranch: "x", falseBranch: "y" }),
    ).toThrow(/condition/)
  })

  test("(5) RejectsTooLongDescription — description of 281 chars throws", () => {
    const tooLong = "a".repeat(CONTROL_IF_DESCRIPTION_MAX_CHARS + 1)
    expect(() =>
      ControlIfConfigSchema.parse({ condition: "input.x", description: tooLong }),
    ).toThrow(/description/)
  })

  test("(5+) RejectsTooLongCondition — 1025-char condition throws", () => {
    const tooLong = "a".repeat(CONTROL_IF_CONDITION_MAX_CHARS + 1)
    expect(() => ControlIfConfigSchema.parse({ condition: tooLong })).toThrow(/condition/)
  })
})

describe("parseControlIfConfig — helper (6, 7)", () => {
  test("(6) RoundTripsValid — parse → JSON → re-parse is equal", () => {
    const original = {
      condition: "input.amount > 100",
      trueBranch: "n-true",
      description: "expensive order",
    }
    const first = parseControlIfConfig(original)
    const roundTripped = parseControlIfConfig(JSON.parse(JSON.stringify(first)))
    expect(roundTripped).toEqual(first)
    expect(roundTripped.condition).toBe("input.amount > 100")
    expect(roundTripped.trueBranch).toBe("n-true")
    expect(roundTripped.description).toBe("expensive order")
  })

  test("(7) ThrowsOnInvalid — wrong type for `condition` (number) throws", () => {
    expect(() => parseControlIfConfig({ condition: 42 })).toThrow()
  })
})

describe("M2-01 — non-regression on the IR (8)", () => {
  test("(8) ControlIfFamilyParse — a `control.if` Node is accepted at IR level", () => {
    // The IR keeps `config` opaque. A `control.if` node with a *valid*
    // config (per family schema) is fine. A `control.if` node with a
    // *malformed* config (e.g. condition: '') is also accepted at the
    // IR level — the family validator catches it later. This is by
    // design (M2-01 §"do NOT modify NodeSchema" in the briefing).
    const result = NodeSchema.safeParse({
      id: "n-if",
      family: "control.if",
      config: { condition: "input.amount > 100" },
    })
    expect(result.success).toBe(true)

    // And the family-specific schema still catches the bad shape when
    // explicitly applied to the opaque record.
    const opaqueConfig = { condition: "" }
    expect(() => parseControlIfConfig(opaqueConfig)).toThrow(/condition/)
  })

  test("(8+) BranchTrueFalseEdges — WorkflowDefinition with branch-true/branch-false parses", () => {
    // Full regression on M1: a `WorkflowDefinition` carrying a
    // `control.if` node + `branch-true` / `branch-false` edges still
    // parses exactly as it did before M2-01.
    const parsed = WorkflowDefinitionSchema.parse(baseDefinition)
    expect(parsed.nodes).toHaveLength(3)
    expect(parsed.edges).toHaveLength(2)
    const kinds = parsed.edges.map((e) => e.kind).sort()
    expect(kinds).toEqual(["branch-false", "branch-true"])
  })
})
