/* SPDX-License-Identifier: MIT */
/* Copyright (c) 2026 Unifia contributors */
/**
 * NativeWorkflowRuntimePort - the substrate-backed implementation of
 * the workbench WorkflowRuntimePort (directive 31). ADR-000 is
 * ratified (UNIFIA_NATIVE): the injected port that workflow-port.ts
 * left "awaiting a substrate-backed executor" is now wired to
 * GraphRuntimeEngine + the native authorities. The legacy steps
 * surface is translated to the canonical IR once at start; ALL state
 * lives in the durable authorities (restart/rediscover with no
 * in-memory ownership).
 */
import type { NodeExecutionRecord, WorkflowDefinitionPort, WorkflowRunSummary, WorkflowRuntimePort, WorkflowStatePort } from "./workflow-port.js"
import type { Database } from "bun:sqlite"
import { ALL_FAMILY_MANIFESTS_V1, AuthorityError, BUILTIN_NODE_DEFINITIONS, driveToQuiescence, GraphRuntimeEngine, GraphRuntimeError, NativeApprovalAuthority, NativeAttemptAuthority, NativeDurableHistoryAuthority, NodeRegistry, redactNodeData, takeoverAuthority, type AuthorityToken, type DriveReport } from "@unifia/workflow-runtime"
import type { Node, Edge, WorkflowDefinition, WorkflowRun } from "@unifia/contracts"
import { promoteToVersion } from "@unifia/workflow-catalog"

export interface NativeWorkflowRuntimePortOptions {
  readonly databasePath: string
  readonly now?: () => number
}

export class NativeWorkflowRuntimePort implements WorkflowRuntimePort {
  private readonly engines = new Map<string, GraphRuntimeEngine>()
  private db: Database | null = null
  private historySvc: NativeDurableHistoryAuthority | null = null
  private attemptsSvc: NativeAttemptAuthority | null = null
  private approvalsSvc: NativeApprovalAuthority | null = null
  private readonly loaded = new Map<string, { definition: WorkflowDefinitionPort; versionId: string; versionDigest: string }>()
  private readonly options: NativeWorkflowRuntimePortOptions
  private readonly nodeRegistry = new NodeRegistry()

  constructor(options: NativeWorkflowRuntimePortOptions) {
    this.options = options
    for (const def of [...BUILTIN_NODE_DEFINITIONS, ...ALL_FAMILY_MANIFESTS_V1]) this.nodeRegistry.register(def)
  }

  private now(): number { return this.options.now?.() ?? Date.now() }

  /**
   * Production subsystem assembly (#47): history, attempts and
   * approvals live on the same SQLite file as the graph engines.
   * Every mutation downstream therefore flows through the port's
   * own handles under the single canonical AuthorityToken — no
   * laterally-constructed authority is needed on the same file.
   */
  private ensureServices(): void {
    if (this.historySvc) return
    const db = this.ensureDb()
    const history = new NativeDurableHistoryAuthority({ databasePath: this.options.databasePath, now: this.options.now, database: db })
    history.initialize()
    const attempts = new NativeAttemptAuthority({ databasePath: this.options.databasePath, now: this.options.now })
    attempts.initialize()
    const approvals = new NativeApprovalAuthority({ databasePath: this.options.databasePath, now: this.options.now })
    approvals.initialize()
    this.historySvc = history
    this.attemptsSvc = attempts
    this.approvalsSvc = approvals
  }

  get historyAuthority(): NativeDurableHistoryAuthority { this.ensureServices(); return this.historySvc! }

  get attemptAuthority(): NativeAttemptAuthority { this.ensureServices(); return this.attemptsSvc! }

  get approvalAuthority(): NativeApprovalAuthority { this.ensureServices(); return this.approvalsSvc! }

  /** The run's graph engine through the production assembly (authority asserted). */
  graphEngineFor(token: AuthorityToken): GraphRuntimeEngine {
    requireToken(token)
    const runId = token.workflowRunId
    const loaded = this.ensureLoaded(runId)
    const engine = this.ensureEngine(loaded.definition, loaded.versionId)
    engine.assertAuthority(runId, token)
    return engine
  }

  /** Ownership takeover through the shared authority table (generation bump). */
  takeover(token: AuthorityToken, newOwnerId: string): AuthorityToken {
    requireToken(token)
    return takeoverAuthority(this.ensureDb(), token, newOwnerId, this.now())
  }

  private ensureDb(): Database {
    if (this.db) return this.db
    const { Database } = require("bun:sqlite") as { Database: new (path: string) => Database }
    this.db = new Database(this.options.databasePath)
    this.db.exec("PRAGMA journal_mode = WAL")
    this.db.exec("PRAGMA synchronous = FULL")
    this.db.exec("CREATE TABLE IF NOT EXISTS workflow_versions (definition_id TEXT NOT NULL, version_id TEXT NOT NULL, version_digest TEXT NOT NULL, definition_json TEXT NOT NULL, PRIMARY KEY (definition_id, version_id))")
    this.db.exec("CREATE TABLE IF NOT EXISTS workflow_runs (run_id TEXT PRIMARY KEY, definition_id TEXT NOT NULL, version_id TEXT NOT NULL, version_digest TEXT NOT NULL)")
    return this.db
  }

  /** Rediscover a run and its immutable pinned version from durable facts. */
  private ensureLoaded(runId: string): { definition: WorkflowDefinitionPort; versionId: string; versionDigest: string } {
    const cached = this.loaded.get(runId)
    if (cached) return cached
    const db = this.ensureDb()
    const row = db.query("SELECT v.definition_json, v.version_id, v.version_digest FROM workflow_runs r JOIN workflow_versions v ON v.definition_id = r.definition_id AND v.version_id = r.version_id WHERE r.run_id = ?").get(runId) as { definition_json: string; version_id: string; version_digest: string } | null
    if (!row) throw new Error(`workflow run not found: ${runId}`)
    const loaded = { definition: JSON.parse(row.definition_json) as WorkflowDefinitionPort, versionId: row.version_id, versionDigest: row.version_digest }
    this.loaded.set(runId, loaded)
    return loaded
  }

  private ensureEngine(definition: WorkflowDefinitionPort, versionId: string): GraphRuntimeEngine {
    const key = `${definition.id}:${versionId}`
    const existing = this.engines.get(key)
    if (existing) return existing
    this.ensureDb()
    const engine = new GraphRuntimeEngine({ databasePath: this.options.databasePath, definition: toIr(definition), now: this.options.now, database: this.ensureDb() })
    engine.initialize()
    this.engines.set(key, engine)
    return engine
  }

  async start(definition: WorkflowDefinitionPort, authorityOwnerId: string): Promise<WorkflowStatePort> {
    // Directive 36: the immutable publication pin is computed at start
    // (versionId = JCS content digest) and persisted with the run.
    const ir = toIr(definition)
    const version = promoteToVersion(ir, definition.version, "workbench", 0)
    const db = this.ensureDb()
    db.query("INSERT OR IGNORE INTO workflow_versions (definition_id, version_id, version_digest, definition_json) VALUES (?, ?, ?, ?)").run(definition.id, version.versionId, version.versionDigest.value, JSON.stringify(definition))
    const runId = crypto.randomUUID()
    db.query("INSERT INTO workflow_runs (run_id, definition_id, version_id, version_digest) VALUES (?, ?, ?, ?)").run(runId, definition.id, version.versionId, version.versionDigest.value)
    this.loaded.set(runId, { definition, versionId: version.versionId, versionDigest: version.versionDigest.value })
    // #47 production assembly: the WorkflowRun fact lives in the durable
    // history authority, and generation-1 ownership is claimed in history,
    // approvals and graph against the single shared authority row.
    this.ensureServices()
    const record: WorkflowRun = {
      runId,
      deploymentId: "workbench-" + definition.id,
      workflowVersionId: version.versionId,
      deploymentScope: { ownershipScope: { organizationId: "workbench", workspaceId: definition.workspaceId }, environmentId: "workbench" },
      triggerId: runId + ":trigger",
      triggerEventId: runId + ":trigger-event",
      durableAuthorityId: runId,
      durableAuthorityKind: "native",
      status: "running",
      createdAt: this.now(),
      updatedAt: this.now(),
    }
    this.historySvc!.register(record)
    const token = this.historySvc!.claim(runId, authorityOwnerId)
    this.approvalsSvc!.claim(runId, authorityOwnerId)
    const engine = this.ensureEngine(definition, version.versionId)
    engine.claimAuthority(runId, authorityOwnerId)
    engine.startRun(runId, token)
    engine.advance(runId, token, { input: {} })
    return this.state(runId, definition, version.versionId, version.versionDigest.value, token)
  }

  async resume(token: AuthorityToken): Promise<WorkflowStatePort> {
    requireToken(token)
    const runId = token.workflowRunId
    const loaded = this.ensureLoaded(runId)
    const definition = loaded.definition
    this.ensureServices()
    const history = this.historyAuthority
    const engine = this.ensureEngine(definition, loaded.versionId)
    const current = await history.getRun(runId)
    if (current && isTerminalHistoryStatus(current.status)) {
      // Canonical history wins: a terminal run never advances again.
      return this.state(runId, definition, loaded.versionId, loaded.versionDigest, token)
    }
    engine.advance(runId, token, { input: {} })
    // Heal: a graph that already reached a terminal state while the
    // canonical history is still open (crash between pre-boundary
    // writes) closes the boundary now, atomically.
    const terminal = this.graphTerminalStatus(runId, definition, engine)
    if (terminal && current) {
      const db = this.ensureDb()
      db.transaction(() => {
        this.composeTerminalBoundary(token, runId, engine, terminal, current.status)
      })()
    }
    return this.state(runId, definition, loaded.versionId, loaded.versionDigest, token)
  }

  /** Directive 37: read-only durable journal (diagnosis surface). */
  async history(token: AuthorityToken): Promise<readonly { kind: string; nodeId: string | null; seq: number }[]> {
    requireToken(token)
    const runId = token.workflowRunId
    const loaded = this.ensureLoaded(runId)
    const engine = this.ensureEngine(loaded.definition, loaded.versionId)
    engine.assertAuthority(runId, token)
    const events = engine.inspectEvents(runId).map((event) => ({ kind: event.kind, nodeId: event.nodeId, seq: event.seq }))
    // P0-A: expose the canonical history authority alongside the graph journal
    // (same shape) — the run authority is history, not the graph.
    this.ensureServices()
    const canonical = this.historyAuthority.inspectTransitions(runId)
      .map((t, i) => ({ kind: `history:${t.from}->${t.to}`, nodeId: null as string | null, seq: events.length + i }))
    return [...events, ...canonical]
  }

  async inspect(token: AuthorityToken): Promise<WorkflowStatePort> {
    requireToken(token)
    const loaded = this.ensureLoaded(token.workflowRunId)
    const engine = this.ensureEngine(loaded.definition, loaded.versionId)
    engine.assertAuthority(token.workflowRunId, token)
    return this.state(token.workflowRunId, loaded.definition, loaded.versionId, loaded.versionDigest, token)
  }

  /** Release the durable connection (workbench shutdown / test teardown). */
  close(): void {
    for (const engine of this.engines.values()) engine.close()
    this.engines.clear()
    this.historySvc?.close()
    this.attemptsSvc?.close()
    this.approvalsSvc?.close()
    this.historySvc = null
    this.attemptsSvc = null
    this.approvalsSvc = null
    try { this.db?.exec("PRAGMA wal_checkpoint(TRUNCATE)") } catch { /* engine teardown may already hold the checkpoint lock */ }
    this.db?.close()
    this.db = null
  }

  /** External dispatch completes the surfaced step (durable fact). */
  async complete(token: AuthorityToken, output: unknown): Promise<WorkflowStatePort> {
    requireToken(token)
    const runId = token.workflowRunId
    const loaded = this.ensureLoaded(runId)
    const definition = loaded.definition
    this.ensureServices()
    const history = this.historyAuthority
    const before = await history.getRun(runId)
    if (before && isTerminalHistoryStatus(before.status)) {
      throw new GraphRuntimeError("RUN_ALREADY_TERMINAL", `workflow run is ${before.status}: ${runId}`)
    }
    const engine = this.ensureEngine(definition, loaded.versionId)
    const db = this.ensureDb()
    // P0-A atomic boundary: step completion, walk advance, graph terminal
    // mark and canonical history transition commit in ONE shared transaction
    // (nested savepoints — a throw anywhere rolls back all, no split-brain).
    db.transaction(() => {
      engine.completeNode(runId, token, portNodeId(definition, this.firstActiveStep(runId, definition)), output)
      // schedule + surface the successor step (single-pass walk convergence)
      engine.advance(runId, token, { input: {} })
      const terminal = this.graphTerminalStatus(runId, definition, engine)
      if (terminal && before) {
        this.composeTerminalBoundary(token, runId, engine, terminal, before.status)
      }
    })()
    return this.state(runId, definition, loaded.versionId, loaded.versionDigest, token)
  }

  /**
   * P0-A atomic terminal boundary core. Graph terminal mark + canonical
   * history transition, executed synchronously inside the CALLER-owned
   * shared transaction (all durable I/O below is sync SQLite; the async
   * history wrapper is never used here because its rejection would escape
   * the enclosing transaction unnoticed — see transitionSync). A throw
   * anywhere rolls back the whole boundary: no split-brain.
   */
  private composeTerminalBoundary(token: AuthorityToken, runId: string, engine: GraphRuntimeEngine, status: "completed" | "failed" | "cancelled", from: WorkflowRun["status"]): void {
    const marked = engine.markRunTerminal(runId, token, status)
    if (marked.alreadyTerminal) return
    this.historyAuthority.transitionSync(token, runId, {
      from,
      to: status,
      effectSlotId: `terminal:${status}`,
      occurredAt: this.now(),
      isCompensating: false,
    })
  }

  /** Graph-derived terminality, mirroring the state() mapping below. */
  private graphTerminalStatus(runId: string, definition: WorkflowDefinitionPort, engine: GraphRuntimeEngine): "completed" | "failed" | "cancelled" | null {
    for (let i = 0; i < definition.steps.length; i++) {
      const nodeState = engine.nodeState(runId, portNodeId(definition, i))
      if (!nodeState) return null
      if (nodeState.status === "COMPLETED") continue
      if (nodeState.status === "FAILED") {
        const reason = nodeState.outputJson ? ((JSON.parse(nodeState.outputJson) as { reason?: string }).reason ?? "") : ""
        return reason.includes("cancelled") ? "cancelled" : "failed"
      }
      if (nodeState.status === "SKIPPED") return "cancelled"
      return null
    }
    return "completed"
  }

  private firstActiveStep(runId: string, definition: WorkflowDefinitionPort): number {
    const loaded = this.ensureLoaded(runId)
    const engine = this.ensureEngine(definition, loaded.versionId)
    for (let i = 0; i < definition.steps.length; i++) {
      const nodeState = engine.nodeState(runId, portNodeId(definition, i))
      if (!nodeState || nodeState.status === "RUNNING") return i
    }
    throw new Error(`no active step to complete: ${definition.id}`)
  }

  async cancel(token: AuthorityToken): Promise<WorkflowStatePort> {
    requireToken(token)
    const runId = token.workflowRunId
    const loaded = this.ensureLoaded(runId)
    const definition = loaded.definition
    this.ensureServices()
    const history = this.historyAuthority
    const before = await history.getRun(runId)
    if (before && isTerminalHistoryStatus(before.status)) {
      // Idempotent cancel: an already-terminal run reports its canonical
      // state without mutating (safe retries).
      return this.state(runId, definition, loaded.versionId, loaded.versionDigest, token)
    }
    const engine = this.ensureEngine(definition, loaded.versionId)
    // Durable intent FIRST (directive 20), then the atomic terminal boundary.
    engine.requestCancel(runId, token, "workbench cancel")
    const db = this.ensureDb()
    db.transaction(() => {
      // the workbench boundary IS the worker reaction point: the surfaced
      // in-flight step observes the durable cancel flag and fails itself
      const stepId = portNodeId(definition, this.firstActiveStep(runId, definition))
      const step = engine.nodeState(runId, stepId)
      if (step && step.status !== "COMPLETED" && step.status !== "FAILED" && step.status !== "SKIPPED") {
        engine.failNode(runId, token, stepId, "cancelled by workbench")
      }
      const terminal = this.graphTerminalStatus(runId, definition, engine)
      if (terminal && before) {
        this.composeTerminalBoundary(token, runId, engine, terminal, before.status)
      }
    })()
    return this.state(runId, definition, loaded.versionId, loaded.versionDigest, token)
  }

  /**
   * Phase 1: drive ready nodes through the registry executors to quiescence.
   * Every mutation flows through the certified substrate with the run token
   * (fencing, journaling, idempotence unchanged); the terminal boundary is
   * converged afterwards via the certified resume path.
   */
  async run(token: AuthorityToken, options?: { fetch?: typeof fetch; authorize?: (capabilities: readonly string[], resource: string) => Promise<void> }): Promise<WorkflowStatePort & { drive: DriveReport }>
  {
    requireToken(token)
    const runId = token.workflowRunId
    const loaded = this.ensureLoaded(runId)
    this.ensureServices()
    const engine = this.ensureEngine(loaded.definition, loaded.versionId)
    const report = await driveToQuiescence({
      engine,
      attempts: this.attemptAuthority,
      history: this.historyAuthority,
      definition: toIr(loaded.definition),
      token,
      registry: this.nodeRegistry,
      options: { fetchImpl: options?.fetch, authorize: options?.authorize },
    })
    const state = await this.resume(token)
    return { ...state, drive: { dispatched: report.dispatched, terminal: report.terminal } }
  }

  /**
   * Phase 1: list runs (principal-authenticated at HTTP; per-run node
   * detail still requires the run authority token via executionNodes).
   */
  async listWorkflows(workspaceIds?: readonly string[]): Promise<readonly WorkflowRunSummary[]>
  {
    const db = this.ensureDb()
    // Workspace scoping is structural: definition_json always carries the
    // authoring workspaceId, so scoped callers can never see foreign runs.
    // Unknown scope (legacy/test doubles without workspaces) sees everything.
    const scoped = workspaceIds !== undefined
    const placeholders = scoped ? workspaceIds.map(() => "?").join(",") : ""
    const rows = (scoped
      ? db.query(`SELECT r.run_id, r.definition_id, r.version_id, h.status, h.created_at, h.updated_at FROM workflow_runs r LEFT JOIN runs h ON h.run_id = r.run_id LEFT JOIN workflow_versions v ON v.definition_id = r.definition_id AND v.version_id = r.version_id WHERE json_extract(v.definition_json, '$.workspaceId') IN (${placeholders}) ORDER BY h.updated_at DESC LIMIT 100`).all(...workspaceIds)
      : db.query("SELECT r.run_id, r.definition_id, r.version_id, h.status, h.created_at, h.updated_at FROM workflow_runs r LEFT JOIN runs h ON h.run_id = r.run_id ORDER BY h.updated_at DESC LIMIT 100").all()) as { run_id: string; definition_id: string; version_id: string; status: string | null; created_at: number | null; updated_at: number | null }[]
    return rows.map((row) => ({ workflowId: row.run_id, definitionId: row.definition_id, versionId: row.version_id, status: row.status ?? "unknown", createdAt: row.created_at ?? 0, updatedAt: row.updated_at ?? 0 }))
  }

  /**
   * Phase 1: per-node execution records reconstructed from the durable
   * journal (canonical source) plus graph node states. Outputs are
   * redacted on read; execution facts stay exact.
   */
  async executionNodes(token: AuthorityToken): Promise<readonly NodeExecutionRecord[]>
  {
    requireToken(token)
    const runId = token.workflowRunId
    const loaded = this.ensureLoaded(runId)
    const engine = this.ensureEngine(loaded.definition, loaded.versionId)
    engine.assertAuthority(runId, token)
    const ir = toIr(loaded.definition)
    const events = engine.inspectEvents(runId)
    return ir.nodes.map((node) => {
      const state = engine.nodeState(runId, node.id)
      const nodeEvents = events.filter((event) => event.nodeId === node.id)
      // Latest intent wins: after a retry the attemptId must be the newest one.
      let dispatched: (typeof nodeEvents)[number] | undefined
      for (let i = nodeEvents.length - 1; i >= 0; i--) {
        const candidate = nodeEvents[i]!
        if (candidate.kind === "NODE_DISPATCH_INTENT") { dispatched = candidate; break }
      }
      const dispatchDetail = dispatched?.detailJson ? (JSON.parse(dispatched.detailJson) as { attemptId?: string; input?: unknown }) : undefined
      let output: unknown = null
      if (state?.outputJson) {
        try { output = redactNodeData(JSON.parse(state.outputJson) as unknown) } catch { output = null }
      }
      let error: string | null = null
      if (state?.status === "FAILED") {
        try { error = ((JSON.parse(state.outputJson ?? "null") as { reason?: string }).reason ?? "failed") as string } catch { error = "failed" }
      }
      let family: string = node.family
      try { family = `${node.family} (${this.nodeRegistry.get(node.family).metadata.displayName})` } catch { /* unknown family: raw value */ }
      return {
        nodeId: node.id,
        family,
        status: state?.status ?? "UNKNOWN",
        attemptId: dispatchDetail?.attemptId ?? null,
        startedAt: dispatched?.occurredAt ?? null,
        updatedAt: state?.updatedAt ?? null,
        input: dispatchDetail?.input ?? null,
        output,
        error,
      }
    })
  }

  private async state(runId: string, definition: WorkflowDefinitionPort, versionId: string, versionDigest: string, authorityToken: AuthorityToken): Promise<WorkflowStatePort> {
    const engine = this.ensureEngine(definition, versionId)
    const steps = definition.steps
    let nextStep = steps.length
    let status: WorkflowStatePort["status"] = "running"
    const outputs: unknown[] = []
    for (let i = 0; i < steps.length; i++) {
      const nodeState = engine.nodeState(runId, portNodeId(definition, i))
      if (!nodeState) { nextStep = i; status = "pending"; break }
      if (nodeState.status === "COMPLETED") { outputs.push(nodeState.outputJson ? (JSON.parse(nodeState.outputJson) as unknown) : null); continue }
      if (nodeState.status === "FAILED") {
        // a FAILED step whose durable reason is the workbench cancel IS a cancellation
        const reason = nodeState.outputJson ? ((JSON.parse(nodeState.outputJson) as { reason?: string }).reason ?? "") : ""
        status = reason.includes("cancelled") ? "cancelled" : "failed"
        nextStep = i
        break
      }
      if (nodeState.status === "SKIPPED") { status = "cancelled"; nextStep = i; break }
      nextStep = i
      status = "running"
      break
    }
    if (nextStep >= steps.length && status === "running") status = "completed"
    // P0-A canonical mapping: a terminal durable history overrides the
    // graph-derived detail, so HTTP state == projection == recovered state.
    // Non-terminal runs keep the graph detail (pending vs running).
    this.ensureServices()
    const run = await this.historyAuthority.getRun(runId)
    if (run && isTerminalHistoryStatus(run.status)) {
      const terminal = run.status === "completed" ? "completed" : run.status === "failed" ? "failed" : "cancelled"
      return { workflowId: runId, definition, status: terminal, nextStep, outputs, versionId, versionDigest, authorityToken }
    }
    return { workflowId: runId, definition, status, nextStep, outputs, versionId, versionDigest, authorityToken }
  }
}

function requireToken(token: AuthorityToken | undefined): asserts token is AuthorityToken {
  if (!token) throw new AuthorityError("AUTHORITY_TOKEN_REQUIRED")
}

/**
 * Phase 1: node ids are the authored stable step ids (the `$node` canonical
 * keys). Steps without a usable id (untyped JSON input) fall back to the
 * legacy positional `step-N` so old definitions keep working.
 */
function portNodeId(definition: WorkflowDefinitionPort, index: number): string {
  const id = definition.steps[index]?.id
  if (typeof id === "string" && id.length > 0) return id
  return `step-${index}`
}

/** Canonical terminal run states (ADR-004): the durable history owns them. */
function isTerminalHistoryStatus(status: WorkflowRun["status"]): boolean {
  return status === "completed" || status === "failed" || status === "cancelled" ||
    status === "cancelled_with_active_effect" || status === "cancelled_with_unknown_external_state"
}

function toIr(definition: WorkflowDefinitionPort): WorkflowDefinition {
  const nodes: Node[] = definition.steps.map((step, index) => ({
    id: portNodeId(definition, index),
    family: step.family ?? (step.requiresApproval ? "human.approval" : "tool.http"),
    config: step.config ?? { capability: step.capability, input: step.input },
    ...(step.failurePolicy ? { failurePolicy: step.failurePolicy } : {}),
    ...(typeof step.timeoutMs === "number" ? { timeoutMs: step.timeoutMs } : {}),
  }))
  const edges: Edge[] = []
  for (let i = 0; i < nodes.length - 1; i++) edges.push({ from: nodes[i]!.id, to: nodes[i + 1]!.id, kind: "flow" })
  return {
    definitionId: definition.id,
    ownershipScope: { organizationId: "workbench", workspaceId: definition.workspaceId },
    displayName: definition.id,
    nodes, edges,
    concurrency: { kind: "single" },
    defaultFailurePolicy: definition.defaultFailurePolicy ?? { kind: "propagate" },
    defaultTimeoutMs: definition.defaultTimeoutMs ?? 0,
    createdAt: 0, updatedAt: 0,
  }
}
