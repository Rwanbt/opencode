/* SPDX-License-Identifier: MIT */
/* Copyright (c) 2026 Unifia contributors */

/**
 * Workflow graph well-formedness (Plan V2.3.1 §199, card M2-TEST, ADR-002).
 *
 * `workflow-ir.ts` validates each node family in isolation: a
 * `control.parallel` config parses, a `control.merge` config parses. What no
 * per-family schema can see is the *graph*: whether the branch targets a
 * switch declares actually exist, whether a parallel's declared fan-out
 * matches the `branch-N` edges drawn out of it, whether the definition has
 * an entry point, or whether it contains a cycle.
 *
 * This module is the graph-level half of the same contract. It is a pure
 * function over a `WorkflowDefinition` — no I/O, no clock, no crypto — so
 * the control plane can run it at the trust boundary before promoting a
 * definition to an immutable `WorkflowVersion`, and an editor can run it on
 * every keystroke.
 *
 * WHY diagnostics instead of throwing: an editor needs every problem in one
 * pass, and a definition that is merely *suspicious* (a merge with no
 * parallel upstream, a node id carrying an expression placeholder) must
 * still be storable. Errors block promotion; warnings do not.
 *
 * Determinism (Plan V2.3.1 §199 "dynamic identity"): the returned
 * diagnostics are sorted by `(code, nodeId, detail)`, so two runs over the
 * same definition — and over any permutation of its `nodes` / `edges`
 * arrays — produce identical output. Graph identity must not depend on
 * authoring order.
 *
 * NOT in scope, deliberately: the physical `runId` / `mapItemId`
 * derivation. Both are content digests, `digest()` lives in
 * `@unifia/digest-runtime`, and that package depends on this one — importing
 * it here would invert the dependency. The pure half this package owns is
 * `extractMapKeyMaterial` in `workflow-map-key.ts`; hashing the material is
 * the digest layer's job (ADR-001, ADR-005).
 */
import {
  ControlIfConfigSchema,
  ControlSwitchConfigSchema,
  ControlParallelConfigSchema,
  ControlMergeConfigSchema,
  ControlMapConfigSchema,
  ControlRepeatConfigSchema,
  CONTROL_REPEAT_MAX_ITERATIONS,
  type Node,
  type NodeFamily,
  type WorkflowDefinition,
} from "./workflow-ir.js"

/* ------------------------------------------------------------------ */
/* Diagnostics                                                         */
/* ------------------------------------------------------------------ */

/**
 * Closed set of graph-level findings. Adding a code is an additive
 * change; removing one is a contract break (callers switch on it).
 */
export const WORKFLOW_GRAPH_DIAGNOSTIC_CODES = [
  // errors
  "duplicate-node-id",
  "edge-unknown-node",
  "no-entry-node",
  "multiple-entry-nodes",
  "cycle-detected",
  "node-config-invalid",
  "target-unknown-node",
  "parallel-fanout-mismatch",
  "merge-fanin-mismatch",
  // warnings
  "multiple-trigger-entry-nodes",
  "unreachable-node",
  "dynamic-node-id",
  "orphan-merge",
  "repeat-iterations-at-ceiling",
] as const

export type WorkflowGraphDiagnosticCode =
  (typeof WORKFLOW_GRAPH_DIAGNOSTIC_CODES)[number]

export interface WorkflowGraphDiagnostic {
  readonly code: WorkflowGraphDiagnosticCode
  readonly severity: "error" | "warning"
  /** Node the finding is anchored to, when there is exactly one. */
  readonly nodeId?: string
  /** Human-readable detail. Stable text — part of the sort key. */
  readonly detail: string
}

export interface WorkflowGraphValidation {
  /** `true` when `errors` is empty. Warnings do not block promotion. */
  readonly ok: boolean
  readonly errors: readonly WorkflowGraphDiagnostic[]
  readonly warnings: readonly WorkflowGraphDiagnostic[]
}

/**
 * A node id that embeds an expression placeholder (`{input.x}`). Parsable,
 * but it defeats static graph analysis: the target of an edge is not known
 * until run time. Warned, never rejected (Plan V2.3.1 §199 "dynamic
 * identity").
 */
export const DYNAMIC_NODE_ID_PATTERN = /\{[^}]*\}/

/* ------------------------------------------------------------------ */
/* Diagnostic sink                                                     */
/* ------------------------------------------------------------------ */

/**
 * Where the checks below record what they find. Passing a sink rather than
 * returning arrays keeps each check a single-purpose function whose reader
 * does not have to track a growing accumulator.
 */
interface DiagnosticSink {
  error(
    code: WorkflowGraphDiagnosticCode,
    detail: string,
    nodeId?: string,
  ): void
  warning(
    code: WorkflowGraphDiagnosticCode,
    detail: string,
    nodeId?: string,
  ): void
}

interface CollectedDiagnostics {
  readonly sink: DiagnosticSink
  readonly errors: WorkflowGraphDiagnostic[]
  readonly warnings: WorkflowGraphDiagnostic[]
}

function createSink(): CollectedDiagnostics {
  const errors: WorkflowGraphDiagnostic[] = []
  const warnings: WorkflowGraphDiagnostic[] = []
  const record = (
    into: WorkflowGraphDiagnostic[],
    severity: "error" | "warning",
    code: WorkflowGraphDiagnosticCode,
    detail: string,
    nodeId?: string,
  ) => {
    into.push(
      nodeId === undefined
        ? { code, severity, detail }
        : { code, severity, nodeId, detail },
    )
  }
  return {
    errors,
    warnings,
    sink: {
      error: (code, detail, nodeId) =>
        record(errors, "error", code, detail, nodeId),
      warning: (code, detail, nodeId) =>
        record(warnings, "warning", code, detail, nodeId),
    },
  }
}

/** Total order over diagnostics so the result never depends on input order. */
function sortDiagnostics(
  diagnostics: WorkflowGraphDiagnostic[],
): WorkflowGraphDiagnostic[] {
  return diagnostics.sort((left, right) => {
    if (left.code !== right.code) return left.code < right.code ? -1 : 1
    const leftNode = left.nodeId ?? ""
    const rightNode = right.nodeId ?? ""
    if (leftNode !== rightNode) return leftNode < rightNode ? -1 : 1
    if (left.detail === right.detail) return 0
    return left.detail < right.detail ? -1 : 1
  })
}

/* ------------------------------------------------------------------ */
/* Graph tables                                                        */
/* ------------------------------------------------------------------ */

const TRIGGER_FAMILIES: ReadonlySet<NodeFamily> = new Set<NodeFamily>([
  "trigger.manual",
  "trigger.schedule",
])

/**
 * The adjacency view every check below reads. Built once so no check has to
 * re-scan the edge list.
 */
interface GraphTables {
  readonly byId: ReadonlyMap<string, Node>
  readonly out: ReadonlyMap<string, readonly string[]>
  readonly inbound: ReadonlyMap<string, readonly string[]>
  readonly outKinds: ReadonlyMap<string, readonly string[]>
}

function indexNodes(
  definition: WorkflowDefinition,
  sink: DiagnosticSink,
): Map<string, Node> {
  const byId = new Map<string, Node>()
  for (const node of definition.nodes) {
    if (byId.has(node.id)) {
      sink.error(
        "duplicate-node-id",
        `node id '${node.id}' is declared more than once`,
        node.id,
      )
      continue
    }
    byId.set(node.id, node)
    if (DYNAMIC_NODE_ID_PATTERN.test(node.id)) {
      sink.warning(
        "dynamic-node-id",
        `node id '${node.id}' embeds an expression placeholder; static graph analysis cannot resolve it`,
        node.id,
      )
    }
  }
  return byId
}

function indexEdges(
  definition: WorkflowDefinition,
  byId: ReadonlyMap<string, Node>,
  sink: DiagnosticSink,
): GraphTables {
  const out = new Map<string, string[]>()
  const inbound = new Map<string, string[]>()
  const outKinds = new Map<string, string[]>()
  for (const id of byId.keys()) {
    out.set(id, [])
    inbound.set(id, [])
    outKinds.set(id, [])
  }
  for (const edge of definition.edges) {
    const label = `edge '${edge.from}' -> '${edge.to}' (${edge.kind})`
    if (!byId.has(edge.from)) {
      sink.error("edge-unknown-node", `${label} starts at an unknown node`)
      continue
    }
    if (!byId.has(edge.to)) {
      sink.error("edge-unknown-node", `${label} ends at an unknown node`)
      continue
    }
    ;(out.get(edge.from) as string[]).push(edge.to)
    ;(outKinds.get(edge.from) as string[]).push(edge.kind)
    ;(inbound.get(edge.to) as string[]).push(edge.from)
  }
  return { byId, out, inbound, outKinds }
}

/* ------------------------------------------------------------------ */
/* Per-family checks                                                   */
/* ------------------------------------------------------------------ */

interface TargetScan {
  readonly targets: readonly string[]
  readonly configRejected: boolean
}

const NO_TARGETS: TargetScan = { targets: [], configRejected: false }
const CONFIG_REJECTED: TargetScan = { targets: [], configRejected: true }

/** Node ids a family's config points at, plus whether the config parses. */
function referencedTargets(
  family: NodeFamily,
  config: Record<string, unknown>,
): TargetScan {
  switch (family) {
    case "control.if": {
      const parsed = ControlIfConfigSchema.safeParse(config)
      if (!parsed.success) return CONFIG_REJECTED
      const targets: string[] = []
      if (parsed.data.trueBranch) targets.push(parsed.data.trueBranch)
      if (parsed.data.falseBranch) targets.push(parsed.data.falseBranch)
      return { targets, configRejected: false }
    }
    case "control.switch": {
      const parsed = ControlSwitchConfigSchema.safeParse(config)
      if (!parsed.success) return CONFIG_REJECTED
      const targets = parsed.data.cases.map((one) => one.target)
      if (parsed.data.default) targets.push(parsed.data.default)
      return { targets, configRejected: false }
    }
    case "control.parallel": {
      const parsed = ControlParallelConfigSchema.safeParse(config)
      if (!parsed.success) return CONFIG_REJECTED
      return {
        targets: parsed.data.branches.map((one) => one.target),
        configRejected: false,
      }
    }
    case "control.merge": {
      const parsed = ControlMergeConfigSchema.safeParse(config)
      if (!parsed.success) return CONFIG_REJECTED
      return { targets: [...parsed.data.branches], configRejected: false }
    }
    case "control.map": {
      const parsed = ControlMapConfigSchema.safeParse(config)
      if (!parsed.success) return CONFIG_REJECTED
      return { targets: [parsed.data.body], configRejected: false }
    }
    case "control.repeat": {
      const parsed = ControlRepeatConfigSchema.safeParse(config)
      if (!parsed.success) return CONFIG_REJECTED
      return { targets: [parsed.data.body], configRejected: false }
    }
    default:
      // Trigger, effector and `wait` families carry no node references in
      // this IR version, so the graph layer has nothing to check on them.
      return NO_TARGETS
  }
}

/** A parallel's declared branch count must match its drawn `branch-N` edges. */
function checkParallelFanOut(
  node: Node,
  tables: GraphTables,
  sink: DiagnosticSink,
): void {
  const config = ControlParallelConfigSchema.parse(node.config)
  const drawn = (tables.outKinds.get(node.id) ?? []).filter(
    (kind) => kind === "branch-N",
  ).length
  if (drawn === config.branches.length) return
  sink.error(
    "parallel-fanout-mismatch",
    `node '${node.id}' declares ${config.branches.length} branch(es) but has ${drawn} 'branch-N' edge(s)`,
    node.id,
  )
}

/**
 * A `merge(all)` waits on every branch, so every branch must actually reach
 * it. `any` and `n-of-m` complete on a subset by design and are exempt.
 */
function checkMergeFanIn(
  node: Node,
  tables: GraphTables,
  sink: DiagnosticSink,
): void {
  const config = ControlMergeConfigSchema.parse(node.config)
  if (config.strategy !== "all") return
  const arriving = (tables.inbound.get(node.id) ?? []).length
  if (arriving === config.branches.length) return
  sink.error(
    "merge-fanin-mismatch",
    `node '${node.id}' joins ${config.branches.length} branch(es) with strategy 'all' but has ${arriving} incoming edge(s)`,
    node.id,
  )
}

function checkRepeatCeiling(node: Node, sink: DiagnosticSink): void {
  const config = ControlRepeatConfigSchema.parse(node.config)
  if (config.maxIterations < CONTROL_REPEAT_MAX_ITERATIONS) return
  sink.warning(
    "repeat-iterations-at-ceiling",
    `node '${node.id}' repeats up to ${config.maxIterations} times, the contract ceiling`,
    node.id,
  )
}

function checkNodeFamilies(tables: GraphTables, sink: DiagnosticSink): void {
  for (const node of tables.byId.values()) {
    const scan = referencedTargets(node.family, node.config)
    if (scan.configRejected) {
      sink.error(
        "node-config-invalid",
        `node '${node.id}' (${node.family}) has a config its family schema rejects`,
        node.id,
      )
      continue
    }
    for (const target of scan.targets) {
      if (tables.byId.has(target)) continue
      sink.error(
        "target-unknown-node",
        `node '${node.id}' (${node.family}) references unknown node '${target}'`,
        node.id,
      )
    }
    if (node.family === "control.parallel") {
      checkParallelFanOut(node, tables, sink)
    } else if (node.family === "control.merge") {
      checkMergeFanIn(node, tables, sink)
    } else if (node.family === "control.repeat") {
      checkRepeatCeiling(node, sink)
    }
  }
}

/* ------------------------------------------------------------------ */
/* Topology checks                                                     */
/* ------------------------------------------------------------------ */

/**
 * Nodes with no incoming edge. A multi-trigger workflow legitimately has
 * several, so a second *trigger* entry is a warning while a second
 * non-trigger entry is an error: two independent starts is an authoring
 * mistake, two triggers is a feature.
 */
function checkEntryPoints(
  tables: GraphTables,
  sink: DiagnosticSink,
): readonly Node[] {
  const entries = [...tables.byId.values()].filter(
    (node) => (tables.inbound.get(node.id) ?? []).length === 0,
  )
  if (tables.byId.size > 0 && entries.length === 0) {
    sink.error(
      "no-entry-node",
      "every node has an incoming edge: the graph has no entry point",
    )
  }
  const nonTrigger = entries.filter(
    (node) => !TRIGGER_FAMILIES.has(node.family),
  )
  if (nonTrigger.length > 1) {
    const named = nonTrigger
      .map((node) => `'${node.id}'`)
      .sort()
      .join(", ")
    sink.error(
      "multiple-entry-nodes",
      `graph has ${nonTrigger.length} non-trigger entry nodes: ${named}`,
    )
  } else if (entries.length > 1) {
    sink.warning(
      "multiple-trigger-entry-nodes",
      `graph has ${entries.length} entry nodes; the runtime starts at the trigger that fired`,
    )
  }
  return entries
}

const WHITE = 0
const GREY = 1
const BLACK = 2

/**
 * Depth-first cycle detection over the edge list. Iterative on purpose: a
 * long linear chain must not depend on the JS stack depth.
 */
function hasCycle(
  ids: readonly string[],
  out: ReadonlyMap<string, readonly string[]>,
): boolean {
  const color = new Map<string, number>(ids.map((id) => [id, WHITE]))
  for (const root of ids) {
    if (color.get(root) !== WHITE) continue
    const stack: Array<{ id: string; enter: boolean }> = [
      { id: root, enter: true },
    ]
    while (stack.length > 0) {
      const frame = stack.pop() as { id: string; enter: boolean }
      if (!frame.enter) {
        color.set(frame.id, BLACK)
        continue
      }
      if (color.get(frame.id) === BLACK) continue
      color.set(frame.id, GREY)
      stack.push({ id: frame.id, enter: false })
      for (const next of out.get(frame.id) ?? []) {
        const seen = color.get(next)
        if (seen === GREY) return true
        if (seen === WHITE) stack.push({ id: next, enter: true })
      }
    }
  }
  return false
}

/**
 * A cycle is a hard error and short-circuits reachability: reporting every
 * node behind the cycle as unreachable would bury the one actionable
 * finding under noise.
 */
function checkCyclesAndReachability(
  tables: GraphTables,
  entries: readonly Node[],
  sink: DiagnosticSink,
): void {
  const ids = [...tables.byId.keys()]
  if (hasCycle(ids, tables.out)) {
    sink.error(
      "cycle-detected",
      "the edge graph contains a cycle; loops are expressed by control.repeat / control.map bodies, never by back-edges",
    )
    return
  }
  const seen = new Set<string>()
  const queue = entries.map((node) => node.id)
  while (queue.length > 0) {
    const id = queue.shift() as string
    if (seen.has(id)) continue
    seen.add(id)
    for (const next of tables.out.get(id) ?? []) queue.push(next)
  }
  for (const id of ids) {
    if (seen.has(id)) continue
    sink.warning(
      "unreachable-node",
      `node '${id}' is not reachable from any entry node`,
      id,
    )
  }
}

/** A merge with no parallel ancestor joins branches nothing ever fans out. */
function checkOrphanMerges(tables: GraphTables, sink: DiagnosticSink): void {
  for (const node of tables.byId.values()) {
    if (node.family !== "control.merge") continue
    const visited = new Set<string>([node.id])
    const queue = [...(tables.inbound.get(node.id) ?? [])]
    let found = false
    while (queue.length > 0 && !found) {
      const id = queue.shift() as string
      if (visited.has(id)) continue
      visited.add(id)
      if (tables.byId.get(id)?.family === "control.parallel") found = true
      else queue.push(...(tables.inbound.get(id) ?? []))
    }
    if (found) continue
    sink.warning(
      "orphan-merge",
      `node '${node.id}' has no control.parallel ancestor; the join waits on branches nothing fans out`,
      node.id,
    )
  }
}

/* ------------------------------------------------------------------ */
/* Entry point                                                         */
/* ------------------------------------------------------------------ */

/**
 * Validate the graph-level invariants of a `WorkflowDefinition`.
 *
 * Errors (block promotion to a `WorkflowVersion`):
 *   duplicate node id · edge referencing an unknown node · no entry node ·
 *   more than one non-trigger entry node · cycle · malformed control config ·
 *   a config target pointing at an unknown node · a parallel fan-out not
 *   matching its `branch-N` edges · a `merge(all)` fan-in not matching its
 *   branch count.
 *
 * Warnings (recorded, never blocking):
 *   several trigger entry nodes · unreachable node · dynamic node id ·
 *   merge with no parallel ancestor · repeat sitting at the iteration
 *   ceiling.
 */
export function validateWorkflowGraph(
  definition: WorkflowDefinition,
): WorkflowGraphValidation {
  const { sink, errors, warnings } = createSink()
  const byId = indexNodes(definition, sink)
  const tables = indexEdges(definition, byId, sink)
  checkNodeFamilies(tables, sink)
  const entries = checkEntryPoints(tables, sink)
  checkCyclesAndReachability(tables, entries, sink)
  checkOrphanMerges(tables, sink)
  return {
    ok: errors.length === 0,
    errors: sortDiagnostics(errors),
    warnings: sortDiagnostics(warnings),
  }
}
