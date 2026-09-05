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
import { GraphRuntimeEngine } from "@unifia/workflow-runtime"
import type { Node, Edge, WorkflowDefinition } from "@unifia/contracts"

export interface NativeWorkflowRuntimePortOptions {
  readonly databasePath: string
  readonly now?: () => number
}

export class NativeWorkflowRuntimePort implements WorkflowRuntimePort {
  private engine: GraphRuntimeEngine | null = null
  private db: Database | null = null
  private readonly loaded = new Map<string, WorkflowDefinitionPort>()
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
    this.db.exec("CREATE TABLE IF NOT EXISTS wf_definitions (workflow_id TEXT PRIMARY KEY, definition_json TEXT NOT NULL)")
    return this.db
  }

  /** True restart/rediscover: the definition itself is a durable fact. */
  private ensureLoaded(workflowId: string): WorkflowDefinitionPort {
    const cached = this.loaded.get(workflowId)
    if (cached) return cached
    const db = this.ensureDb()
    const row = db.query("SELECT definition_json FROM wf_definitions WHERE workflow_id = ?").get(workflowId) as { definition_json: string } | null
    if (!row) throw new Error(`workflow definition not found: ${workflowId}`)
    const restored = JSON.parse(row.definition_json) as WorkflowDefinitionPort
    this.loaded.set(workflowId, restored)
    return restored
  }

  private ensureEngine(definition?: WorkflowDefinitionPort): GraphRuntimeEngine {
    if (this.engine) return this.engine
    if (!definition) throw new Error("workflow runtime not started: no definition loaded")
    this.ensureDb()
    this.engine = new GraphRuntimeEngine({ databasePath: this.options.databasePath, definition: toIr(definition), now: this.options.now })
    this.engine.initialize()
    return this.engine
  }

  async start(definition: WorkflowDefinitionPort): Promise<WorkflowStatePort> {
    this.loaded.set(definition.id, definition)
    const db = this.ensureDb()
    db.query("INSERT OR REPLACE INTO wf_definitions (workflow_id, definition_json) VALUES (?, ?)").run(definition.id, JSON.stringify(definition))
    const engine = this.ensureEngine(definition)
    const runId = runIdFor(definition.id)
    engine.startRun(runId)
    engine.advance(runId, { input: {} })
    return this.state(runId, definition)
  }

  async resume(workflowId: string): Promise<WorkflowStatePort> {
    const definition = this.ensureLoaded(workflowId)
    const runId = runIdFor(workflowId)
    const engine = this.ensureEngine(definition)
    engine.advance(runId, { input: {} })
    return this.state(runId, definition)
  }

  /** Release the durable connection (workbench shutdown / test teardown). */
  close(): void {
    this.engine?.close()
    this.engine = null
    this.db?.close()
    this.db = null
  }

  /** External dispatch completes the surfaced step (durable fact). */
  async complete(workflowId: string, output: unknown): Promise<WorkflowStatePort> {
    const definition = this.ensureLoaded(workflowId)
    if (!definition) throw new Error(`workflow definition not loaded: ${workflowId}`)
    const runId = runIdFor(workflowId)
    const engine = this.ensureEngine(definition)
    engine.completeNode(runId, stepNodeId(this.firstActiveStep(runId, definition)), output)
    // schedule + surface the successor step (single-pass walk convergence)
    engine.advance(runId, { input: {} })
    return this.state(runId, definition)
  }

  private firstActiveStep(runId: string, definition: WorkflowDefinitionPort): number {
    for (let i = 0; i < definition.steps.length; i++) {
      const nodeState = this.engine!.nodeState(runId, stepNodeId(i))
      if (!nodeState || nodeState.status === "RUNNING") return i
    }
    throw new Error(`no active step to complete: ${workflowId}`)
  }

  async cancel(workflowId: string): Promise<WorkflowStatePort> {
    const definition = this.ensureLoaded(workflowId)
    if (!definition) throw new Error(`workflow definition not loaded: ${workflowId}`)
    const runId = runIdFor(workflowId)
    const engine = this.ensureEngine(definition)
    engine.requestCancel(runId, "workbench cancel")
    // the workbench boundary IS the worker reaction point: the surfaced
    // in-flight step observes the durable cancel flag and fails itself
    try { engine.failNode(runId, stepNodeId(this.firstActiveStep(runId, definition)), "cancelled by workbench") } catch { /* already terminal */ }
    return this.state(runId, definition)
  }

  private state(runId: string, definition: WorkflowDefinitionPort): WorkflowStatePort {
    const engine = this.engine!
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
    return { workflowId: definition.id, definition, status, nextStep, outputs }
  }
}

function runIdFor(workflowId: string): string {
  return `wf:${workflowId}`
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
