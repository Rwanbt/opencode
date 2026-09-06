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
import { GraphRuntimeEngine, type AuthorityToken } from "@unifia/workflow-runtime"
import type { Node, Edge, WorkflowDefinition } from "@unifia/contracts"
import { promoteToVersion } from "@unifia/workflow-catalog"

export interface NativeWorkflowRuntimePortOptions {
  readonly databasePath: string
  readonly now?: () => number
}

export class NativeWorkflowRuntimePort implements WorkflowRuntimePort {
  private readonly engines = new Map<string, GraphRuntimeEngine>()
  private db: Database | null = null
  private readonly loaded = new Map<string, { definition: WorkflowDefinitionPort; versionId: string; versionDigest: string }>()
  private readonly tokens = new Map<string, AuthorityToken>()
  private readonly options: NativeWorkflowRuntimePortOptions

  constructor(options: NativeWorkflowRuntimePortOptions) {
    this.options = options
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

  async start(definition: WorkflowDefinitionPort): Promise<WorkflowStatePort> {
    // Directive 36: the immutable publication pin is computed at start
    // (versionId = JCS content digest) and persisted with the run.
    const ir = toIr(definition)
    const version = promoteToVersion(ir, definition.version, "workbench", 0)
    const db = this.ensureDb()
    db.query("INSERT OR IGNORE INTO workflow_versions (definition_id, version_id, version_digest, definition_json) VALUES (?, ?, ?, ?)").run(definition.id, version.versionId, version.versionDigest.value, JSON.stringify(definition))
    const runId = crypto.randomUUID()
    db.query("INSERT INTO workflow_runs (run_id, definition_id, version_id, version_digest) VALUES (?, ?, ?, ?)").run(runId, definition.id, version.versionId, version.versionDigest.value)
    this.loaded.set(runId, { definition, versionId: version.versionId, versionDigest: version.versionDigest.value })
    const engine = this.ensureEngine(definition, version.versionId)
    const token = engine.claimAuthority(runId, "workbench")
    this.tokens.set(runId, token)
    engine.startRun(runId, token)
    engine.advance(runId, token, { input: {} })
    return this.state(runId, definition, version.versionId, version.versionDigest.value)
  }

  async resume(runId: string): Promise<WorkflowStatePort> {
    const loaded = this.ensureLoaded(runId)
    const definition = loaded.definition
    const engine = this.ensureEngine(definition, loaded.versionId)
    const token = this.tokens.get(runId) ?? engine.claimAuthority(runId, "workbench")
    this.tokens.set(runId, token)
    engine.advance(runId, token, { input: {} })
    return this.state(runId, definition, loaded.versionId, loaded.versionDigest)
  }

  /** Directive 37: read-only durable journal (diagnosis surface). */
  async history(runId: string): Promise<readonly { kind: string; nodeId: string | null; seq: number }[]> {
    const loaded = this.ensureLoaded(runId)
    const engine = this.ensureEngine(loaded.definition, loaded.versionId)
    return engine.inspectEvents(runId).map((event) => ({ kind: event.kind, nodeId: event.nodeId, seq: event.seq }))
  }

  /** Release the durable connection (workbench shutdown / test teardown). */
  close(): void {
    for (const engine of this.engines.values()) engine.close()
    this.engines.clear()
    try { this.db?.exec("PRAGMA wal_checkpoint(TRUNCATE)") } catch { /* engine teardown may already hold the checkpoint lock */ }
    this.db?.close()
    this.db = null
  }

  /** External dispatch completes the surfaced step (durable fact). */
  async complete(runId: string, output: unknown): Promise<WorkflowStatePort> {
    const loaded = this.ensureLoaded(runId)
    const definition = loaded.definition
    const engine = this.ensureEngine(definition, loaded.versionId)
    const token = this.tokens.get(runId) ?? engine.claimAuthority(runId, "workbench")
    this.tokens.set(runId, token)
    engine.completeNode(runId, token, stepNodeId(this.firstActiveStep(runId, definition)), output)
    // schedule + surface the successor step (single-pass walk convergence)
    engine.advance(runId, token, { input: {} })
    return this.state(runId, definition, loaded.versionId, loaded.versionDigest)
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

  async cancel(runId: string): Promise<WorkflowStatePort> {
    const loaded = this.ensureLoaded(runId)
    const definition = loaded.definition
    const engine = this.ensureEngine(definition, loaded.versionId)
    const token = this.tokens.get(runId) ?? engine.claimAuthority(runId, "workbench")
    this.tokens.set(runId, token)
    engine.requestCancel(runId, token, "workbench cancel")
    // the workbench boundary IS the worker reaction point: the surfaced
    // in-flight step observes the durable cancel flag and fails itself
    try { engine.failNode(runId, token, stepNodeId(this.firstActiveStep(runId, definition)), "cancelled by workbench") } catch { /* already terminal */ }
    return this.state(runId, definition, loaded.versionId, loaded.versionDigest)
  }

  private state(runId: string, definition: WorkflowDefinitionPort, versionId: string, versionDigest: string): WorkflowStatePort {
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
    return { workflowId: runId, definition, status, nextStep, outputs, versionId, versionDigest }
  }
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
