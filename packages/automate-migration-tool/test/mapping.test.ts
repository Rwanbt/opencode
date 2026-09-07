/* SPDX-License-Identifier: MIT */
/* Copyright (c) 2026 Unifia contributors */

/**
 * V1 → V2 IR migration tool — locked invariants (regression net).
 *
 * (1) `migrateV1ToV2` returns a `MigrationResult` with `definition`
 *     and `warnings` for any non-empty V1 input.
 * (2) The trigger node is always the first node; its id is
 *     `${v1.id}__trigger` deterministically.
 * (3) Sequential V1 steps produce a chain of `flow` edges
 *     (trigger → step1 → step2 → ...).
 * (4) `requiresApproval: true` inserts a `human.approval` node
 *     immediately before the step's main node, with a `flow` edge.
 * (5) V1 `http` → V2 `tool.http`; V1 `wait` → V2 `wait`; V1
 *     `approval` → V2 `human.approval`; V1 `schedule` → V2
 *     `trigger.schedule`; V1 `manual` → V2 `trigger.manual`.
 * (6) V1 `shell` and `openapi` are NOT in the mapping table → they
 *     produce a `block`-severity warning and abort the rest of the
 *     mapping.
 * (7) V1 with `steps: []` produces an `info` warning and a
 *     `trigger.manual` trigger node.
 * (8) V1 with `requiresApproval: true` on the first step inserts
 *     `${step.id}__approval` BEFORE the step's main node.
 * (9) V2 IR's `createdAt` / `updatedAt` come from the caller; the
 *     migrator never consults the wall clock.
 * (10) `isAcceptableMigration` returns `true` iff no warning has
 *      `severity: "block"`.
 * (11) Re-running `migrateV1ToV2` on the same V1 input with the
 *      same timestamps produces structurally identical V2 IR (id,
 *      family, edges).
 * (12) V1 `defaultOwner` is `v1-migration` with a `warn` so the
 *      operator can update before cutover.
 */

import { describe, expect, test } from "bun:test"
import {
  isAcceptableMigration,
  migrateV1ToV2,
  V1_GLOBAL_DEFAULTS,
  V1CapabilityKindSchema,
  V1StepSchema,
  V1WorkflowDefinitionSchema,
  type V1StepInput,
  type V1WorkflowDefinition,
  type V1WorkflowDefinitionInput,
} from "../src/index.ts"

const NOW = 1_700_000_000_000

function makeV1(steps: V1StepInput[]): V1WorkflowDefinition {
  return {
    id: "wf-test",
    version: 1,
    workspaceId: "ws-test",
    steps,
  } as V1WorkflowDefinition
}

function makeEmptyV1(): V1WorkflowDefinition {
  return {
    id: "wf-empty",
    version: 1,
    workspaceId: "ws-test",
    steps: [],
  } as V1WorkflowDefinition
}

describe("V1 IR schema", () => {
  test("V1CapabilityKindSchema accepts the 7 V1 kinds", () => {
    expect(V1CapabilityKindSchema.parse("http")).toBe("http")
    expect(V1CapabilityKindSchema.parse("shell")).toBe("shell")
    expect(V1CapabilityKindSchema.parse("openapi")).toBe("openapi")
    expect(V1CapabilityKindSchema.parse("approval")).toBe("approval")
    expect(V1CapabilityKindSchema.parse("wait")).toBe("wait")
    expect(V1CapabilityKindSchema.parse("schedule")).toBe("schedule")
    expect(V1CapabilityKindSchema.parse("manual")).toBe("manual")
  })

  test("V1StepSchema defaults requiresApproval to false", () => {
    const step = V1StepSchema.parse({ id: "s1", capability: "http", input: { url: "https://x" } })
    expect(step.requiresApproval).toBe(false)
  })

  test("V1StepSchema rejects empty id", () => {
    expect(() => V1StepSchema.parse({ id: "", capability: "http", input: {} })).toThrow()
  })

  test("V1WorkflowDefinitionSchema rejects empty steps", () => {
    expect(() => V1WorkflowDefinitionSchema.parse({ id: "wf", version: 1, workspaceId: "ws", steps: [] })).toThrow()
  })

  test("V1_GLOBAL_DEFAULTS is single-attempt, no-backoff", () => {
    expect(V1_GLOBAL_DEFAULTS.maxAttempts).toBe(1)
    expect(V1_GLOBAL_DEFAULTS.backoff).toBe("none")
  })
})

describe("migrateV1ToV2", () => {
  test("sequential http steps produce a chain of flow edges", () => {
    const v1 = makeV1([
      { id: "s1", capability: "http", input: { url: "https://a" } },
      { id: "s2", capability: "http", input: { url: "https://b" } },
    ])
    const r = migrateV1ToV2(v1, { createdAt: NOW, updatedAt: NOW })
    expect(isAcceptableMigration(r)).toBe(true)
    expect(r.definition.nodes).toHaveLength(3) // trigger + 2 steps
    expect(r.definition.edges).toHaveLength(2) // trigger→s1, s1→s2
    expect(r.definition.edges[0]).toEqual({ from: "wf-test__trigger", to: "s1", kind: "flow" })
    expect(r.definition.edges[1]).toEqual({ from: "s1", to: "s2", kind: "flow" })
  })

  test("requiresApproval inserts a human.approval node before the step", () => {
    const v1 = makeV1([{ id: "s1", capability: "http", input: {}, requiresApproval: true }])
    const r = migrateV1ToV2(v1, { createdAt: NOW, updatedAt: NOW })
    expect(isAcceptableMigration(r)).toBe(true)
    expect(r.definition.nodes.map((n) => n.id)).toEqual(["wf-test__trigger", "s1__approval", "s1"])
    const approval = r.definition.nodes.find((n) => n.id === "s1__approval")
    expect(approval?.family).toBe("human.approval")
    expect(r.definition.edges).toContainEqual({ from: "s1__approval", to: "s1", kind: "flow" })
  })

  test("V1 schedule capability maps to trigger.schedule (no separate trigger step)", () => {
    const v1 = makeV1([{ id: "s1", capability: "schedule", input: { cron: "*/5 * * * *" } }])
    const r = migrateV1ToV2(v1, { createdAt: NOW, updatedAt: NOW })
    expect(isAcceptableMigration(r)).toBe(true)
    // First step is the trigger, absorbed; no separate __trigger node.
    const trigger = r.definition.nodes.find((n) => n.id === "s1")
    expect(trigger?.family).toBe("trigger.schedule")
    // The single node is the absorbed trigger — no __trigger.
    expect(r.definition.nodes.find((n) => n.id === "wf-test__trigger")).toBeUndefined()
  })

  test("V1 manual capability maps to trigger.manual", () => {
    const v1 = makeV1([{ id: "s1", capability: "manual", input: {} }])
    const r = migrateV1ToV2(v1, { createdAt: NOW, updatedAt: NOW })
    expect(isAcceptableMigration(r)).toBe(true)
    const trigger = r.definition.nodes.find((n) => n.id === "s1")
    expect(trigger?.family).toBe("trigger.manual")
    expect(r.definition.nodes.find((n) => n.id === "wf-test__trigger")).toBeUndefined()
  })

  test("V1 wait capability maps to V2 wait", () => {
    const v1 = makeV1([{ id: "s1", capability: "http", input: {} }, { id: "s2", capability: "wait", input: { ms: 1000 } }])
    const r = migrateV1ToV2(v1, { createdAt: NOW, updatedAt: NOW })
    expect(isAcceptableMigration(r)).toBe(true)
    const wait = r.definition.nodes.find((n) => n.id === "s2")
    expect(wait?.family).toBe("wait")
  })

  test("V1 shell capability produces a block warning", () => {
    const v1 = makeV1([{ id: "s1", capability: "shell", input: { cmd: "ls" } }])
    const r = migrateV1ToV2(v1, { createdAt: NOW, updatedAt: NOW })
    expect(isAcceptableMigration(r)).toBe(false)
    const block = r.warnings.find((w) => w.code === "v1-unsupported-capability")
    expect(block?.severity).toBe("block")
  })

  test("V1 openapi capability produces a block warning", () => {
    const v1 = makeV1([{ id: "s1", capability: "openapi", input: { url: "https://api/x" } }])
    const r = migrateV1ToV2(v1, { createdAt: NOW, updatedAt: NOW })
    expect(isAcceptableMigration(r)).toBe(false)
    const block = r.warnings.find((w) => w.code === "v1-unsupported-capability")
    expect(block?.severity).toBe("block")
  })

  test("V1 default owner is `v1-migration` with a warn", () => {
    const v1 = makeV1([{ id: "s1", capability: "http", input: {} }])
    const r = migrateV1ToV2(v1, { createdAt: NOW, updatedAt: NOW })
    expect(r.definition.ownershipScope.ownerId).toBe("v1-migration")
    expect(r.warnings.some((w) => w.code === "v1-default-owner")).toBe(true)
  })

  test("determinism: same V1 + same timestamps → identical V2 IR", () => {
    const v1 = makeV1([{ id: "s1", capability: "http", input: { x: 1 } }])
    const a = migrateV1ToV2(v1, { createdAt: NOW, updatedAt: NOW })
    const b = migrateV1ToV2(v1, { createdAt: NOW, updatedAt: NOW })
    expect(a.definition).toEqual(b.definition)
    expect(a.warnings).toEqual(b.warnings)
  })

  test("V1 with no steps produces a warn and a manual trigger", () => {
    // Build a V1 fixture with an empty step list by bypassing the
    // schema (`min(1)`) — the migrator is the authoritative gate.
    const v1 = makeEmptyV1()
    const r = migrateV1ToV2(v1, { createdAt: NOW, updatedAt: NOW })
    const trigger = r.definition.nodes.find((n) => n.id === "wf-empty__trigger")
    expect(trigger?.family).toBe("trigger.manual")
    expect(r.warnings.some((w) => w.code === "v1-no-steps")).toBe(true)
  })

  test("V2 IR includes V1 globals lifted into policies", () => {
    const v1 = makeV1([{ id: "s1", capability: "http", input: {} }])
    const r = migrateV1ToV2(v1, { createdAt: NOW, updatedAt: NOW })
    expect(r.definition.defaultFailurePolicy.maxAttempts).toBe(V1_GLOBAL_DEFAULTS.maxAttempts)
    expect(r.definition.defaultFailurePolicy.backoff).toBe(V1_GLOBAL_DEFAULTS.backoff)
    expect(r.definition.defaultTimeoutMs).toBeGreaterThan(0)
  })
})
