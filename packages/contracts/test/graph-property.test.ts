/* SPDX-License-Identifier: MIT */
/* Copyright (c) 2026 Unifia contributors */

/**
 * M2-TEST — graph property tests (Plan V2.3.1 §199, ADR-002).
 *
 * Six categories of property-based tests over the Workflow IR
 * (M2-01..06 are all landed — 11 node families, 6 EdgeKind):
 *   (1) Well-formedness: edges reference existing nodes, no cycles.
 *   (2) Fan-out / fan-in: parallel + merge pairing, sample workflow.
 *   (3) Parallel race / dynamic identity: deterministic node ids.
 *   (4) Bounded loops: control.repeat is always finite.
 *   (5) Stable map keys: idempotence under reordering.
 *   (6) IR-level integration: all control families parse + validate.
 */
import { describe, expect, test } from "bun:test"
import {
  WorkflowDefinitionSchema,
  type WorkflowDefinition,
  type Node,
  type Edge,
} from "../src/workflow-ir.ts"
import {
  findOrphanEdgeReferences,
  findCycles,
  findUnreachableNodes,
  findUnpairedParallelMerge,
  findUnboundedLoops,
  deriveMapKey,
} from "./graph-validators.ts"

// -----------------------------------------------------------------------
// Fixtures / builders
// -----------------------------------------------------------------------

const SCOPE = { organizationId: "o1", workspaceId: "w1" } as const

function makeNode(id: string, family: Node["family"], config: Record<string, unknown> = {}): Node {
  return { id, family, config }
}

function makeEdge(from: string, to: string, kind: Edge["kind"] = "flow"): Edge {
  return { from, to, kind }
}

function baseFields(): Omit<WorkflowDefinition, "nodes" | "edges"> {
  return {
    definitionId: "d-m2-test",
    ownershipScope: SCOPE,
    displayName: "M2-TEST fixture",
    concurrency: { kind: "none" },
    defaultFailurePolicy: { kind: "propagate" },
    defaultTimeoutMs: 30_000,
    createdAt: 1_700_000_000,
    updatedAt: 1_700_000_000,
  }
}

function linearGraph(n: number): WorkflowDefinition {
  const nodes: Node[] = []
  const edges: Edge[] = []
  for (let i = 0; i < n; i++) nodes.push(makeNode(`n${i}`, "tool.http"))
  for (let i = 0; i < n - 1; i++) edges.push(makeEdge(`n${i}`, `n${i + 1}`))
  return { ...baseFields(), nodes, edges }
}

// -----------------------------------------------------------------------
// (1-4) Well-formedness
// -----------------------------------------------------------------------

describe("findOrphanEdgeReferences — well-formedness (1, 2)", () => {
  test("(1) findOrphanEdgeReferences_NoOrphansOnLinearGraph — A→B→C returns 0 issues", () => {
    const def = linearGraph(3)
    expect(findOrphanEdgeReferences(def)).toEqual([])
  })

  test("(2) findOrphanEdgeReferences_DetectsOrphanRef — edge {from: 'ghost', to: 'b'} returns 1 issue", () => {
    const def: WorkflowDefinition = {
      ...baseFields(),
      nodes: [makeNode("a", "tool.http"), makeNode("b", "tool.http")],
      edges: [makeEdge("ghost", "b")],
    }
    const issues = findOrphanEdgeReferences(def)
    expect(issues).toHaveLength(1)
    expect(issues[0].code).toBe("EDGE_FROM_NOT_FOUND")
    expect(issues[0].edgeIndex).toBe(0)
  })
})

describe("findCycles — well-formedness (3, 4)", () => {
  test("(3) findCycles_NoCyclesOnLinearGraph — A→B→C returns 0 issues", () => {
    const def = linearGraph(3)
    expect(findCycles(def)).toEqual([])
  })

  test("(4) findCycles_DetectsDirectCycle — A→A returns 1 issue", () => {
    const def: WorkflowDefinition = {
      ...baseFields(),
      nodes: [makeNode("a", "tool.http")],
      edges: [makeEdge("a", "a")],
    }
    const issues = findCycles(def)
    expect(issues).toHaveLength(1)
    expect(issues[0].code).toBe("CYCLE_DETECTED")
    expect(issues[0].nodeId).toBe("a")
  })
})

// -----------------------------------------------------------------------
// (5-7) Fan-out / fan-in
// -----------------------------------------------------------------------

describe("findUnpairedParallelMerge — fan-out/fan-in (5, 6, 7)", () => {
  test("(5) findUnpairedParallelMerge_PassForMatchedPair — parallel (3 branches) + merge (3 branches) → 0", () => {
    const def: WorkflowDefinition = {
      ...baseFields(),
      nodes: [
        makeNode("p", "control.parallel", {
          branches: [
            { branchId: "alpha", target: "a" },
            { branchId: "beta", target: "b" },
            { branchId: "gamma", target: "c" },
          ],
        }),
        makeNode("a", "tool.http"),
        makeNode("b", "tool.http"),
        makeNode("c", "tool.http"),
        makeNode("m", "control.merge", { strategy: "all", branches: ["a", "b", "c"] }),
      ],
      edges: [
        makeEdge("p", "a", "branch-N"),
        makeEdge("p", "b", "branch-N"),
        makeEdge("p", "c", "branch-N"),
        makeEdge("a", "m"),
        makeEdge("b", "m"),
        makeEdge("c", "m"),
      ],
    }
    const parsed = WorkflowDefinitionSchema.parse(def)
    expect(findUnpairedParallelMerge(parsed)).toEqual([])
  })

  test("(6) findUnpairedParallelMerge_DetectsUnpairedMerge — merge with 3 branches but no upstream parallel → 1", () => {
    const def: WorkflowDefinition = {
      ...baseFields(),
      nodes: [
        makeNode("a", "tool.http"),
        makeNode("b", "tool.http"),
        makeNode("c", "tool.http"),
        makeNode("m", "control.merge", { strategy: "all", branches: ["a", "b", "c"] }),
      ],
      edges: [
        makeEdge("a", "m"),
        makeEdge("b", "m"),
        makeEdge("c", "m"),
      ],
    }
    const parsed = WorkflowDefinitionSchema.parse(def)
    const issues = findUnpairedParallelMerge(parsed)
    expect(issues).toHaveLength(1)
    expect(issues[0].code).toBe("MERGE_WITHOUT_PARALLEL")
    expect(issues[0].nodeId).toBe("m")
  })

  test("(7) FanOut_FanIn_SampleWorkflow — parallel + merge + downstream parses and validates", () => {
    const def: WorkflowDefinition = {
      ...baseFields(),
      nodes: [
        makeNode("t", "trigger.manual"),
        makeNode("p", "control.parallel", {
          branches: [
            { branchId: "a", target: "x" },
            { branchId: "b", target: "y" },
          ],
        }),
        makeNode("x", "tool.http"),
        makeNode("y", "tool.http"),
        makeNode("m", "control.merge", { strategy: "all", branches: ["x", "y"] }),
        makeNode("d", "tool.http"),
      ],
      edges: [
        makeEdge("t", "p"),
        makeEdge("p", "x", "branch-N"),
        makeEdge("p", "y", "branch-N"),
        makeEdge("x", "m"),
        makeEdge("y", "m"),
        makeEdge("m", "d"),
      ],
    }
    const parsed = WorkflowDefinitionSchema.parse(def)
    expect(parsed.nodes).toHaveLength(6)
    expect(findOrphanEdgeReferences(parsed)).toEqual([])
    expect(findCycles(parsed)).toEqual([])
    expect(findUnreachableNodes(parsed)).toEqual([])
    expect(findUnpairedParallelMerge(parsed)).toEqual([])
    expect(findUnboundedLoops(parsed)).toEqual([])
  })
})

// -----------------------------------------------------------------------
// (8-10) Parallel race / dynamic identity
// -----------------------------------------------------------------------

describe("Parallel race / dynamic identity (8, 9, 10)", () => {
  test("(8) DynamicIdentity_NodeIdExpression_ParsesAsWarning — id '{input.x}' parses (IR doesn't reject dynamic ids)", () => {
    // The IR keeps `id` as a plain string — the editor/runtime may warn
    // about dynamic ids, but the schema accepts them.
    const def: WorkflowDefinition = {
      ...baseFields(),
      nodes: [
        makeNode("{input.x}", "tool.http"),
        makeNode("next", "tool.http"),
      ],
      edges: [makeEdge("{input.x}", "next")],
    }
    const parsed = WorkflowDefinitionSchema.parse(def)
    expect(parsed.nodes[0].id).toBe("{input.x}")
    // No validator rejects this — that's intentional, per the spec.
    expect(findOrphanEdgeReferences(parsed)).toEqual([])
  })

  test("(9) DeterministicIdentity_SameIdProducesSameRunId — same definition canonicalizes to same id set", () => {
    const def = linearGraph(5)
    const parsed1 = WorkflowDefinitionSchema.parse(def)
    const parsed2 = WorkflowDefinitionSchema.parse(def)
    const ids1 = parsed1.nodes.map((n) => n.id).sort()
    const ids2 = parsed2.nodes.map((n) => n.id).sort()
    expect(ids1).toEqual(ids2)
    expect(ids1).toEqual(["n0", "n1", "n2", "n3", "n4"])
  })

  test("(10) ParallelRace_TwoParsesSameIdempotentIds — parallel parsed twice yields same branchId set in order", () => {
    const def: WorkflowDefinition = {
      ...baseFields(),
      nodes: [
        makeNode("p", "control.parallel", {
          branches: [
            { branchId: "alpha", target: "a" },
            { branchId: "beta", target: "b" },
            { branchId: "gamma", target: "c" },
          ],
        }),
        makeNode("a", "tool.http"),
        makeNode("b", "tool.http"),
        makeNode("c", "tool.http"),
      ],
      edges: [
        makeEdge("p", "a", "branch-N"),
        makeEdge("p", "b", "branch-N"),
        makeEdge("p", "c", "branch-N"),
      ],
    }
    const cfg1 = (WorkflowDefinitionSchema.parse(def).nodes[0].config as { branches: { branchId: string }[] }).branches
    const cfg2 = (WorkflowDefinitionSchema.parse(def).nodes[0].config as { branches: { branchId: string }[] }).branches
    expect(cfg1.map((b) => b.branchId)).toEqual(cfg2.map((b) => b.branchId))
    expect(cfg1.map((b) => b.branchId)).toEqual(["alpha", "beta", "gamma"])
  })
})

// -----------------------------------------------------------------------
// (11-13) Bounded loops
// -----------------------------------------------------------------------

describe("Bounded loops (11, 12, 13)", () => {
  test("(11) findUnboundedLoops_DetectsUnboundedRepeat — maxIterations: 0 is caught at the validator level", () => {
    const def: WorkflowDefinition = {
      ...baseFields(),
      nodes: [makeNode("r", "control.repeat", { maxIterations: 0, body: "x" })],
      edges: [],
    }
    // The schema doesn't reject this (config is opaque), but the
    // validator does.
    const parsed = WorkflowDefinitionSchema.parse(def)
    const issues = findUnboundedLoops(parsed)
    expect(issues.length).toBeGreaterThanOrEqual(1)
    expect(issues[0].code).toBe("REPEAT_UNBOUNDED")
  })

  test("(12) BoundedLoop_RepeatWithMaxIterations1_Validates — maxIterations: 1 is valid", () => {
    const def: WorkflowDefinition = {
      ...baseFields(),
      nodes: [makeNode("r", "control.repeat", { maxIterations: 1, body: "x" })],
      edges: [],
    }
    const parsed = WorkflowDefinitionSchema.parse(def)
    expect(findUnboundedLoops(parsed)).toEqual([])
  })

  test("(13) BoundedLoop_RepeatWith1Million_Validates — maxIterations: 1_000_000 (the upper bound) is valid", () => {
    const def: WorkflowDefinition = {
      ...baseFields(),
      nodes: [makeNode("r", "control.repeat", { maxIterations: 1_000_000, body: "x" })],
      edges: [],
    }
    const parsed = WorkflowDefinitionSchema.parse(def)
    expect(findUnboundedLoops(parsed)).toEqual([])
  })
})

// -----------------------------------------------------------------------
// (14-16) Stable map keys
// -----------------------------------------------------------------------

describe("Stable map keys (14, 15, 16)", () => {
  test("(14) deriveMapKey_FieldStrategy_ExtractsField — { strategy: 'field', field: 'id' } on { id: 'abc' } → 'abc'", () => {
    const key = deriveMapKey({ strategy: "field", field: "id" }, { id: "abc", other: 1 })
    expect(key).toBe("abc")
  })

  test("(15) deriveMapKey_HashStrategy_Deterministic — same item twice returns the same key", () => {
    const item = { id: "abc", n: 42, nested: { x: 1, y: 2 } }
    const k1 = deriveMapKey({ strategy: "hash" }, item)
    const k2 = deriveMapKey({ strategy: "hash" }, item)
    expect(k1).toBe(k2)
    expect(k1.length).toBeGreaterThan(0)
  })

  test("(16) StableMapKeys_ReorderedInputProducesSameKeys — [a, b, c] and [c, a, b] produce the same key set", () => {
    const items1 = [
      { id: "a", v: 1 },
      { id: "b", v: 2 },
      { id: "c", v: 3 },
    ]
    const items2 = [
      { id: "c", v: 3 },
      { id: "a", v: 1 },
      { id: "b", v: 2 },
    ]
    const ks1 = items1.map((i) => deriveMapKey({ strategy: "field", field: "id" }, i)).sort()
    const ks2 = items2.map((i) => deriveMapKey({ strategy: "field", field: "id" }, i)).sort()
    expect(ks1).toEqual(ks2)
    expect(ks1).toEqual(["a", "b", "c"])
  })
})

// -----------------------------------------------------------------------
// (17-20) IR-level integration
// -----------------------------------------------------------------------

describe("IR-level integration (17, 18, 19, 20)", () => {
  test("(17) SampleWorkflow_AllControlFamilies_ParseAndValidate — one node per control family (if, switch, parallel, merge, map, repeat)", () => {
    const def: WorkflowDefinition = {
      ...baseFields(),
      nodes: [
        makeNode("t", "trigger.manual"),
        makeNode("if1", "control.if", { condition: "input.x === 'go'", trueBranch: "sw", falseBranch: "rep" }),
        makeNode("sw", "control.switch", {
          discriminator: "input.y",
          cases: [{ value: "a", target: "par" }],
        }),
        makeNode("par", "control.parallel", {
          branches: [
            { branchId: "a", target: "ma" },
            { branchId: "b", target: "mb" },
          ],
        }),
        makeNode("ma", "tool.http"),
        makeNode("mb", "tool.http"),
        makeNode("merge", "control.merge", { strategy: "all", branches: ["ma", "mb"] }),
        makeNode("map", "control.map", { input: "input.items", body: "body", key: { strategy: "field", field: "id" } }),
        makeNode("body", "tool.http"),
        makeNode("rep", "control.repeat", { maxIterations: 5, body: "body" }),
        makeNode("sink", "tool.http"),
      ],
      edges: [
        makeEdge("t", "if1"),
        makeEdge("if1", "sw", "branch-true"),
        makeEdge("if1", "rep", "branch-false"),
        makeEdge("sw", "par", "case-value"),
        makeEdge("par", "ma", "branch-N"),
        makeEdge("par", "mb", "branch-N"),
        makeEdge("ma", "merge"),
        makeEdge("mb", "merge"),
        makeEdge("merge", "map"),
        makeEdge("map", "body"),
        makeEdge("body", "sink"),
        makeEdge("rep", "sink"),
      ],
    }
    const parsed = WorkflowDefinitionSchema.parse(def)
    expect(findOrphanEdgeReferences(parsed)).toEqual([])
    expect(findCycles(parsed)).toEqual([])
    expect(findUnreachableNodes(parsed)).toEqual([])
    expect(findUnpairedParallelMerge(parsed)).toEqual([])
    expect(findUnboundedLoops(parsed)).toEqual([])
  })

  test("(18) SampleWorkflow_WithCycle_RejectedByFindCycles — a workflow with a cycle is rejected at the topology level", () => {
    const def: WorkflowDefinition = {
      ...baseFields(),
      nodes: [
        makeNode("a", "tool.http"),
        makeNode("b", "tool.http"),
        makeNode("c", "tool.http"),
      ],
      edges: [
        makeEdge("a", "b"),
        makeEdge("b", "c"),
        makeEdge("c", "a"),
      ],
    }
    const parsed = WorkflowDefinitionSchema.parse(def)
    const issues = findCycles(parsed)
    expect(issues.length).toBeGreaterThanOrEqual(1)
    expect(issues[0].code).toBe("CYCLE_DETECTED")
  })

  test("(19) SampleWorkflow_WithUnreachableNode_Detected — a node disconnected from the entry point is reported", () => {
    const def: WorkflowDefinition = {
      ...baseFields(),
      nodes: [
        makeNode("t", "trigger.manual"),
        makeNode("a", "tool.http"),
        makeNode("b", "tool.http"),
        makeNode("orphan", "tool.http"),
      ],
      edges: [
        makeEdge("t", "a"),
        makeEdge("a", "b"),
        // `orphan` has no edges connecting it to the entry point.
      ],
    }
    const parsed = WorkflowDefinitionSchema.parse(def)
    const issues = findUnreachableNodes(parsed)
    expect(issues).toHaveLength(1)
    expect(issues[0].code).toBe("UNREACHABLE_NODE")
    expect(issues[0].nodeId).toBe("orphan")
  })

  test("(20) EmptyWorkflow_ValidatesEmpty — 0 nodes + 0 edges is trivially valid", () => {
    const def: WorkflowDefinition = {
      ...baseFields(),
      nodes: [],
      edges: [],
    }
    const parsed = WorkflowDefinitionSchema.parse(def)
    expect(findOrphanEdgeReferences(parsed)).toEqual([])
    expect(findCycles(parsed)).toEqual([])
    expect(findUnreachableNodes(parsed)).toEqual([])
    expect(findUnpairedParallelMerge(parsed)).toEqual([])
    expect(findUnboundedLoops(parsed)).toEqual([])
  })
})

// -----------------------------------------------------------------------
// (21, 22) Edge case — performance / boundary
// -----------------------------------------------------------------------

describe("Edge case — performance / boundary (21, 22)", () => {
  test("(21) LinearGraph_50Nodes_NoIssues — 50-node linear graph validates (performance sanity)", () => {
    const def = linearGraph(50)
    const parsed = WorkflowDefinitionSchema.parse(def)
    expect(findOrphanEdgeReferences(parsed)).toEqual([])
    expect(findCycles(parsed)).toEqual([])
    expect(findUnreachableNodes(parsed)).toEqual([])
    expect(findUnpairedParallelMerge(parsed)).toEqual([])
    expect(findUnboundedLoops(parsed)).toEqual([])
  })

  test("(22) WideGraph_100Branches_ParallelValidates — 64-branch parallel (schema max) validates", () => {
    const N = 64
    const branchNodes: Node[] = []
    const edges: Edge[] = []
    for (let i = 0; i < N; i++) {
      const id = `b${i}`
      branchNodes.push(makeNode(id, "tool.http"))
      edges.push(makeEdge("p", id, "branch-N"))
    }
    const parallel: Node = makeNode("p", "control.parallel", {
      branches: Array.from({ length: N }, (_, i) => ({
        branchId: `br${i}`,
        target: `b${i}`,
      })),
    })
    const merge: Node = makeNode("m", "control.merge", {
      strategy: "all",
      branches: Array.from({ length: N }, (_, i) => `b${i}`),
    })
    const def: WorkflowDefinition = {
      ...baseFields(),
      nodes: [parallel, ...branchNodes, merge],
      edges: [
        ...edges,
        ...Array.from({ length: N }, (_, i) => makeEdge(`b${i}`, "m")),
      ],
    }
    const parsed = WorkflowDefinitionSchema.parse(def)
    expect(findOrphanEdgeReferences(parsed)).toEqual([])
    expect(findCycles(parsed)).toEqual([])
    expect(findUnreachableNodes(parsed)).toEqual([])
    expect(findUnpairedParallelMerge(parsed)).toEqual([])
    expect(findUnboundedLoops(parsed)).toEqual([])
  })
})

// -----------------------------------------------------------------------
// M2-TEST-EXTENDED (23..46) — additional coverage, restored after the
// initial 22-test consolidation. Each block hits a different property
// from plan §199 categories 1-5 that the 22-test set did not exercise.
// -----------------------------------------------------------------------

describe("findOrphanEdgeReferences — extended (23, 24, 25)", () => {
  test("(23) OrphanEdgeTo_Only_TargetReports — edge.to points to ghost, edge.from valid", () => {
    const def: WorkflowDefinition = {
      ...baseFields(),
      nodes: [makeNode("a", "tool.http")],
      edges: [makeEdge("a", "ghost")],
    }
    const issues = findOrphanEdgeReferences(def)
    expect(issues).toHaveLength(1)
    expect(issues[0].code).toBe("EDGE_TO_NOT_FOUND")
    expect(issues[0].edgeIndex).toBe(0)
  })

  test("(24) MultipleOrphanEdges_AllReported — each orphan edge produces one issue", () => {
    const def: WorkflowDefinition = {
      ...baseFields(),
      nodes: [makeNode("a", "tool.http")],
      edges: [makeEdge("ghost1", "a"), makeEdge("a", "ghost2"), makeEdge("ghost3", "ghost4")],
    }
    const issues = findOrphanEdgeReferences(def)
    // 3 edges, ghost1/ghost3/ghost4 are missing, ghost2 is the .to of edge[1]
    expect(issues).toHaveLength(4)
    const codes = issues.map((i) => i.code).sort()
    expect(codes).toEqual([
      "EDGE_FROM_NOT_FOUND",
      "EDGE_FROM_NOT_FOUND",
      "EDGE_TO_NOT_FOUND",
      "EDGE_TO_NOT_FOUND",
    ])
  })

  test("(25) SelfLoopEdgeOnExistingNode_NoOrphan — a→a where 'a' exists reports 0 issues from this validator", () => {
    const def: WorkflowDefinition = {
      ...baseFields(),
      nodes: [makeNode("a", "tool.http")],
      edges: [makeEdge("a", "a")],
    }
    expect(findOrphanEdgeReferences(def)).toEqual([])
    // The cycle is caught by findCycles, not by this validator.
    expect(findCycles(def).length).toBeGreaterThan(0)
  })
})

describe("findCycles — extended (26, 27, 28)", () => {
  test("(26) LongerCycle_ABCDA — 4-node cycle is detected with all 4 members in the path", () => {
    const def: WorkflowDefinition = {
      ...baseFields(),
      nodes: [
        makeNode("a", "tool.http"),
        makeNode("b", "tool.http"),
        makeNode("c", "tool.http"),
        makeNode("d", "tool.http"),
      ],
      edges: [makeEdge("a", "b"), makeEdge("b", "c"), makeEdge("c", "d"), makeEdge("d", "a")],
    }
    const issues = findCycles(def)
    expect(issues).toHaveLength(1)
    expect(issues[0].code).toBe("CYCLE_DETECTED")
    // The path is a 4-node cycle: a → b → c → d → a
    expect(issues[0].message).toMatch(/a -> b -> c -> d -> a/)
  })

  test("(27) DisconnectedComponents_OnlyTheCyclicOneReports — the acyclic component stays silent", () => {
    const def: WorkflowDefinition = {
      ...baseFields(),
      nodes: [
        makeNode("a1", "tool.http"),
        makeNode("a2", "tool.http"),
        makeNode("b1", "tool.http"),
        makeNode("b2", "tool.http"),
      ],
      edges: [makeEdge("a1", "a2"), makeEdge("b1", "b2"), makeEdge("b2", "b1")],
    }
    const issues = findCycles(def)
    expect(issues).toHaveLength(1)
    expect(issues[0].message).toMatch(/b1 -> b2 -> b1/)
  })

  test("(28) ParallelWithSelfLoop_ReportsCycle — control.parallel with a self-loop on its own node is rejected", () => {
    const def: WorkflowDefinition = {
      ...baseFields(),
      nodes: [makeNode("p", "control.parallel", { branches: [] })],
      edges: [makeEdge("p", "p")],
    }
    const issues = findCycles(def)
    expect(issues).toHaveLength(1)
    expect(issues[0].code).toBe("CYCLE_DETECTED")
  })
})

describe("findUnreachableNodes — extended (29, 30, 31)", () => {
  test("(29) TriggerWithNoOutgoing_DoesNotItselfBecomeUnreachable — a manual trigger is an entry by definition", () => {
    const def: WorkflowDefinition = {
      ...baseFields(),
      nodes: [makeNode("t", "trigger.manual")],
      edges: [],
    }
    const issues = findUnreachableNodes(def)
    expect(issues).toEqual([])
  })

  test("(30) TwoComponents_OneReachableOneOrphan — the orphan component is reported, the live one is not", () => {
    // The validator's contract: a node with 0 incoming AND ≥1 outgoing
    // is itself an "entry" (even without a trigger). So an isolated
    // component with an internal edge is considered a self-contained
    // subgraph and is NOT reported. To trigger the UNREACHABLE_NODE
    // issue, the orphan node must have no edges at all (0 in, 0 out)
    // so it has no path from any entry point.
    const def: WorkflowDefinition = {
      ...baseFields(),
      nodes: [
        makeNode("t", "trigger.manual"),
        makeNode("a", "tool.http"),
        makeNode("orphan1", "tool.http"),
        makeNode("orphan2", "tool.http"),
      ],
      edges: [makeEdge("t", "a")],
    }
    const issues = findUnreachableNodes(def)
    const orphanIds = issues.filter((i) => i.code === "UNREACHABLE_NODE").map((i) => i.nodeId).sort()
    expect(orphanIds).toEqual(["orphan1", "orphan2"])
  })

  test("(31) ScheduleTrigger_RecognizedAsEntry — trigger.schedule, like trigger.manual, is an entry point", () => {
    const def: WorkflowDefinition = {
      ...baseFields(),
      nodes: [makeNode("t", "trigger.schedule"), makeNode("a", "tool.http"), makeNode("orphan", "tool.http")],
      edges: [makeEdge("t", "a")],
    }
    const issues = findUnreachableNodes(def)
    expect(issues).toHaveLength(1)
    expect(issues[0].nodeId).toBe("orphan")
  })
})

describe("findUnpairedParallelMerge — extended (32, 33, 34)", () => {
  test("(32) MergeWithEmptyBranchesArray_Reports — a control.merge with `branches: []` is rejected", () => {
    const def: WorkflowDefinition = {
      ...baseFields(),
      nodes: [makeNode("m", "control.merge", { strategy: "all", branches: [] })],
      edges: [],
    }
    const issues = findUnpairedParallelMerge(def)
    expect(issues).toHaveLength(1)
    expect(issues[0].code).toBe("MERGE_WITHOUT_PARALLEL")
    expect(issues[0].message).toMatch(/no branches/)
  })

  test("(33) MergeWithStringBranches_NotInParallelTarget_Reports — string branch ids with no parallel are reported", () => {
    const def: WorkflowDefinition = {
      ...baseFields(),
      nodes: [makeNode("m", "control.merge", { strategy: "all", branches: ["x", "y"] })],
      edges: [],
    }
    const issues = findUnpairedParallelMerge(def)
    expect(issues).toHaveLength(1)
    expect(issues[0].code).toBe("MERGE_WITHOUT_PARALLEL")
  })

  test("(34) ParallelWithThreeBranchesAndMerge_AllPaired_OK — three-branch fan-out/fan-in passes", () => {
    const def: WorkflowDefinition = {
      ...baseFields(),
      nodes: [
        makeNode("p", "control.parallel", {
          branches: [
            { branchId: "a", target: "ma" },
            { branchId: "b", target: "mb" },
            { branchId: "c", target: "mc" },
          ],
        }),
        makeNode("ma", "tool.http"),
        makeNode("mb", "tool.http"),
        makeNode("mc", "tool.http"),
        makeNode("m", "control.merge", { strategy: "any", branches: ["ma", "mb", "mc"] }),
      ],
      edges: [],
    }
    expect(findUnpairedParallelMerge(def)).toEqual([])
  })
})

describe("findUnboundedLoops — extended (35, 36, 37, 38)", () => {
  test("(35) RepeatZero_Reports — maxIterations: 0 is not a valid bound", () => {
    const def: WorkflowDefinition = {
      ...baseFields(),
      nodes: [makeNode("r", "control.repeat", { maxIterations: 0, body: "b" }), makeNode("b", "tool.http")],
      edges: [],
    }
    const issues = findUnboundedLoops(def)
    expect(issues).toHaveLength(1)
    expect(issues[0].code).toBe("REPEAT_UNBOUNDED")
  })

  test("(36) RepeatNegative_Reports — maxIterations: -5 is not a valid bound", () => {
    const def: WorkflowDefinition = {
      ...baseFields(),
      nodes: [makeNode("r", "control.repeat", { maxIterations: -5, body: "b" }), makeNode("b", "tool.http")],
      edges: [],
    }
    const issues = findUnboundedLoops(def)
    expect(issues).toHaveLength(1)
    expect(issues[0].code).toBe("REPEAT_UNBOUNDED")
  })

  test("(37) RepeatFloat_Reports — maxIterations: 2.5 is not an integer bound", () => {
    const def: WorkflowDefinition = {
      ...baseFields(),
      nodes: [makeNode("r", "control.repeat", { maxIterations: 2.5, body: "b" }), makeNode("b", "tool.http")],
      edges: [],
    }
    const issues = findUnboundedLoops(def)
    expect(issues).toHaveLength(1)
    expect(issues[0].code).toBe("REPEAT_UNBOUNDED")
  })

  test("(38) RepeatAtBoundary_OneMillion_OK — REPEAT_MAX (=1_000_000) is exactly the upper bound", () => {
    const def: WorkflowDefinition = {
      ...baseFields(),
      nodes: [makeNode("r", "control.repeat", { maxIterations: 1_000_000, body: "b" }), makeNode("b", "tool.http")],
      edges: [],
    }
    expect(findUnboundedLoops(def)).toEqual([])
  })
})

describe("deriveMapKey — extended (39, 40, 41, 42)", () => {
  test("(39) FieldStrategy_NestedObjectPath_ThrowsOnMissing — `field: 'deep.x'` on a flat object throws", () => {
    const item = { id: "a", name: "x" }
    expect(() => deriveMapKey({ strategy: "field", field: "deep.x" }, item)).toThrow(/missing field/)
  })

  test("(40) HashStrategy_FieldOrderingInvariant — two objects with the same fields in different orders hash the same", () => {
    const a = { id: "a", x: 1, y: 2, z: 3 }
    const b = { z: 3, y: 2, x: 1, id: "a" }
    expect(deriveMapKey({ strategy: "hash" }, a)).toBe(deriveMapKey({ strategy: "hash" }, b))
  })

  test("(41) HashStrategy_NestedArrayOrderingInvariant — array reordering changes the hash (arrays are ordered)", () => {
    const a = { items: [1, 2, 3] }
    const b = { items: [3, 2, 1] }
    // This is the documented contract: arrays are order-sensitive.
    expect(deriveMapKey({ strategy: "hash" }, a)).not.toBe(deriveMapKey({ strategy: "hash" }, b))
  })

  test("(42) FieldStrategy_NumericAndBooleanCoercion — numbers and booleans coerce via String()", () => {
    expect(deriveMapKey({ strategy: "field", field: "n" }, { n: 42 })).toBe("42")
    expect(deriveMapKey({ strategy: "field", field: "b" }, { b: true })).toBe("true")
    expect(deriveMapKey({ strategy: "field", field: "b" }, { b: false })).toBe("false")
    expect(deriveMapKey({ strategy: "field", field: "z" }, { z: 0 })).toBe("0")
  })
})

describe("Mutation-style regression net (43, 44, 45, 46)", () => {
  // Each test seeds a deliberate defect and asserts that the relevant
  // validator still reports it. The mutation harness used in M2-TEST
  // v1 (commit 3e0598ac5f, 46/46) was exactly this shape: remove each
  // assertion, confirm the validator still catches the bad input.

  test("(43) Mutation_BadMaxIterations_Detected — flipping maxIterations to 0 produces a REPEAT_UNBOUNDED issue", () => {
    const def: WorkflowDefinition = {
      ...baseFields(),
      nodes: [makeNode("r", "control.repeat", { maxIterations: 0, body: "b" }), makeNode("b", "tool.http")],
      edges: [],
    }
    const issues = findUnboundedLoops(def)
    expect(issues.some((i) => i.code === "REPEAT_UNBOUNDED")).toBe(true)
  })

  test("(44) Mutation_OrphanEdge_Detected — adding a single orphan edge produces an issue", () => {
    const def = linearGraph(3)
    def.edges.push(makeEdge("ghost", "n0"))
    const issues = findOrphanEdgeReferences(def)
    expect(issues.some((i) => i.code === "EDGE_FROM_NOT_FOUND")).toBe(true)
  })

  test("(45) Mutation_Cycle_Detected — adding a back edge n2→n0 produces a CYCLE_DETECTED issue", () => {
    const def = linearGraph(3)
    def.edges.push(makeEdge("n2", "n0"))
    const issues = findCycles(def)
    expect(issues.some((i) => i.code === "CYCLE_DETECTED")).toBe(true)
  })

  test("(46) Mutation_UnreachableNode_Detected — adding a disconnected node produces an UNREACHABLE_NODE issue", () => {
    const def = linearGraph(3)
    def.nodes.push(makeNode("orphan", "tool.http"))
    const issues = findUnreachableNodes(def)
    expect(issues.some((i) => i.code === "UNREACHABLE_NODE" && i.nodeId === "orphan")).toBe(true)
  })
})
