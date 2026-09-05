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
import { GraphRuntimeEngine } from "@unifia/workflow-runtime"
import type { Node, Edge, WorkflowDefinition } from "@unifia/contracts"

export interface NativeWorkflowRuntimePortOptions {
  readonly databasePath: string
  readonly now?: () => number
}

export class NativeWorkflowRuntimePort implements WorkflowRuntimePort {
  private engine: GraphRuntimeEngine | null = null
  private readonly loaded = new Map<string, WorkflowDefinitionPort>()
  private readonly options: NativeWorkflowRuntimePortOptions

  constructor(options: NativeWorkflowRuntimePortOptions) {
    this.options = options
  }

  private ensureEngine(definition?: WorkflowDefinitionPort): GraphRuntimeEngine {
    if (this.engine) return this.engine
    if (!definition) throw new Error("workflow runtime not started: no definition loaded")
    this.engine = new GraphRuntimeEngine({ databasePath: this.options.databasePath, definition: toIr(definition), now: this.options.now })
    this.engine.initialize()
    return this.engine
  }

  async start(definition: WorkflowDefinitionPort): Promise<WorkflowStatePort> {
    const engine = this.ensureEngine(definition)
    this.loaded.set(definition.id, definition)
    const runId = runIdFor(definition.id)
    engine.startRun(runId)
    return this.state(runId, definition)
  }

  async resume(workflowId: string): Promise<WorkflowStatePort> {
    const definition = this.loaded.get(workflowId)
    if (!definition) throw new Error(`workflow definition not loaded: ${workflowId}`)
    const runId = runIdFor(workflowId)
    const engine = this.ensureEngine(definition)
    engine.advance(runId, { input: {} })
    return this.state(runId, definition)
  }

  async cancel(workflowId: string): Promise<WorkflowStatePort> {
    const definition = this.loaded.get(workflowId)
    if (!definition) throw new Error(`workflow definition not loaded: ${workflowId}`)
    const runId = runIdFor(workflowId)
    this.ensureEngine(definition).requestCancel(runId, "workbench cancel")
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
      if (nodeState.status === "FAILED") { status = "failed"; nextStep = i; break }
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
