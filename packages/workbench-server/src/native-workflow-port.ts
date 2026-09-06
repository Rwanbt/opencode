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
import type { WorkflowDefinitionPort, WorkflowRuntimePort, WorkflowStatePort } from "./workflow-port.js"
import type { Database } from "bun:sqlite"
import { AuthorityError, GraphRuntimeEngine, NativeApprovalAuthority, NativeAttemptAuthority, NativeDurableHistoryAuthority, takeoverAuthority, type AuthorityToken } from "@unifia/workflow-runtime"
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

  constructor(options: NativeWorkflowRuntimePortOptions) {
    this.options = options
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
    const history = new NativeDurableHistoryAuthority({ databasePath: this.options.databasePath, now: this.options.now })
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
    const engine = new GraphRuntimeEngine({ databasePath: this.options.databasePath, definition: toIr(definition), now: this.options.now })
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
    const engine = this.ensureEngine(definition, loaded.versionId)
    engine.advance(runId, token, { input: {} })
    return this.state(runId, definition, loaded.versionId, loaded.versionDigest, token)
  }

  /** Directive 37: read-only durable journal (diagnosis surface). */
  async history(token: AuthorityToken): Promise<readonly { kind: string; nodeId: string | null; seq: number }[]> {
    requireToken(token)
    const runId = token.workflowRunId
    const loaded = this.ensureLoaded(runId)
    const engine = this.ensureEngine(loaded.definition, loaded.versionId)
    engine.assertAuthority(runId, token)
    return engine.inspectEvents(runId).map((event) => ({ kind: event.kind, nodeId: event.nodeId, seq: event.seq }))
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
    const engine = this.ensureEngine(definition, loaded.versionId)
    engine.completeNode(runId, token, stepNodeId(this.firstActiveStep(runId, definition)), output)
    // schedule + surface the successor step (single-pass walk convergence)
    engine.advance(runId, token, { input: {} })
    return this.state(runId, definition, loaded.versionId, loaded.versionDigest, token)
  }

  private firstActiveStep(runId: string, definition: WorkflowDefinitionPort): number {
    const loaded = this.ensureLoaded(runId)
    const engine = this.ensureEngine(definition, loaded.versionId)
    for (let i = 0; i < definition.steps.length; i++) {
      const nodeState = engine.nodeState(runId, stepNodeId(i))
      if (!nodeState || nodeState.status === "RUNNING") return i
    }
    throw new Error(`no active step to complete: ${definition.id}`)
  }

  async cancel(token: AuthorityToken): Promise<WorkflowStatePort> {
    requireToken(token)
    const runId = token.workflowRunId
    const loaded = this.ensureLoaded(runId)
    const definition = loaded.definition
    const engine = this.ensureEngine(definition, loaded.versionId)
    engine.requestCancel(runId, token, "workbench cancel")
    // the workbench boundary IS the worker reaction point: the surfaced
    // in-flight step observes the durable cancel flag and fails itself
    try { engine.failNode(runId, token, stepNodeId(this.firstActiveStep(runId, definition)), "cancelled by workbench") } catch { /* already terminal */ }
    return this.state(runId, definition, loaded.versionId, loaded.versionDigest, token)
  }

  private state(runId: string, definition: WorkflowDefinitionPort, versionId: string, versionDigest: string, authorityToken: AuthorityToken): WorkflowStatePort {
    const engine = this.ensureEngine(definition, versionId)
    const steps = definition.steps
    let nextStep = steps.length
    let status: WorkflowStatePort["status"] = "running"
    const outputs: unknown[] = []
    for (let i = 0; i < steps.length; i++) {
      const nodeState = engine.nodeState(runId, stepNodeId(i))
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
    return { workflowId: runId, definition, status, nextStep, outputs, versionId, versionDigest, authorityToken }
  }
}

function requireToken(token: AuthorityToken | undefined): asserts token is AuthorityToken {
  if (!token) throw new AuthorityError("AUTHORITY_TOKEN_REQUIRED")
}

function stepNodeId(index: number): string {
  return `step-${index}`
}

function toIr(definition: WorkflowDefinitionPort): WorkflowDefinition {
  const nodes: Node[] = definition.steps.map((step, index) => ({
    id: stepNodeId(index),
    family: step.requiresApproval ? "human.approval" : "tool.http",
    config: { capability: step.capability, input: step.input },
  }))
  const edges: Edge[] = []
  for (let i = 0; i < nodes.length - 1; i++) edges.push({ from: nodes[i]!.id, to: nodes[i + 1]!.id, kind: "flow" })
  return {
    definitionId: definition.id,
    ownershipScope: { organizationId: "workbench", workspaceId: definition.workspaceId },
    displayName: definition.id,
    nodes, edges,
    concurrency: { kind: "single" },
    defaultFailurePolicy: { kind: "propagate" },
    defaultTimeoutMs: 0,
    createdAt: 0, updatedAt: 0,
  }
}
