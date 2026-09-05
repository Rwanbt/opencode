/* SPDX-License-Identifier: MIT */

import type { P3Capability } from "@unifia/contracts"

/**
 * Transitional route port for the legacy workbench workflow surface.
 *
 * WHY this is local: `@unifia/workflow-runtime` now exposes the durable
 * history authority, not the removed V1 executor. Keeping this injected port
 * preserves the HTTP boundary without recreating a second durable authority.
 * A substrate-backed executor can implement it after ADR-000 ratification.
 */
export type WorkflowStepPort = {
  readonly id: string
  readonly capability: P3Capability
  readonly input: Record<string, unknown>
  readonly requiresApproval?: boolean
}

export type WorkflowDefinitionPort = {
  readonly id: string
  readonly version: number
  readonly workspaceId: string
  readonly steps: readonly WorkflowStepPort[]
}

export type WorkflowStatePort = {
  readonly workflowId: string
  readonly definition: WorkflowDefinitionPort
  readonly status: "pending" | "running" | "paused" | "completed" | "failed" | "cancelled"
  readonly nextStep: number
  readonly outputs: readonly unknown[]
  /** Immutable publication pins (directive 36) - set at start. */
  readonly versionId?: string
  readonly versionDigest?: string
  readonly error?: string
}

export type WorkflowRuntimePort = {
  start(definition: WorkflowDefinitionPort): Promise<WorkflowStatePort>
  resume(workflowId: string): Promise<WorkflowStatePort>
  cancel(workflowId: string): Promise<WorkflowStatePort>
  /** Directive 37: read-only durable journal for diagnosis. */
  history?(workflowId: string): Promise<readonly { kind: string; nodeId: string | null; seq: number }[]>
}
