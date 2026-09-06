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
import { DYNAMIC_NODE_ID_PATTERN, parseControlChildConfig, parseControlIfConfig, parseControlMapConfig, parseControlMergeConfig, parseControlParallelConfig, parseControlRepeatConfig, parseControlSwitchConfig, parseControlWhileConfig, WorkflowDefinitionSchema } from "@unifia/contracts"
import { extractMapKeyMaterial } from "@unifia/contracts"
import { validateWorkflowGraph } from "@unifia/contracts"
import { evaluate } from "@unifia/expression-runtime"
import type { Database } from "bun:sqlite"
import { assertAuthorityForRun, claimAuthority, type AuthorityToken, WORKFLOW_AUTHORITY_SCHEMA } from "./authority.ts"

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

const SCHEMA_V1 = `${WORKFLOW_AUTHORITY_SCHEMA}
CREATE TABLE IF NOT EXISTS graph_nodes (
  run_id TEXT NOT NULL,
  node_id TEXT NOT NULL,
  status TEXT NOT NULL,
  deadline_at INTEGER,
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
CREATE TABLE IF NOT EXISTS cancel_requests (
  run_id TEXT PRIMARY KEY,
  reason TEXT,
  requested_at INTEGER NOT NULL
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
      throw new GraphRuntimeError("GRAPH_INVALID", validation.errors.map((e) => String(e.code)).join("; "))
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

  claimAuthority(runId: string, ownerId: string): AuthorityToken {
    return claimAuthority(this.requireDb(), runId, ownerId, this.now())
  }

  /** Seeds the entry node(s) PENDING. Restart-safe (idempotent). */
  startRun(runId: string, token: AuthorityToken): void {
    const db = this.requireDb()
    db.transaction(() => {
      assertAuthorityForRun(db, token, runId)
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
    // Nodes reached as branch targets (merge, successors) may not be seeded
    // by startRun (only entry nodes are); auto-seed is restart-safe.
    let row = db.query("SELECT decision_json FROM graph_nodes WHERE run_id = ? AND node_id = ?").get(runId, nodeId) as { decision_json: string | null } | null
    if (!row) {
      db.query("INSERT INTO graph_nodes (run_id, node_id, status, decision_json, output_json, updated_at) VALUES (?, ?, ?, NULL, NULL, ?)")
        .run(runId, nodeId, "PENDING", this.now())
      row = { decision_json: null }
    }
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
  decideIf(runId: string, token: AuthorityToken, nodeId: string, env: Record<string, unknown>): { result: boolean; takenNodeId: string; skippedNodeId: string; committedNow: boolean } {
    const node = this.requireNode(nodeId, "control.if")
    const config = parseControlIfConfig(node.config)
    const db = this.requireDb()
    let outcome!: { result: boolean; takenNodeId: string; skippedNodeId: string; committedNow: boolean }
    db.transaction(() => {
      assertAuthorityForRun(db, token, runId)
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
  decideSwitch(runId: string, token: AuthorityToken, nodeId: string, env: Record<string, unknown>): { caseValue: string | null; takenNodeId: string; skippedNodeIds: string[]; committedNow: boolean } {
    const node = this.requireNode(nodeId, "control.switch")
    const config = parseControlSwitchConfig(node.config)
    const db = this.requireDb()
    let outcome!: { caseValue: string | null; takenNodeId: string; skippedNodeIds: string[]; committedNow: boolean }
    db.transaction(() => {
      assertAuthorityForRun(db, token, runId)
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

  /**
   * control.parallel (directive 8): fan-out is durable and restart-safe.
   * Branches are execution units under the SAME run authority — no child
   * run, no second authority. Branch targets become PENDING.
   */
  fanOutParallel(runId: string, token: AuthorityToken, nodeId: string): { branchIds: string[]; targets: string[]; committedNow: boolean } {
    const node = this.requireNode(nodeId, "control.parallel")
    const config = parseControlParallelConfig(node.config)
    const db = this.requireDb()
    let outcome!: { branchIds: string[]; targets: string[]; committedNow: boolean }
    db.transaction(() => {
      assertAuthorityForRun(db, token, runId)
      const result = this.committedDecision<{ branchIds: string[]; targets: string[] }>(db, runId, nodeId, () => ({
        branchIds: config.branches.map((branch) => branch.branchId),
        targets: config.branches.map((branch) => {
          if (!this.nodes.has(branch.target)) throw new GraphRuntimeError("BRANCH_TARGET_UNKNOWN", `${nodeId} branch target not in definition: ${branch.target}`)
          return branch.target
        }),
      }))
      if (result.committedNow) {
        this.journal(db, runId, nodeId, "DECIDED_PARALLEL", result.decision)
        for (const target of result.decision.targets) {
          this.setStatus(db, runId, target, "PENDING")
          this.journal(db, runId, target, "BRANCH_TAKEN", { by: nodeId })
        }
      }
      outcome = { ...result.decision, committedNow: result.committedNow }
    })()
    return outcome
  }

  /** Mark a node COMPLETED with its durable output (branch/effect completion). */
  completeNode(runId: string, token: AuthorityToken, nodeId: string, output: unknown): void {
    const db = this.requireDb()
    db.transaction(() => {
      assertAuthorityForRun(db, token, runId)
      const state = this.rawState(db, runId, nodeId)
      if (!state) throw new GraphRuntimeError("NODE_NOT_STARTED", nodeId)
      if (state.status === "COMPLETED" || state.status === "FAILED" || state.status === "SKIPPED") throw new GraphRuntimeError("NODE_ALREADY_TERMINAL", `${nodeId} is ${state.status}`)
      db.query("UPDATE graph_nodes SET status = ?, output_json = ?, updated_at = ? WHERE run_id = ? AND node_id = ?")
        .run("COMPLETED", JSON.stringify(output ?? null), this.now(), runId, nodeId)
      this.journal(db, runId, nodeId, "NODE_COMPLETED", null)
    })()
  }

  /** Mark a node FAILED with a durable reason (branch failure, effect failure). */
  failNode(runId: string, token: AuthorityToken, nodeId: string, reason: string): void {
    const db = this.requireDb()
    db.transaction(() => {
      assertAuthorityForRun(db, token, runId)
      const state = this.rawState(db, runId, nodeId)
      if (!state) throw new GraphRuntimeError("NODE_NOT_STARTED", nodeId)
      if (state.status === "COMPLETED" || state.status === "FAILED" || state.status === "SKIPPED") throw new GraphRuntimeError("NODE_ALREADY_TERMINAL", `${nodeId} is ${state.status}`)
      db.query("UPDATE graph_nodes SET status = ?, output_json = ?, updated_at = ? WHERE run_id = ? AND node_id = ?")
        .run("FAILED", JSON.stringify({ reason }), this.now(), runId, nodeId)
      this.journal(db, runId, nodeId, "NODE_FAILED", { reason })
    })()
  }

  /**
   * control.merge (directive 9): frozen join semantics. The join fires
   * ONCE (restart-stable via the committed decision); the merged output
   * materializes branch outputs in CONFIG order (deterministic, never
   * completion order). No branch re-computation ever happens.
   */
  tryJoinMerge(runId: string, token: AuthorityToken, nodeId: string): { fired: boolean; firedNow: boolean; outputs: unknown[] | null; failedBranch: string | null } {
    const node = this.requireNode(nodeId, "control.merge")
    const config = parseControlMergeConfig(node.config)
    const db = this.requireDb()
    let outcome!: { fired: boolean; firedNow: boolean; outputs: unknown[] | null; failedBranch: string | null }
    db.transaction(() => {
      assertAuthorityForRun(db, token, runId)
      const statuses = new Map<string, GraphNodeStatus>()
      for (const branch of config.branches) {
        const state = this.rawState(db, runId, branch)
        if (state) statuses.set(branch, state.status as GraphNodeStatus)
      }
      const failed = config.branches.find((branch) => statuses.get(branch) === "FAILED") ?? null
      const completed = config.branches.filter((branch) => statuses.get(branch) === "COMPLETED")
      const ready = config.strategy === "all" ? failed === null && completed.length === config.branches.length : config.strategy === "any" ? completed.length >= 1 : completed.length >= (config.n ?? 1)
      if (failed !== null && config.strategy === "all") {
        const decision = { fired: false, failedBranch: failed }
        const existing = this.existingDecision(db, runId, nodeId)
        if (existing) { outcome = { ...JSON.parse(existing), firedNow: false, outputs: null }; return }
        // The merge row may not exist yet (auto-seed mirrors committedDecision).
        this.setStatus(db, runId, nodeId, "FAILED")
        db.query("UPDATE graph_nodes SET decision_json = ?, output_json = ?, updated_at = ? WHERE run_id = ? AND node_id = ?")
          .run(JSON.stringify(decision), JSON.stringify({ reason: `branch ${failed} failed` }), this.now(), runId, nodeId)
        this.journal(db, runId, nodeId, "MERGE_FAILED", decision)
        outcome = { fired: false, firedNow: true, outputs: null, failedBranch: failed }
        return
      }
      if (!ready) { outcome = { fired: false, firedNow: false, outputs: null, failedBranch: null }; return }
      const result = this.committedDecision<{ fired: boolean; outputs: unknown[] }>(db, runId, nodeId, () => ({
        fired: true,
        outputs: config.branches.map((branch) => {
          const state = this.rawState(db, runId, branch)
          return state?.output_json ? (JSON.parse(state.output_json) as unknown) : null
        }),
      }))
      if (result.committedNow) {
        this.journal(db, runId, nodeId, "MERGE_FIRED", { strategy: config.strategy })
        for (const edge of this.outEdges.get(nodeId) ?? []) {
          if (edge.kind === "flow") {
            this.setStatus(db, runId, edge.to, "PENDING")
            this.journal(db, runId, edge.to, "BRANCH_TAKEN", { by: nodeId })
          }
        }
      }
      outcome = { fired: true, firedNow: result.committedNow, outputs: result.decision.outputs, failedBranch: null }
    })()
    return outcome
  }

  /**
   * control.repeat / control.while (directive 11): the loop counter and
   * exit state are DURABLE rows, never process-local. Each iteration is
   * one atomic durable transition (decision update + journal event); a
   * restart resumes at the persisted iteration number; maxIterations is
   * a hard guard (no infinite execution); the body target gets PENDING
   * for the current iteration only (completed iteration side effects are
   * facts — they are never replayed blindly).
   */
  enterLoop(runId: string, token: AuthorityToken, nodeId: string, env: Record<string, unknown>): { iteration: number; done: boolean; bodyNodeId: string | null } {
    const node = this.nodes.get(nodeId)
    if (!node) throw new GraphRuntimeError("NODE_UNKNOWN", nodeId)
    const isRepeat = node.family === "control.repeat"
    if (!isRepeat && node.family !== "control.while") throw new GraphRuntimeError("FAMILY_MISMATCH", `node ${nodeId} is ${node.family}, not a loop family`)
    const config = isRepeat ? parseControlRepeatConfig(node.config) : parseControlWhileConfig(node.config)
    const db = this.requireDb()
    let outcome!: { iteration: number; done: boolean; bodyNodeId: string | null }
    db.transaction(() => {
      assertAuthorityForRun(db, token, runId)
      // auto-seed (loops are reached as branch/flow targets)
      const seeded = this.rawState(db, runId, nodeId)
      if (!seeded) this.setStatus(db, runId, nodeId, "PENDING")
      const existing = this.existingDecision(db, runId, nodeId)
      const previous = existing ? (JSON.parse(existing) as { iteration: number; done: boolean }) : { iteration: 0, done: false }
      if (previous.done) { outcome = { iteration: previous.iteration, done: true, bodyNodeId: null }; return }
      const nextIteration = previous.iteration + 1
      if (nextIteration > config.maxIterations) {
        // Guard: hard ceiling - exit without evaluating the condition again.
        const decision = { iteration: previous.iteration, done: true }
        db.query("UPDATE graph_nodes SET decision_json = ?, status = ?, updated_at = ? WHERE run_id = ? AND node_id = ?")
          .run(JSON.stringify(decision), "COMPLETED", this.now(), runId, nodeId)
        this.journal(db, runId, nodeId, "LOOP_EXIT", { reason: "maxIterations guard", iterations: previous.iteration })
        this.scheduleFlowSuccessors(db, runId, nodeId)
        outcome = { iteration: previous.iteration, done: true, bodyNodeId: null }
        return
      }
      const condition = isRepeat ? (config as { untilCondition?: string }).untilCondition : (config as { whileCondition: string }).whileCondition
      const stop = condition ? (isRepeat ? evaluate(condition, env) === true : evaluate(condition, env) !== true) : false
      if (stop) {
        const decision = { iteration: previous.iteration, done: true }
        db.query("UPDATE graph_nodes SET decision_json = ?, status = ?, updated_at = ? WHERE run_id = ? AND node_id = ?")
          .run(JSON.stringify(decision), "COMPLETED", this.now(), runId, nodeId)
        this.journal(db, runId, nodeId, "LOOP_EXIT", { reason: isRepeat ? "untilCondition met" : "whileCondition false", iterations: previous.iteration })
        this.scheduleFlowSuccessors(db, runId, nodeId)
        outcome = { iteration: previous.iteration, done: true, bodyNodeId: null }
        return
      }
      const decision = { iteration: nextIteration, done: false }
      db.query("UPDATE graph_nodes SET decision_json = ?, status = ?, updated_at = ? WHERE run_id = ? AND node_id = ?")
        .run(JSON.stringify(decision), "RUNNING", this.now(), runId, nodeId)
      this.journal(db, runId, nodeId, "LOOP_ITERATE", { iteration: nextIteration })
      // The canonical body reference is config.body (the graph layer
      // validates it; back-edges are forbidden by the validator).
      const body = config.body
      if (!body || !this.nodes.has(body)) throw new GraphRuntimeError("LOOP_BODY_UNRESOLVED", `${nodeId} body target invalid: ${String(body)}`)
      this.setStatus(db, runId, body, "PENDING")
      this.journal(db, runId, body, "BRANCH_TAKEN", { by: nodeId, iteration: nextIteration })
      outcome = { iteration: nextIteration, done: false, bodyNodeId: body }
    })()
    return outcome
  }

  /** Flow successors of a completed node become PENDING (single authority walk). */
  private scheduleFlowSuccessors(db: Database, runId: string, nodeId: string): void {
    for (const edge of this.outEdges.get(nodeId) ?? []) {
      if (edge.kind === "flow") {
        this.setStatus(db, runId, edge.to, "PENDING")
        this.journal(db, runId, edge.to, "BRANCH_TAKEN", { by: nodeId })
      }
    }
  }

  /**
   * control.map (directive 10): stable element identity via the canonical
   * map-key machinery; per-element instance nodes are durable facts; the
   * LogicalInvocationId is derived deterministically (stable across
   * restart, retries get fresh AttemptIds at the attempt layer).
   */
  fanOutMap(runId: string, token: AuthorityToken, nodeId: string, env: Record<string, unknown>): { elementIds: string[]; instanceIds: string[]; committedNow: boolean } {
    const node = this.nodes.get(nodeId)
    if (!node) throw new GraphRuntimeError("NODE_UNKNOWN", nodeId)
    if (node.family !== "control.map") throw new GraphRuntimeError("FAMILY_MISMATCH", `node ${nodeId} is ${node.family}, not control.map`)
    const config = parseControlMapConfig(node.config)
    const db = this.requireDb()
    let outcome!: { elementIds: string[]; instanceIds: string[]; committedNow: boolean }
    db.transaction(() => {
      assertAuthorityForRun(db, token, runId)
      const result = this.committedDecision<{ elementIds: string[]; instanceIds: string[] }>(db, runId, nodeId, () => {
        const collection = evaluate(config.input, env)
        if (!Array.isArray(collection)) throw new GraphRuntimeError("MAP_INPUT_NOT_LIST", `control.map input did not evaluate to a list: ${nodeId}`)
        const elementIds: string[] = []
        for (const item of collection) {
          const material = extractMapKeyMaterial(config.key, item)
          const elementId = String(material)
          if (elementIds.includes(elementId)) throw new GraphRuntimeError("MAP_DUPLICATE_KEY", `control.map duplicate element key ${JSON.stringify(elementId)}: ${nodeId}`)
          elementIds.push(elementId)
        }
        const instanceIds = elementIds.map((elementId) => DYNAMIC_NODE_ID_PATTERN.test(config.body) ? config.body.replace(/\{[^}]*\}/, elementId) : `${config.body}#${elementId}`)
        return { elementIds, instanceIds }
      })
      if (result.committedNow) {
        this.journal(db, runId, nodeId, "DECIDED_MAP", result.decision)
        for (let i = 0; i < result.decision.instanceIds.length; i++) {
          const instanceId = result.decision.instanceIds[i]!
          const elementId = result.decision.elementIds[i]!
          // Dynamic instance ids are not definition nodes - insert directly.
          db.query("INSERT OR IGNORE INTO graph_nodes (run_id, node_id, status, decision_json, output_json, updated_at) VALUES (?, ?, ?, NULL, NULL, ?)")
            .run(runId, instanceId, "PENDING", this.now())
          this.journal(db, runId, instanceId, "MAP_ELEMENT", { elementId, logicalInvocationId: `li:${runId}:${config.body}:${elementId}` })
        }
      }
      outcome = { ...result.decision, committedNow: result.committedNow }
    })()
    return outcome
  }

  /**
   * control.child (directive 12): the child binding is pinned at dispatch
   * and persisted ONCE (definitionId, version, parent/child linkage) —
   * never resolved "latest" afterwards; restart returns the pinned
   * binding (TOCTOU-proof by durable decision).
   */
  dispatchChild(runId: string, token: AuthorityToken, nodeId: string): { childDefinitionId: string | null; childDeploymentId: string | null; childVersion: string | null; childRunId: string; committedNow: boolean } {
    const node = this.nodes.get(nodeId)
    if (!node) throw new GraphRuntimeError("NODE_UNKNOWN", nodeId)
    if (node.family !== "control.child") throw new GraphRuntimeError("FAMILY_MISMATCH", `node ${nodeId} is ${node.family}, not control.child`)
    const config = parseControlChildConfig(node.config)
    const db = this.requireDb()
    let outcome!: { childDefinitionId: string | null; childDeploymentId: string | null; childVersion: string | null; childRunId: string; committedNow: boolean }
    db.transaction(() => {
      assertAuthorityForRun(db, token, runId)
      const result = this.committedDecision<{ childDefinitionId: string | null; childDeploymentId: string | null; childVersion: string | null; childRunId: string }>(db, runId, nodeId, () => ({
        childDefinitionId: config.definitionId ?? null,
        childDeploymentId: config.deploymentId ?? null,
        childVersion: config.deploymentId ? (config.version ?? null) : null,
        childRunId: `child:${runId}:${nodeId}`,
      }))
      if (result.committedNow) {
        this.journal(db, runId, nodeId, "CHILD_DISPATCHED", { ...result.decision, awaitCompletion: config.awaitCompletion })
        db.query("UPDATE graph_nodes SET status = ?, updated_at = ? WHERE run_id = ? AND node_id = ?")
          .run("RUNNING", this.now(), runId, nodeId)
      }
      outcome = { ...result.decision, committedNow: result.committedNow }
    })()
    return outcome
  }

  /**
   * advance (directives 13/14): the durable walk driver. One pass scans
   * PENDING/RUNNING nodes, decides which are READY (all incoming flow
   * predecessors terminal), applies the family handler for control
   * nodes, and surfaces effect-family nodes for EXTERNAL dispatch
   * (completion via completeNode/failNode). Restart-safe by
   * construction: every handler is idempotent on committed decisions.
   */
  advance(runId: string, token: AuthorityToken, env: Record<string, unknown>): { entered: string[]; readyForDispatch: string[] } {
    const db = this.requireDb()
    const entered: string[] = []
    const readyForDispatch: string[] = []
    return db.transaction(() => {
      assertAuthorityForRun(db, token, runId)
    // Iterate the DEFINITION (not just existing rows): non-entry nodes are
    // invisible until a predecessor scheduled them, yet the walk must reach
    // them the moment their predecessors are terminal.
    for (const node of this.nodes.values()) {
      const state = this.rawState(db, runId, node.id)
      const status = state?.status
      const isLoop = node.family === "control.repeat" || node.family === "control.while"
      const active = status === undefined || status === "PENDING" || (isLoop && status === "RUNNING")
      if (!active && node.family !== "control.merge") continue
      if (!this.predecessorsTerminal(db, runId, node.id)) continue
      switch (node.family) {
        case "control.if": this.decideIf(runId, token, node.id, env); entered.push(node.id); break
        case "control.switch": this.decideSwitch(runId, token, node.id, env); entered.push(node.id); break
        case "control.parallel": this.fanOutParallel(runId, token, node.id); entered.push(node.id); break
        case "control.map": this.fanOutMap(runId, token, node.id, env); entered.push(node.id); break
        case "control.repeat":
        case "control.while": this.enterLoop(runId, token, node.id, env); entered.push(node.id); break
        case "control.child": this.dispatchChild(runId, token, node.id); entered.push(node.id); break
        case "control.merge": {
          const join = this.tryJoinMerge(runId, token, node.id)
          if (join.firedNow) entered.push(node.id)
          break
        }
        case "tool.http":
        case "human.approval":
        case "wait":
        case "trigger.manual":
        case "trigger.schedule": {
          if (status === undefined || status === "PENDING") {
            this.setStatus(db, runId, node.id, "RUNNING")
            this.journal(db, runId, node.id, "NODE_READY", null)
            readyForDispatch.push(node.id)
          }
          break
        }
      }
    }
      return { entered, readyForDispatch }
    })()
  }

  /** A node is READY when every incoming non-on-failure edge starts from a terminal node. */
  private predecessorsTerminal(db: Database, runId: string, nodeId: string): boolean {
    const incoming = (this.inEdges.get(nodeId) ?? []).filter((edge) => edge.kind !== "on-failure")
    if (incoming.length === 0) return true
    return incoming.every((edge) => {
      const source = this.rawState(db, runId, edge.from)
      return source !== null && (source.status === "COMPLETED" || source.status === "SKIPPED")
    })
  }

  /**
   * Directive 20: cancellation is DURABLE INTENT - it is persisted
   * BEFORE any worker reaction. PENDING nodes are SKIPPED immediately
   * (they never dispatch); RUNNING effect nodes keep running until the
   * worker observes isCancelRequested() and fails itself - a stale
   * worker that completes afterwards hits the terminal-state fencing
   * (NODE_ALREADY_TERMINAL).
   */
  requestCancel(runId: string, token: AuthorityToken, reason: string): void {
    const db = this.requireDb()
    db.transaction(() => {
      assertAuthorityForRun(db, token, runId)
      const existing = db.query("SELECT run_id FROM cancel_requests WHERE run_id = ?").get(runId)
      if (existing) return
      db.query("INSERT INTO cancel_requests (run_id, reason, requested_at) VALUES (?, ?, ?)").run(runId, reason, this.now())
      this.journal(db, runId, null, "CANCEL_REQUESTED", { reason })
      const pending = db.query("SELECT node_id FROM graph_nodes WHERE run_id = ? AND status = ?").all(runId, "PENDING") as { node_id: string }[]
      for (const row of pending) {
        db.query("UPDATE graph_nodes SET status = ?, output_json = ?, updated_at = ? WHERE run_id = ? AND node_id = ?")
          .run("SKIPPED", JSON.stringify({ reason: "cancelled" }), this.now(), runId, row.node_id)
        this.journal(db, runId, row.node_id, "CANCELLED", { reason })
      }
    })()
  }

  isCancelRequested(runId: string): boolean {
    const db = this.requireDb()
    return db.query("SELECT run_id FROM cancel_requests WHERE run_id = ?").get(runId) !== null
  }

  /**
   * Directive 19: durable timeout. expireDue(nowMs) fails every RUNNING
   * node past its persisted deadline in ONE atomic pass. Races are
   * settled by the terminal-state fencing: whichever terminal write
   * (completion, failure, expiry) commits first WINS - the loser gets
   * NODE_ALREADY_TERMINAL. Exactly one terminal result per node.
   */
  expireDue(runId: string, token: AuthorityToken, nowMs: number): readonly { runId: string; nodeId: string }[] {
    const db = this.requireDb()
    const expired: { runId: string; nodeId: string }[] = []
    db.transaction(() => {
      assertAuthorityForRun(db, token, runId)
      const rows = db.query("SELECT run_id, node_id FROM graph_nodes WHERE run_id = ? AND status = ? AND deadline_at IS NOT NULL AND deadline_at <= ?").all(runId, "RUNNING", nowMs) as { run_id: string; node_id: string }[]
      for (const row of rows) {
        db.query("UPDATE graph_nodes SET status = ?, output_json = ?, updated_at = ? WHERE run_id = ? AND node_id = ? AND status = ?")
          .run("FAILED", JSON.stringify({ reason: "timeout" }), this.now(), row.run_id, row.node_id, "RUNNING")
        this.journal(db, row.run_id, row.node_id, "NODE_TIMED_OUT", null)
        expired.push({ runId: row.run_id, nodeId: row.node_id })
      }
    })()
    return expired
  }

  /** Persist a deadline when work starts (setDeadline at dispatch). */
  setDeadline(runId: string, token: AuthorityToken, nodeId: string, deadlineAt: number | null): void {
    const db = this.requireDb()
    db.transaction(() => {
      assertAuthorityForRun(db, token, runId)
      db.query("UPDATE graph_nodes SET deadline_at = ?, updated_at = ? WHERE run_id = ? AND node_id = ?")
        .run(deadlineAt, this.now(), runId, nodeId)
    })()
  }

  private rawState(db: Database, runId: string, nodeId: string): { status: string; output_json: string | null; decision_json: string | null } | null {
    const row = db.query("SELECT status, output_json, decision_json FROM graph_nodes WHERE run_id = ? AND node_id = ?").get(runId, nodeId) as { status: string; output_json: string | null; decision_json: string | null } | null
    return row
  }

  private existingDecision(db: Database, runId: string, nodeId: string): string | null {
    const row = db.query("SELECT decision_json FROM graph_nodes WHERE run_id = ? AND node_id = ?").get(runId, nodeId) as { decision_json: string | null } | null
    return row?.decision_json ?? null
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
