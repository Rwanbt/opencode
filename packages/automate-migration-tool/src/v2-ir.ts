/* SPDX-License-Identifier: MIT */
/* Copyright (c) 2026 Unifia contributors */

/**
 * Type-only re-exports of the V2 IR surface. The migration tool never
 * re-implements V2 IR; it produces values that match the schemas
 * exported from `@unifia/contracts/workflow-ir.ts`. The runtime
 * validation (z.parse) lives in the consumer; here we only type the
 * shape so the mapping functions stay schema-free.
 *
 * The contracts package is the authority. If the V2 IR changes
 * incompatibly, this mapping must be updated and the V1 fixture
 * corpus re-validated. The mapping deliberately avoids importing
 * zod schemas to keep the dependency graph minimal — the runtime
 * step (ADR-000) is responsible for parseSpec + capability analysis.
 */

/**
 * V2 NodeFamily. Mirrored from
 * `packages/contracts/src/workflow-ir.ts#NodeFamilySchema` (ADR-002 +
 * M2 contracts). Keep this list in lockstep with the source of truth.
 */
export type V2NodeFamily =
  | "trigger.manual"
  | "trigger.schedule"
  | "control.if"
  | "control.switch"
  | "control.parallel"
  | "control.merge"
  | "control.map"
  | "control.repeat"
  | "tool.http"
  | "human.approval"
  | "wait"

/**
 * V2 EdgeKind. Mirrored from
 * `packages/contracts/src/workflow-ir.ts#EdgeKindSchema`. V1 had no
 * edges; the migrator emits `flow` edges between sequential steps.
 */
export type V2EdgeKind =
  | "flow"
  | "branch-true"
  | "branch-false"
  | "case-value"
  | "branch-N"
  | "on-failure"

export interface V2Node {
  id: string
  family: V2NodeFamily
  config: Record<string, unknown>
  /** Per-node timeout (ms). 0 = no timeout. */
  timeoutMs?: number
  /** Optional human label for the workbench. */
  label?: string
}

export interface V2Edge {
  from: string
  to: string
  kind: V2EdgeKind
}

/** V2 failure policy — matches `FailurePolicySchema` in workflow-ir.ts. */
export interface V2FailurePolicy {
  maxAttempts: number
  backoff: "none" | "linear" | "exponential"
  retryOn: ReadonlyArray<string>
}

/** V2 concurrency policy — matches `ConcurrencyPolicySchema`. */
export interface V2ConcurrencyPolicy {
  strategy: "none" | "group" | "queue"
  groupSize?: number
}

/** V2 ownership — matches `OwnershipScopeSchema`. */
export interface V2OwnershipScope {
  tenantId?: string
  workspaceId: string
  ownerId: string
}

/** V2 WorkflowDefinition — matches `WorkflowDefinitionSchema`. */
export interface V2WorkflowDefinition {
  definitionId: string
  ownershipScope: V2OwnershipScope
  displayName: string
  description?: string
  nodes: ReadonlyArray<V2Node>
  edges: ReadonlyArray<V2Edge>
  concurrency: V2ConcurrencyPolicy
  defaultFailurePolicy: V2FailurePolicy
  defaultTimeoutMs: number
  createdAt: number
  updatedAt: number
}
