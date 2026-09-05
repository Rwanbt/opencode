/* SPDX-License-Identifier: MIT */
/* Copyright (c) 2026 Unifia contributors */

import { describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { GraphRuntimeEngine, GraphRuntimeError } from "../src/graph-runtime"
import type { WorkflowDefinition } from "@unifia/contracts"

const def = (nodes: WorkflowDefinition["nodes"], edges: WorkflowDefinition["edges"]): WorkflowDefinition => ({
  definitionId: "def-1", ownershipScope: { organizationId: "org", workspaceId: "ws" }, displayName: "t",
  nodes, edges,
  concurrency: { kind: "single" }, defaultFailurePolicy: { kind: "propagate" },
  defaultTimeoutMs: 0, createdAt: 1, updatedAt: 1,
})

const clock = { value: 1000 }
const now = () => clock.value

function engine(defn: WorkflowDefinition): { engine: GraphRuntimeEngine; dir: string } {
  const dir = mkdtempSync(join(tmpdir(), "unifia-graph-"))
  const engine = new GraphRuntimeEngine({ databasePath: join(dir, "g.sqlite"), definition: defn, now })
  engine.initialize()
  return { engine, dir }
}

const node = (id: string, family: string, config: Record<string, unknown> = {}) => ({ id, family, config })

const ifDef = () => def(
  [node("gate", "control.if", { condition: "input.go", trueBranch: "yes", falseBranch: "no" }), node("yes", "tool.http", {}), node("no", "tool.http", {})],
  [ { from: "gate", to: "yes", kind: "branch-true" }, { from: "gate", to: "no", kind: "branch-false" } ],
)

const switchDef = () => def(
  [node("hub", "control.switch", { discriminator: "input.route", cases: [ { value: "A", target: "a" }, { value: "B", target: "b" } ], default: "fallback" }),
   node("a", "tool.http", {}), node("b", "tool.http", {}), node("fallback", "tool.http", {})],
  [ { from: "hub", to: "a", kind: "case-value" }, { from: "hub", to: "b", kind: "case-value" }, { from: "hub", to: "fallback", kind: "case-value" } ],
)

describe("GraphRuntimeEngine — control.if (directive 6)", () => {
  test("decides via the canonical evaluator; unselected branch SKIPPED (no side effects)", () => {
    const ctx = engine(ifDef()); try {
      ctx.engine.startRun("r1")
      const out = ctx.engine.decideIf("r1", "gate", { input: { go: true } })
      expect(out.result).toBe(true); expect(out.takenNodeId).toBe("yes"); expect(out.skippedNodeId).toBe("no"); expect(out.committedNow).toBe(true)
      expect(ctx.engine.nodeState("r1", "yes")!.status).toBe("PENDING")
      expect(ctx.engine.nodeState("r1", "no")!.status).toBe("SKIPPED")
    } finally { ctx.engine.close(); rmSync(ctx.dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }) }
  })

  test("RESTART: an already-committed decision is returned unchanged (env now says the opposite)", () => {
    const dir = mkdtempSync(join(tmpdir(), "unifia-graph-restart-"))
    try {
      const first = new GraphRuntimeEngine({ databasePath: join(dir, "g.sqlite"), definition: ifDef(), now })
      first.initialize(); first.startRun("r1")
      first.decideIf("r1", "gate", { input: { go: true } })
      first.close()
      const second = new GraphRuntimeEngine({ databasePath: join(dir, "g.sqlite"), definition: ifDef(), now })
      second.initialize()
      const again = second.decideIf("r1", "gate", { input: { go: false } })
      expect(again.result).toBe(true); expect(again.takenNodeId).toBe("yes"); expect(again.committedNow).toBe(false)
      expect(second.nodeState("r1", "no")!.status).toBe("SKIPPED")
      second.close()
    } finally { rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }) }
  })

  test("fail-closed: non-boolean condition result is a typed error; invalid expression rejected", () => {
    const ctx = engine(ifDef()); try {
      ctx.engine.startRun("r1")
      try { ctx.engine.decideIf("r1", "gate", { input: { go: "yes" } }); expect.unreachable() } catch (e) { expect((e as GraphRuntimeError).code).toBe("EXPR_NOT_BOOLEAN") }
      const badDef = def([node("gate", "control.if", { condition: "a.b() > 1", trueBranch: "yes", falseBranch: "no" }), node("yes", "tool.http", {}), node("no", "tool.http", {})], [{ from: "gate", to: "yes", kind: "branch-true" }, { from: "gate", to: "no", kind: "branch-false" }])
      const bad = new GraphRuntimeEngine({ databasePath: join(ctx.dir, "bad.sqlite"), definition: badDef, now })
      bad.initialize(); bad.startRun("r2")
      try { bad.decideIf("r2", "gate", { a: {} }); expect.unreachable() } catch (e) { expect((e as GraphRuntimeError).code).toBe("EXPR_PARSE_ERROR") }
      bad.close()
    } finally { ctx.engine.close(); rmSync(ctx.dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }) }
  })

  test("CRASH BEFORE DECISION COMMIT: nothing persisted, fresh decide after restart takes the real env", () => {
    const dir = mkdtempSync(join(tmpdir(), "unifia-graph-crash-"))
    try {
      const first = new GraphRuntimeEngine({ databasePath: join(dir, "g.sqlite"), definition: ifDef(), now })
      first.initialize(); first.startRun("r1")
      // crash = no decideIf call, engine dies
      first.close()
      const second = new GraphRuntimeEngine({ databasePath: join(dir, "g.sqlite"), definition: ifDef(), now })
      second.initialize()
      const out = second.decideIf("r1", "gate", { input: { go: false } })
      expect(out.result).toBe(false); expect(out.takenNodeId).toBe("no"); expect(out.committedNow).toBe(true)
      expect(second.nodeState("r1", "yes")!.status).toBe("SKIPPED")
      second.close()
    } finally { rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }) }
  })
})

describe("GraphRuntimeEngine — control.switch (directive 7)", () => {
  test("exact case resolution, default only on no-match, other cases SKIPPED", () => {
    const ctx = engine(switchDef()); try {
      ctx.engine.startRun("r1")
      const out = ctx.engine.decideSwitch("r1", "hub", { input: { route: "B" } })
      expect(out.caseValue).toBe("B"); expect(out.takenNodeId).toBe("b"); expect(out.committedNow).toBe(true)
      expect(ctx.engine.nodeState("r1", "a")!.status).toBe("SKIPPED")
      expect(ctx.engine.nodeState("r1", "fallback")!.status).toBe("SKIPPED")
      const out2 = ctx.engine.decideSwitch("r1", "hub", { input: { route: "ZZ" } })
      expect(out2.takenNodeId).toBe("b"); expect(out2.committedNow).toBe(false)
    } finally { ctx.engine.close(); rmSync(ctx.dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }) }
  })

  test("no-match without default: typed failure (frozen fail-closed contract)", () => {
    const nodes = [node("hub", "control.switch", { discriminator: "input.route", cases: [{ value: "A", target: "a" }] }), node("a", "tool.http", {})]
    const ctx = engine(def(nodes, [{ from: "hub", to: "a", kind: "case-value" }])); try {
      ctx.engine.startRun("r1")
      try { ctx.engine.decideSwitch("r1", "hub", { input: { route: "Q" } }); expect.unreachable() } catch (e) { expect((e as GraphRuntimeError).code).toBe("SWITCH_NO_MATCH") }
    } finally { ctx.engine.close(); rmSync(ctx.dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }) }
  })

  test("RESTART: switch decision stable", () => {
    const dir = mkdtempSync(join(tmpdir(), "unifia-sw-restart-"))
    try {
      const first = new GraphRuntimeEngine({ databasePath: join(dir, "g.sqlite"), definition: switchDef(), now })
      first.initialize(); first.startRun("r1")
      first.decideSwitch("r1", "hub", { input: { route: "A" } })
      first.close()
      const second = new GraphRuntimeEngine({ databasePath: join(dir, "g.sqlite"), definition: switchDef(), now })
      second.initialize()
      const again = second.decideSwitch("r1", "hub", { input: { route: "B" } })
      expect(again.takenNodeId).toBe("a"); expect(again.committedNow).toBe(false)
      second.close()
    } finally { rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }) }
  })
})

describe("GraphRuntimeEngine — canonical contract consumption (directive 5)", () => {
  test("an INVALID graph is rejected before any execution (only validated IR runs)", () => {
    const badNodes = [node("x", "control.merge", {})]
    try {
      new GraphRuntimeEngine({ databasePath: join(tmpdir(), "nope.sqlite"), definition: def(badNodes, []), now })
      expect.unreachable()
    } catch (e) { expect((e as GraphRuntimeError).code).toBe("GRAPH_INVALID") }
  })
})
