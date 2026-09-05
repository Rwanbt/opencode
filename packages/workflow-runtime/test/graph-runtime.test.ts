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

const node = (id: string, family: any, config: Record<string, unknown> = {}): any => ({ id, family, config })

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

describe("GraphRuntimeEngine — control.parallel / control.merge (directives 8-9)", () => {
  const parDef = () => def(
    [node("fan", "control.parallel", { branches: [ { branchId: "b1", target: "w1" }, { branchId: "b2", target: "w2" }, { branchId: "b3", target: "w3" } ] }),
     node("w1", "tool.http", {}), node("w2", "tool.http", {}), node("w3", "tool.http", {}),
     node("join", "control.merge", { strategy: "all", branches: ["w1", "w2", "w3"] }), node("after", "tool.http", {})],
    [ { from: "fan", to: "w1", kind: "branch-N" }, { from: "fan", to: "w2", kind: "branch-N" }, { from: "fan", to: "w3", kind: "branch-N" }, { from: "w1", to: "join", kind: "flow" }, { from: "w2", to: "join", kind: "flow" }, { from: "w3", to: "join", kind: "flow" }, { from: "join", to: "after", kind: "flow" } ],
  )

  test("fan-out is durable + restart-safe; branches under the SAME run authority", () => {
    const dir = mkdtempSync(join(tmpdir(), "unifia-par-"))
    try {
      const first = new GraphRuntimeEngine({ databasePath: join(dir, "g.sqlite"), definition: parDef(), now })
      first.initialize(); first.startRun("r1")
      const out = first.fanOutParallel("r1", "fan")
      expect(out.targets).toEqual(["w1", "w2", "w3"]); expect(out.committedNow).toBe(true)
      first.close()
      const second = new GraphRuntimeEngine({ databasePath: join(dir, "g.sqlite"), definition: parDef(), now })
      second.initialize()
      const again = second.fanOutParallel("r1", "fan")
      expect(again.committedNow).toBe(false)
      expect(second.nodeState("r1", "w2")!.status).toBe("PENDING")
      second.close()
    } finally { rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }) }
  })

  test("merge all: fires once with deterministic config-order outputs after every branch completes", () => {
    const ctx = engine(parDef()); try {
      ctx.engine.startRun("r1"); ctx.engine.fanOutParallel("r1", "fan")
      ctx.engine.completeNode("r1", "w1", { which: 1 })
      let join = ctx.engine.tryJoinMerge("r1", "join")
      expect(join.fired).toBe(false)
      ctx.engine.completeNode("r1", "w3", { which: 3 })
      join = ctx.engine.tryJoinMerge("r1", "join")
      expect(join.fired).toBe(false)
      ctx.engine.completeNode("r1", "w2", { which: 2 })
      join = ctx.engine.tryJoinMerge("r1", "join")
      expect(join.fired).toBe(true); expect(join.firedNow).toBe(true)
      expect(join.outputs).toEqual([ { which: 1 }, { which: 2 }, { which: 3 } ])
      expect(ctx.engine.nodeState("r1", "after")!.status).toBe("PENDING")
      const again = ctx.engine.tryJoinMerge("r1", "join")
      expect(again.fired).toBe(true); expect(again.firedNow).toBe(false)
    } finally { ctx.engine.close(); rmSync(ctx.dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }) }
  })

  test("merge all: one branch failure fails the join, exactly once (no duplicate logical transition)", () => {
    const ctx = engine(parDef()); try {
      ctx.engine.startRun("r1"); ctx.engine.fanOutParallel("r1", "fan")
      ctx.engine.completeNode("r1", "w1", { ok: true })
      ctx.engine.failNode("r1", "w2", "provider 500")
      const join = ctx.engine.tryJoinMerge("r1", "join")
      expect(join.fired).toBe(false); expect(join.failedBranch).toBe("w2")
      expect(ctx.engine.nodeState("r1", "join")!.status).toBe("FAILED")
      const again = ctx.engine.tryJoinMerge("r1", "join")
      expect(again.firedNow).toBe(false); expect(again.failedBranch).toBe("w2")
    } finally { ctx.engine.close(); rmSync(ctx.dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }) }
  })
  test("RESTART between branch completion and merge: outputs preserved from durable facts, no recomputation", () => {
    const dir = mkdtempSync(join(tmpdir(), "unifia-par-restart-"))
    try {
      const first = new GraphRuntimeEngine({ databasePath: join(dir, "g.sqlite"), definition: parDef(), now })
      first.initialize(); first.startRun("r1"); first.fanOutParallel("r1", "fan")
      first.completeNode("r1", "w1", { which: 1 }); first.completeNode("r1", "w2", { which: 2 }); first.completeNode("r1", "w3", { which: 3 })
      first.close()
      const second = new GraphRuntimeEngine({ databasePath: join(dir, "g.sqlite"), definition: parDef(), now })
      second.initialize()
      const merged = second.tryJoinMerge("r1", "join")
      expect(merged.fired).toBe(true); expect(merged.outputs).toEqual([ { which: 1 }, { which: 2 }, { which: 3 } ])
      second.close()
    } finally { rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }) }
  })

  test("merge any: fires on first completed branch", () => {
    const anyDef = def(
      [node("fan", "control.parallel", { branches: [ { branchId: "b1", target: "w1" }, { branchId: "b2", target: "w2" } ] }), node("w1", "tool.http", {}), node("w2", "tool.http", {}), node("join", "control.merge", { strategy: "any", branches: ["w1", "w2"] })],
      [ { from: "fan", to: "w1", kind: "branch-N" }, { from: "fan", to: "w2", kind: "branch-N" }, { from: "w1", to: "join", kind: "flow" }, { from: "w2", to: "join", kind: "flow" } ],
    )
    const ctx = engine(anyDef); try {
      ctx.engine.startRun("r1"); ctx.engine.fanOutParallel("r1", "fan")
      ctx.engine.completeNode("r1", "w2", { late: true })
      const join = ctx.engine.tryJoinMerge("r1", "join")
      expect(join.fired).toBe(true)
      expect(join.outputs).toEqual([ null, { late: true } ])
    } finally { ctx.engine.close(); rmSync(ctx.dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }) }
  })
})

describe("GraphRuntimeEngine — control.repeat / control.while (directive 11)", () => {
  const loopDef = (family: string, config: Record<string, unknown>) => def(
    [node("loop", family, { ...config, body: "body" }), node("body", "tool.http", {}), node("after", "tool.http", {})],
    [ { from: "loop", to: "body", kind: "flow" }, { from: "loop", to: "after", kind: "flow" } ],
  )

  test("repeat: bounded iterations, untilCondition exit, successors scheduled", () => {
    const ctx = engine(loopDef("control.repeat", { maxIterations: 10, untilCondition: "input.count >= 3" })); try {
      ctx.engine.startRun("r1")
      let step = ctx.engine.enterLoop("r1", "loop", { input: { count: 0 } })
      expect(step.done).toBe(false); expect(step.iteration).toBe(1); expect(step.bodyNodeId).toBe("body")
      ctx.engine.completeNode("r1", "body", { iteration: 1 })
      step = ctx.engine.enterLoop("r1", "loop", { input: { count: 1 } })
      expect(step.iteration).toBe(2)
      ctx.engine.completeNode("r1", "body", { iteration: 2 })
      step = ctx.engine.enterLoop("r1", "loop", { input: { count: 2 } })
      expect(step.iteration).toBe(3)
      ctx.engine.completeNode("r1", "body", { iteration: 3 })
      step = ctx.engine.enterLoop("r1", "loop", { input: { count: 3 } })
      expect(step.done).toBe(true); expect(step.bodyNodeId).toBeNull()
      expect(ctx.engine.nodeState("r1", "after")!.status).toBe("PENDING")
    } finally { ctx.engine.close(); rmSync(ctx.dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }) }
  })

  test("RESTART mid-loop: iteration counter survives, completed iterations are durable facts", () => {
    const dir = mkdtempSync(join(tmpdir(), "unifia-loop-restart-"))
    try {
      const loopConf = { maxIterations: 10, untilCondition: "input.count >= 3" }
      const first = new GraphRuntimeEngine({ databasePath: join(dir, "g.sqlite"), definition: loopDef("control.repeat", loopConf), now })
      first.initialize(); first.startRun("r1")
      first.enterLoop("r1", "loop", { input: { count: 0 } })
      first.completeNode("r1", "body", { iteration: 1 })
      first.enterLoop("r1", "loop", { input: { count: 1 } })
      first.close()
      const second = new GraphRuntimeEngine({ databasePath: join(dir, "g.sqlite"), definition: loopDef("control.repeat", loopConf), now })
      second.initialize()
      const step = second.enterLoop("r1", "loop", { input: { count: 2 } })
      expect(step.iteration).toBe(3); expect(step.done).toBe(false)
      const events = second.inspectEvents("r1").map((e) => e.kind)
      expect(events.filter((k) => k === "LOOP_ITERATE")).toHaveLength(3)
      second.close()
    } finally { rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }) }
  })

  test("while: condition flip exits; maxIterations is a hard guard (no infinite execution)", () => {
    const ctx = engine(loopDef("control.while", { maxIterations: 2, whileCondition: "input.keep" })); try {
      ctx.engine.startRun("r1")
      let step = ctx.engine.enterLoop("r1", "loop", { input: { keep: true } })
      expect(step.iteration).toBe(1)
      ctx.engine.completeNode("r1", "body", {})
      step = ctx.engine.enterLoop("r1", "loop", { input: { keep: false } })
      expect(step.done).toBe(true)
      // guard: a loop whose condition never stops is terminated by maxIterations
      const ctx2 = engine(loopDef("control.while", { maxIterations: 2, whileCondition: "input.keep" })); try {
        ctx2.engine.startRun("r2")
        let s = ctx2.engine.enterLoop("r2", "loop", { input: { keep: true } })
        ctx2.engine.completeNode("r2", "body", {})
        s = ctx2.engine.enterLoop("r2", "loop", { input: { keep: true } })
        expect(s.iteration).toBe(2)
        ctx2.engine.completeNode("r2", "body", {})
        s = ctx2.engine.enterLoop("r2", "loop", { input: { keep: true } })
        expect(s.done).toBe(true)
      } finally { ctx2.engine.close(); rmSync(ctx2.dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }) }
    } finally { ctx.engine.close(); rmSync(ctx.dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }) }
  })
})

describe("GraphRuntimeEngine — control.map / control.child (directives 10+12)", () => {
  const mapDef = () => def(
    [node("scan", "control.map", { input: "input.items", body: "process-{id}", key: { strategy: "field", field: "id" }, maxConcurrency: 4 }), node("process-{id}", "tool.http", {}), node("done", "tool.http", {})],
    [ { from: "scan", to: "process-{id}", kind: "flow" }, { from: "scan", to: "done", kind: "flow" } ],
  )

  test("map: stable element identity, dynamic instance ids, duplicates fail-closed, empty list completes", () => {
    const ctx = engine(mapDef()); try {
      ctx.engine.startRun("r1")
      const out = ctx.engine.fanOutMap("r1", "scan", { input: { items: [ { id: "a" }, { id: "b" } ] } })
      expect(out.elementIds).toEqual(["a", "b"]); expect(out.instanceIds).toEqual(["process-a", "process-b"])
      expect(ctx.engine.nodeState("r1", "process-a")!.status).toBe("PENDING")
      ctx.engine.startRun("r3")
      try { ctx.engine.fanOutMap("r3", "scan", { input: { items: [ { id: "x" }, { id: "x" } ] } }); expect.unreachable() } catch (e) { expect((e as GraphRuntimeError).code).toBe("MAP_DUPLICATE_KEY") }
      ctx.engine.completeNode("r1", "process-a", { ok: 1 })
      // empty collection decision is separately committed (fresh run)
      ctx.engine.startRun("r2")
      const empty = ctx.engine.fanOutMap("r2", "scan", { input: { items: [] } })
      expect(empty.elementIds).toEqual([])
    } finally { ctx.engine.close(); rmSync(ctx.dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }) }
  })

  test("map RESTART: completed elements preserved; re-order does not re-execute", () => {
    const dir = mkdtempSync(join(tmpdir(), "unifia-map-restart-"))
    try {
      const first = new GraphRuntimeEngine({ databasePath: join(dir, "g.sqlite"), definition: mapDef(), now })
      first.initialize(); first.startRun("r1")
      first.fanOutMap("r1", "scan", { input: { items: [ { id: "a" }, { id: "b" } ] } })
      first.completeNode("r1", "process-a", { done: true })
      first.close()
      const second = new GraphRuntimeEngine({ databasePath: join(dir, "g.sqlite"), definition: mapDef(), now })
      second.initialize()
      const again = second.fanOutMap("r1", "scan", { input: { items: [ { id: "b" }, { id: "a" } ] } })
      expect(again.committedNow).toBe(false); expect(again.elementIds).toEqual(["a", "b"])
      expect(second.nodeState("r1", "process-a")!.status).toBe("COMPLETED")
      expect(second.nodeState("r1", "process-b")!.status).toBe("PENDING")
      second.close()
    } finally { rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }) }
  })

  test("child: binding pinned + persisted once; RESTART returns the pinned binding (TOCTOU-proof)", () => {
    const childDef = () => def(
      [node("spawn", "control.child", { deploymentId: "child-dep", version: "v1", awaitCompletion: true }), node("after", "tool.http", {})],
      [ { from: "spawn", to: "after", kind: "flow" } ],
    )
    const dir = mkdtempSync(join(tmpdir(), "unifia-child-"))
    try {
      const first = new GraphRuntimeEngine({ databasePath: join(dir, "g.sqlite"), definition: childDef(), now })
      first.initialize(); first.startRun("r1")
      const out = first.dispatchChild("r1", "spawn")
      expect(out.childDeploymentId).toBe("child-dep"); expect(out.childVersion).toBe("v1"); expect(out.committedNow).toBe(true)
      expect(first.nodeState("r1", "spawn")!.status).toBe("RUNNING")
      const linked = first.inspectEvents("r1").find((e) => e.kind === "CHILD_DISPATCHED")
      expect(linked).toBeDefined()
      first.close()
      const second = new GraphRuntimeEngine({ databasePath: join(dir, "g.sqlite"), definition: childDef(), now })
      second.initialize()
      const again = second.dispatchChild("r1", "spawn")
      expect(again.committedNow).toBe(false); expect(again.childVersion).toBe("v1")
      second.close()
    } finally { rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }) }
  })
})

describe("GraphRuntimeEngine — advance() walk (directives 13-14)", () => {
  const pipelineDef = () => def(
    [node("start", "tool.http", {}), node("gate", "control.if", { condition: "input.go", trueBranch: "yes", falseBranch: "no" }), node("yes", "tool.http", {}), node("no", "tool.http", {}), node("join2", "control.merge", { strategy: "any", branches: ["yes", "no"] }), node("after", "tool.http", {})],
    [ { from: "start", to: "gate", kind: "flow" }, { from: "gate", to: "yes", kind: "branch-true" }, { from: "gate", to: "no", kind: "branch-false" }, { from: "yes", to: "join2", kind: "flow" }, { from: "no", to: "join2", kind: "flow" }, { from: "join2", to: "after", kind: "flow" } ],
  )

  test("walk end-to-end: effects surfaced for dispatch, decisions applied, merge fires, successor scheduled", () => {
    const ctx = engine(pipelineDef()); try {
      ctx.engine.startRun("r1")
      let pass = ctx.engine.advance("r1", { input: { go: true } })
      expect(pass.readyForDispatch).toEqual(["start"]); expect(pass.entered).toEqual([])
      ctx.engine.completeNode("r1", "start", { started: true })
      pass = ctx.engine.advance("r1", { input: { go: true } })
      expect(pass.entered).toEqual(["gate"]); expect(pass.readyForDispatch).toEqual(["yes"])
      expect(ctx.engine.nodeState("r1", "no")!.status).toBe("SKIPPED")
      ctx.engine.completeNode("r1", "yes", { done: true })
      pass = ctx.engine.advance("r1", { input: { go: true } })
      // the merge fires and the successor is surfaced in the SAME pass (single-pass convergence)
      expect(pass.entered).toContain("join2")
      expect(pass.readyForDispatch).toEqual(["after"])
    } finally { ctx.engine.close(); rmSync(ctx.dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }) }
  })

  test("RESTART mid-pipeline: the walk resumes from durable facts (no duplicate decisions/events)", () => {
    const dir = mkdtempSync(join(tmpdir(), "unifia-walk-restart-"))
    try {
      const first = new GraphRuntimeEngine({ databasePath: join(dir, "g.sqlite"), definition: pipelineDef(), now })
      first.initialize(); first.startRun("r1")
      first.advance("r1", { input: { go: true } })
      first.completeNode("r1", "start", { started: true })
      first.advance("r1", { input: { go: true } })
      first.close()
      const second = new GraphRuntimeEngine({ databasePath: join(dir, "g.sqlite"), definition: pipelineDef(), now })
      second.initialize()
      // pre-restart walk already surfaced "yes" (same-pass convergence); the
      // restart resumes from durable facts: complete it and the merge fires.
      const pass = second.advance("r1", { input: { go: true } })
      expect(pass.readyForDispatch).toEqual([])
      second.completeNode("r1", "yes", { done: true })
      const pass2 = second.advance("r1", { input: { go: true } })
      expect(pass2.entered).toContain("join2"); expect(pass2.readyForDispatch).toEqual(["after"])
      const events = second.inspectEvents("r1").map((e) => e.kind)
      expect(events.filter((k) => k === "DECIDED_IF")).toHaveLength(1)
      second.close()
    } finally { rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }) }
  })
})

describe("GraphRuntimeEngine — cancellation + timeout (directives 19-20)", () => {
  const pipeDef = () => def(
    [node("start", "tool.http", {}), node("after", "tool.http", {})],
    [ { from: "start", to: "after", kind: "flow" } ],
  )

  test("cancel before dispatch: PENDING skipped, durable intent persisted, stale completion fenced", () => {
    const ctx = engine(pipeDef()); try {
      ctx.engine.startRun("r1")
      // cancel BEFORE any dispatch (start is still PENDING)
      ctx.engine.requestCancel("r1", "owner request")
      expect(ctx.engine.isCancelRequested("r1")).toBe(true)
      expect(ctx.engine.nodeState("r1", "start")!.status).toBe("SKIPPED")
      try { ctx.engine.completeNode("r1", "start", { late: true }); expect.unreachable() } catch (e) { expect((e as GraphRuntimeError).code).toBe("NODE_ALREADY_TERMINAL") }
      // restart: the durable intent survives
      const dir = ctx.dir
      ctx.engine.close()
      const second = new GraphRuntimeEngine({ databasePath: join(dir, "g.sqlite"), definition: pipeDef(), now })
      second.initialize()
      expect(second.isCancelRequested("r1")).toBe(true)
      second.close()
    } finally { rmSync(ctx.dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }) }
  })

  test("cancel during attempt: RUNNING node keeps working; worker observes and fails; timeout race: one terminal wins", () => {
    const ctx = engine(pipeDef()); try {
      ctx.engine.startRun("r1"); ctx.engine.advance("r1", {})
      ctx.engine.requestCancel("r1", "during attempt")
      expect(ctx.engine.nodeState("r1", "start")!.status).toBe("RUNNING")
      // the worker observes the durable flag and reacts (fail = cancelled shape)
      ctx.engine.failNode("r1", "start", "cancelled by worker")
      expect(ctx.engine.nodeState("r1", "start")!.status).toBe("FAILED")
      try { ctx.engine.completeNode("r1", "start", { late: true }); expect.unreachable() } catch (e) { expect((e as GraphRuntimeError).code).toBe("NODE_ALREADY_TERMINAL") }
      // timeout race: completion first wins; expiry of a RUNNING node later
      ctx.engine.startRun("r2"); ctx.engine.advance("r2", {})
      ctx.engine.setDeadline("r2", "start", 5000)
      ctx.engine.completeNode("r2", "start", { fast: true })
      expect(ctx.engine.expireDue(9000)).toEqual([])
      ctx.engine.startRun("r3"); ctx.engine.advance("r3", {})
      ctx.engine.setDeadline("r3", "start", 5000)
      const expired = ctx.engine.expireDue(9000)
      expect(expired).toEqual([ { runId: "r3", nodeId: "start" } ])
      try { ctx.engine.completeNode("r3", "start", { late: true }); expect.unreachable() } catch (e) { expect((e as GraphRuntimeError).code).toBe("NODE_ALREADY_TERMINAL") }
    } finally { ctx.engine.close(); rmSync(ctx.dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }) }
  })
})
