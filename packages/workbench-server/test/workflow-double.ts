/* SPDX-License-Identifier: MIT */
/* Copyright (c) 2026 Unifia contributors */

import type { WorkflowDefinitionPort, WorkflowRuntimePort, WorkflowStatePort } from "../src/workflow-port.js"

export class WorkflowRuntimeDouble implements WorkflowRuntimePort {
  #nextId = 1
  #states = new Map<string, WorkflowStatePort>()

  async start(definition: WorkflowDefinitionPort): Promise<WorkflowStatePort> {
    const workflowId = `${definition.id}-${this.#nextId++}`
    const state: WorkflowStatePort = { workflowId, definition, status: "completed", nextStep: definition.steps.length, outputs: [] }
    this.#states.set(workflowId, state)
    return state
  }

  async resume(workflowId: string): Promise<WorkflowStatePort> {
    const state = this.#states.get(workflowId)
    if (!state) throw new Error("workflow not found")
    return state
  }

  async cancel(workflowId: string): Promise<WorkflowStatePort> {
    const state = this.#states.get(workflowId)
    if (!state) throw new Error("workflow not found")
    const cancelled = { ...state, status: "cancelled" as const }
    this.#states.set(workflowId, cancelled)
    return cancelled
  }
}
