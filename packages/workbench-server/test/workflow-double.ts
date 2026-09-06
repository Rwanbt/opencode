/* SPDX-License-Identifier: MIT */
/* Copyright (c) 2026 Unifia contributors */

import type { AuthorityToken } from "@unifia/workflow-runtime"
import type { WorkflowDefinitionPort, WorkflowRuntimePort, WorkflowStatePort } from "../src/workflow-port.js"

export class WorkflowRuntimeDouble implements WorkflowRuntimePort {
  #nextId = 1
  #states = new Map<string, WorkflowStatePort>()

  async start(definition: WorkflowDefinitionPort, authorityOwnerId: string): Promise<WorkflowStatePort> {
    const workflowId = `${definition.id}-${this.#nextId++}`
    const authorityToken: AuthorityToken = { workflowRunId: workflowId, generation: 1, authorityOwnerId }
    const state: WorkflowStatePort = { workflowId, definition, status: "completed", nextStep: definition.steps.length, outputs: [], authorityToken }
    this.#states.set(workflowId, state)
    return state
  }

  async resume(token: AuthorityToken): Promise<WorkflowStatePort> {
    const state = this.#states.get(token.workflowRunId)
    if (!state) throw new Error("workflow not found")
    return state
  }

  async cancel(token: AuthorityToken): Promise<WorkflowStatePort> {
    const state = this.#states.get(token.workflowRunId)
    if (!state) throw new Error("workflow not found")
    const cancelled = { ...state, status: "cancelled" as const }
    this.#states.set(token.workflowRunId, cancelled)
    return cancelled
  }

  async inspect(token: AuthorityToken): Promise<WorkflowStatePort> {
    return this.resume(token)
  }

  async history(_token: AuthorityToken): Promise<readonly { kind: string; nodeId: string | null; seq: number }[]> {
    return []
  }

  async complete(token: AuthorityToken, output: unknown): Promise<WorkflowStatePort> {
    const state = await this.resume(token)
    return { ...state, outputs: [...state.outputs, output] }
  }
}
