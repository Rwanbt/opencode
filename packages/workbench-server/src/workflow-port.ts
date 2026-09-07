/* SPDX-License-Identifier: MIT */

import type { FailurePolicy, NodeFamily, P3Capability } from "@unifia/contracts"
import type { AuthorityToken } from "@unifia/workflow-runtime"

export type { AuthorityToken }

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
  /** Phase 1: explicit node family. Absent = legacy capability mapping. */
  readonly family?: NodeFamily
  /** Phase 1: family config. Absent = legacy {capability, input} shape. */
  readonly config?: Record<string, unknown>
  /** Phase 1: per-step failure policy override. */
  readonly failurePolicy?: FailurePolicy
  /** Phase 1: per-step timeout override (ms). */
  readonly timeoutMs?: number
}

export type WorkflowDefinitionPort = {
  readonly id: string
  readonly version: number
  readonly workspaceId: string
  readonly steps: readonly WorkflowStepPort[]
  /** Phase 1: workflow-level failure policy default (toIr fallback: propagate). */
  readonly defaultFailurePolicy?: FailurePolicy
  /** Phase 1: workflow-level timeout default in ms (0/absent = executor default). */
  readonly defaultTimeoutMs?: number
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
  readonly authorityToken: AuthorityToken
  readonly error?: string
}

export type WorkflowRuntimePort = {
  start(definition: WorkflowDefinitionPort, authorityOwnerId: string): Promise<WorkflowStatePort>
  resume(token: AuthorityToken): Promise<WorkflowStatePort>
  cancel(token: AuthorityToken): Promise<WorkflowStatePort>
  inspect(token: AuthorityToken): Promise<WorkflowStatePort>
  /** Directive 37: read-only durable journal for diagnosis. */
  history(token: AuthorityToken): Promise<readonly { kind: string; nodeId: string | null; seq: number }[]>
  /** Worker-only boundary for completing the currently surfaced step. */
  complete(token: AuthorityToken, output: unknown): Promise<WorkflowStatePort>
  /** Phase 1: drive ready nodes through the registry executors to quiescence. */
  run(token: AuthorityToken, options?: { fetch?: typeof fetch }): Promise<WorkflowStatePort & { drive: { dispatched: readonly { nodeId: string; family: string; attemptId: string | null; status: string }[] } }>
  /** Phase 1: list runs (principal-scoped; per-run node detail still needs the run token). */
  listWorkflows(): Promise<readonly WorkflowRunSummary[]>
  /** Phase 1: per-node execution records reconstructed from the durable journal. */
  executionNodes(token: AuthorityToken): Promise<readonly NodeExecutionRecord[]>
}

export type WorkflowRunSummary = {
  readonly workflowId: string
  readonly definitionId: string
  readonly versionId: string
  readonly status: string
  readonly createdAt: number
  readonly updatedAt: number
}

export type NodeExecutionRecord = {
  readonly nodeId: string
  readonly family: string
  readonly status: string
  readonly attemptId: string | null
  readonly startedAt: number | null
  readonly updatedAt: number | null
  readonly input: unknown
  readonly output: unknown
  readonly error: string | null
}
