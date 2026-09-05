/* SPDX-License-Identifier: MIT */
/* Copyright (c) 2026 Unifia contributors */

/**
 * GraphRuntimeEngine — durable graph executor on the ratified
 * UNIFIA_NATIVE substrate (M2 RUNTIME, owner directive 6).
 *
 * Consumes the CANONICAL contracts (one semantics authority, no
 * reimplementation): WorkflowDefinition + validateWorkflowGraph
 * (workflow-graph), parseControl*Config (workflow-ir) and the
 * canonical condition evaluator @unifia/expression-runtime.
 * Only validated immutable definitions are executed — arbitrary
 * graph JSON is never accepted.
 *
 * Node execution state is durable (facts are rows): decisions
 * commit in ONE SQLite transaction together with the branch
 * journal, so restart never re-evaluates an already-committed
 * decision (directive 6) and a crash before commit leaves no
 * decision at all (directive 13).
 */
import type { Edge, Node, WorkflowDefinition } from "@unifia/contracts"
import { parseControlIfConfig, parseControlSwitchConfig, WorkflowDefinitionSchema } from "@unifia/contracts"
import { validateWorkflowGraph } from "@unifia/contracts"
import { evaluate } from "@unifia/expression-runtime"
import type { Database } from "bun:sqlite"

export type GraphNodeStatus = "PENDING" | "RUNNING" | "COMPLETED" | "FAILED" | "SKIPPED"

export class GraphRuntimeError extends Error {
  constructor(readonly code: string, message: string) { super(message); this.name = "GraphRuntimeError" }
}

export interface GraphRuntimeOptions {
  readonly databasePath: string
  readonly definition: WorkflowDefinition
  readonly now?: () => number
}

export interface GraphNodeState {
  readonly runId: string
  readonly nodeId: string
  readonly status: GraphNodeStatus
  readonly decisionJson: string | null
  readonly outputJson: string | null
  readonly updatedAt: number
}

const SCHEMA_V1 = `
CREATE TABLE IF NOT EXISTS graph_nodes (
  run_id TEXT NOT NULL,
  node_id TEXT NOT NULL,
  status TEXT NOT NULL,
  decision_json TEXT,
  output_json TEXT,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (run_id, node_id)
);
CREATE TABLE IF NOT EXISTS graph_events (
  run_id TEXT NOT NULL,
  seq INTEGER NOT NULL,
  node_id TEXT,
  kind TEXT NOT NULL,
  detail_json TEXT,
  occurred_at INTEGER NOT NULL,
  PRIMARY KEY (run_id, seq)
);
`

export class GraphRuntimeEngine {
  private db: Database | null = null
  private readonly nodes: ReadonlyMap<string, Node>
  private readonly outEdges: ReadonlyMap<string, Edge[]>
  private readonly inEdges: ReadonlyMap<string, Edge[]>
  private readonly options: GraphRuntimeOptions

  constructor(options: GraphRuntimeOptions) {
    const parsed = WorkflowDefinitionSchema.parse(options.definition)
    const validation = validateWorkflowGraph(parsed)
    if (!validation.ok) {
      throw new GraphRuntimeError("GRAPH_INVALID", validation.errors.map((e) => `${e.code}: ${e.message}`).join("; "))
    }
    this.options = { ...options, definition: parsed }
    this.nodes = new Map(parsed.nodes.map((node) => [node.id, node]))
    this.outEdges = indexBy(parsed.edges, (edge) => edge.from)
    this.inEdges = indexBy(parsed.edges, (edge) => edge.to)
  }

  initialize(): void {
    const { Database } = require("bun:sqlite") as { Database: new (path: string) => Database }
    this.db = new Database(this.options.databasePath)
    this.db.exec("PRAGMA journal_mode = WAL")
    this.db.exec("PRAGMA synchronous = FULL")
    this.db.exec(SCHEMA_V1)
  }

  close(): void {
    if (this.db) {
      try { this.db.exec("PRAGMA wal_checkpoint(TRUNCATE)") } catch { /* best-effort release before close */ }
      this.db.close()
      this.db = null
    }
  }

  private now(): number { return this.options.now?.() ?? Date.now() }

  private requireDb(): Database {
    if (!this.db) throw new GraphRuntimeError("ENGINE_NOT_INITIALIZED", "call initialize() first")
    return this.db
  }

  /** Seeds the entry node(s) PENDING. Restart-safe (idempotent). */
  startRun(runId: string): void {
    const db = this.requireDb()
    db.transaction(() => {
      const existing = db.query("SELECT node_id FROM graph_nodes WHERE run_id = ?").get(runId)
      if (existing) return
      for (const nodeId of this.entryNodeIds()) {
        db.query("INSERT INTO graph_nodes (run_id, node_id, status, decision_json, output_json, updated_at) VALUES (?, ?, ?, NULL, NULL, ?)")
          .run(runId, nodeId, "PENDING", this.now())
        this.journal(db, runId, nodeId, "NODE_ENTERED", null)
      }
    })()
  }

  private entryNodeIds(): string[] {
    return [...this.nodes.values()].filter((node) => (this.inEdges.get(node.id) ?? []).every((edge) => edge.kind === "on-failure")).map((node) => node.id)
  }

  /** Restart-stable decision: an existing decision is returned UNCHANGED (never re-evaluated). */
  private committedDecision<T>(db: Database, runId: string, nodeId: string, compute: () => T): { decision: T; committedNow: boolean } {
    const row = db.query("SELECT decision_json FROM graph_nodes WHERE run_id = ? AND node_id = ?").get(runId, nodeId) as { decision_json: string | null } | null
    if (!row) throw new GraphRuntimeError("NODE_NOT_STARTED", nodeId)
    if (row.decision_json !== null) return { decision: JSON.parse(row.decision_json) as T, committedNow: false }
    const decision = compute()
    db.query("UPDATE graph_nodes SET decision_json = ?, status = ?, updated_at = ? WHERE run_id = ? AND node_id = ?")
      .run(JSON.stringify(decision), "COMPLETED", this.now(), runId, nodeId)
    return { decision, committedNow: true }
  }

  /**
   * control.if (directive 6): the condition is evaluated by the
   * canonical expression system; exactly ONE branch becomes
   * executable, the other is SKIPPED (no side effects); the decision
   * commits atomically with the branch journal.
   */
  decideIf(runId: string, nodeId: string, env: Record<string, unknown>): { result: boolean; takenNodeId: string; skippedNodeId: string; committedNow: boolean } {
    const node = this.requireNode(nodeId, "control.if")
    const config = parseControlIfConfig(node.config)
    const db = this.requireDb()
    let outcome!: { result: boolean; takenNodeId: string; skippedNodeId: string; committedNow: boolean }
    db.transaction(() => {
      const result = this.committedDecision<{ result: boolean; takenNodeId: string; skippedNodeId: string }>(db, runId, nodeId, () => {
        const value = evaluate(config.condition, env)
        if (typeof value !== "boolean") throw new GraphRuntimeError("EXPR_NOT_BOOLEAN", `control.if condition did not evaluate to a boolean: ${nodeId}`)
        const branchEdges = (this.outEdges.get(nodeId) ?? []).filter((edge) => edge.kind === (value ? "branch-true" : "branch-false"))
        const taken = this.branchTarget(nodeId, branchEdges, config.trueBranch, config.falseBranch, value)
        const skippedEdge = (this.outEdges.get(nodeId) ?? []).find((edge) => edge.kind === (value ? "branch-false" : "branch-true"))
        const skipped = skippedEdge?.to ?? (value ? config.falseBranch : config.trueBranch) ?? null
        if (!taken) throw new GraphRuntimeError("BRANCH_UNRESOLVED", `control.if has no ${value ? "true" : "false"} branch target: ${nodeId}`)
        return { result: value, takenNodeId: taken, skippedNodeId: skipped ?? "" }
      })
      if (result.committedNow) {
        this.journal(db, runId, nodeId, "DECIDED_IF", result.decision)
        if (result.decision.skippedNodeId) {
          this.setStatus(db, runId, result.decision.skippedNodeId, "SKIPPED")
          this.journal(db, runId, result.decision.skippedNodeId, "BRANCH_SKIPPED", { by: nodeId })
        }
        this.setStatus(db, runId, result.decision.takenNodeId, "PENDING")
        this.journal(db, runId, result.decision.takenNodeId, "BRANCH_TAKEN", { by: nodeId })
      }
      outcome = { ...result.decision, committedNow: result.committedNow }
    })()
    return outcome
  }

  private branchTarget(nodeId: string, edges: Edge[], trueBranch: string | null | undefined, falseBranch: string | null | undefined, value: boolean): string | null {
    if (edges.length === 1) return edges[0]!.to
    if (edges.length > 1) throw new GraphRuntimeError("BRANCH_AMBIGUOUS", `multiple ${value ? "branch-true" : "branch-false"} edges on ${nodeId}`)
    const hard = value ? trueBranch : falseBranch
    if (hard) {
      if (!this.nodes.has(hard)) throw new GraphRuntimeError("BRANCH_TARGET_UNKNOWN", `${nodeId} branch target not in definition: ${hard}`)
      return hard
    }
    return null
  }

  /**
   * control.switch (directive 7): exact case resolution, optional
   * default; decision is committed once — restart keeps it.
   */
  decideSwitch(runId: string, nodeId: string, env: Record<string, unknown>): { caseValue: string | null; takenNodeId: string; skippedNodeIds: string[]; committedNow: boolean } {
    const node = this.requireNode(nodeId, "control.switch")
    const config = parseControlSwitchConfig(node.config)
    const db = this.requireDb()
    let outcome!: { caseValue: string | null; takenNodeId: string; skippedNodeIds: string[]; committedNow: boolean }
    db.transaction(() => {
      const result = this.committedDecision<{ caseValue: string | null; takenNodeId: string; skippedNodeIds: string[] }>(db, runId, nodeId, () => {
        const raw = evaluate(config.discriminator, env)
        const key = String(raw)
        const allTargets = [...new Set([...config.cases.map((k) => k.target), ...(config.default ? [config.default] : [])])]
        const matched = config.cases.find((kase) => kase.value === key)
        if (matched) return { caseValue: matched.value, takenNodeId: matched.target, skippedNodeIds: allTargets.filter((id) => id !== matched.target) }
        if (config.default) return { caseValue: null, takenNodeId: config.default, skippedNodeIds: allTargets }
        throw new GraphRuntimeError("SWITCH_NO_MATCH", `control.switch has no case for ${JSON.stringify(key)} and no default: ${nodeId}`)
      })
      if (result.committedNow) {
        this.journal(db, runId, nodeId, "DECIDED_SWITCH", result.decision)
        for (const skipped of result.decision.skippedNodeIds) {
          this.setStatus(db, runId, skipped, "SKIPPED")
          this.journal(db, runId, skipped, "BRANCH_SKIPPED", { by: nodeId })
        }
        this.setStatus(db, runId, result.decision.takenNodeId, "PENDING")
        this.journal(db, runId, result.decision.takenNodeId, "BRANCH_TAKEN", { by: nodeId })
      }
      outcome = { ...result.decision, committedNow: result.committedNow }
    })()
    return outcome
  }

  nodeState(runId: string, nodeId: string): GraphNodeState | null {
    const db = this.requireDb()
    const row = db.query("SELECT run_id, node_id, status, decision_json, output_json, updated_at FROM graph_nodes WHERE run_id = ? AND node_id = ?").get(runId, nodeId) as { run_id: string; node_id: string; status: GraphNodeStatus; decision_json: string | null; output_json: string | null; updated_at: number } | null
    if (!row) return null
    return { runId: row.run_id, nodeId: row.node_id, status: row.status, decisionJson: row.decision_json, outputJson: row.output_json, updatedAt: row.updated_at }
  }

  inspectEvents(runId: string): readonly { seq: number; nodeId: string | null; kind: string; detailJson: string | null; occurredAt: number }[] {
    const db = this.requireDb()
    const rows = db.query("SELECT seq, node_id, kind, detail_json, occurred_at FROM graph_events WHERE run_id = ? ORDER BY seq").all(runId) as { seq: number; node_id: string | null; kind: string; detail_json: string | null; occurred_at: number }[]
    return rows.map((row) => ({ seq: row.seq, nodeId: row.node_id, kind: row.kind, detailJson: row.detail_json, occurredAt: row.occurred_at }))
  }

  private setStatus(db: Database, runId: string, nodeId: string, status: GraphNodeStatus): void {
    if (!this.nodes.has(nodeId)) throw new GraphRuntimeError("NODE_UNKNOWN", nodeId)
    const updated = db.query("UPDATE graph_nodes SET status = ?, updated_at = ? WHERE run_id = ? AND node_id = ?").run(status, this.now(), runId, nodeId)
    if (updated.changes === 0) {
      db.query("INSERT INTO graph_nodes (run_id, node_id, status, decision_json, output_json, updated_at) VALUES (?, ?, ?, NULL, NULL, ?)")
        .run(runId, nodeId, status, this.now())
    }
  }

  private journal(db: Database, runId: string, nodeId: string | null, kind: string, detail: unknown): void {
    const seq = db.query("SELECT COALESCE(MAX(seq), 0) + 1 AS seq FROM graph_events WHERE run_id = ?").get(runId) as { seq: number }
    db.query("INSERT INTO graph_events (run_id, seq, node_id, kind, detail_json, occurred_at) VALUES (?, ?, ?, ?, ?, ?)")
      .run(runId, seq.seq, nodeId, kind, detail === null ? null : JSON.stringify(detail), this.now())
  }

  private requireNode(nodeId: string, family: string): Node {
    const node = this.nodes.get(nodeId)
    if (!node) throw new GraphRuntimeError("NODE_UNKNOWN", nodeId)
    if (node.family !== family) throw new GraphRuntimeError("FAMILY_MISMATCH", `node ${nodeId} is ${node.family}, not ${family}`)
    return node
  }
}

function indexBy<T>(items: readonly T[], key: (item: T) => string): Map<string, T[]> {
  const map = new Map<string, T[]>()
  for (const item of items) {
    const list = map.get(key(item)) ?? []
    list.push(item)
    map.set(key(item), list)
  }
  return map
}
