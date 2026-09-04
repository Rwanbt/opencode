/* SPDX-License-Identifier: MIT */
/* Copyright (c) 2026 Unifia contributors */

import { createHash } from "node:crypto"
import { mkdir, readFile, rename, writeFile } from "node:fs/promises"
import { dirname } from "node:path"
import type { DeploymentScope, OwnershipScope } from "@unifia/contracts"

// LEGACY/TEST-ONLY: this store-backed broker is retained solely for V1/V2
// compatibility tests. It is not a production WorkflowRun authority and must
// not be injected into a live execution path. ApprovalBrokerV4 is the
// authority façade for new production wiring.

export type ApprovalState =
  | "PENDING"
  | "APPROVED"
  | "DENIED"
  | "EXPIRED"
  | "CANCELLED"
  | "STALE"

export interface ApprovalPrincipal {
  readonly id: string
  readonly kind: "human" | "workflow" | "llm" | "service"
}

export interface ApprovalRequestV2 {
  readonly approvalId: string
  readonly workflowRunId: string
  readonly logicalInvocationId?: string
  readonly executionPlanDigest: string
  readonly principal: ApprovalPrincipal
  readonly ownershipScope: OwnershipScope
  readonly deploymentScope: DeploymentScope
  readonly capabilityRefs: readonly string[]
  readonly resourceScope: readonly string[]
  readonly policyDecisionRef: string
  readonly policyVersion: string
  readonly reusableGrantId?: string
  readonly createdAtEpochMs: number
  readonly expiresAtEpochMs: number
  readonly state: ApprovalState
}

export interface ApprovalOutcomeV2 {
  readonly approvalId: string
  readonly state: ApprovalState
  readonly actor?: ApprovalPrincipal
  readonly resolvedAtEpochMs?: number
  readonly reason?: string
}

export interface ApprovalResolutionContext {
  readonly executionPlanDigest: string
  readonly resourceScope?: readonly string[]
  readonly ownershipScope?: OwnershipScope
  readonly deploymentScope?: DeploymentScope
  readonly capabilityRefs?: readonly string[]
  readonly policyVersion?: string
}

export interface ApprovalFilter {
  readonly workflowRunId?: string
  readonly state?: ApprovalState
}

export interface ApprovalAuditEntry {
  readonly action: "REQUESTED" | "RESOLVED" | "CANCELLED" | "EXPIRED" | "REVOKED"
  readonly approvalId?: string
  readonly grantId?: string
  readonly atEpochMs: number
  readonly actor?: ApprovalPrincipal
  readonly state?: ApprovalState
  readonly reason?: string
}

interface ApprovalStoreState {
  readonly nextOrdinal: number
  readonly requests: Record<string, ApprovalRequestV2>
  readonly history: readonly ApprovalAuditEntry[]
  readonly revokedGrantIds: readonly string[]
}

export interface ApprovalStore {
  load(): Promise<ApprovalStoreState>
  save(state: ApprovalStoreState): Promise<void>
}

export class InMemoryApprovalStore implements ApprovalStore {
  private state: ApprovalStoreState = emptyState()

  async load(): Promise<ApprovalStoreState> {
    return clone(this.state)
  }

  async save(state: ApprovalStoreState): Promise<void> {
    this.state = clone(state)
  }
}

export class FileBackedApprovalStore implements ApprovalStore {
  constructor(private readonly path: string) {}

  async load(): Promise<ApprovalStoreState> {
    try {
      return parseState(await readFile(this.path, "utf8"))
    } catch (error: unknown) {
      if (isNoEnt(error)) return emptyState()
      throw new Error(`Approval store read failed at ${this.path}: ${String(error)}`)
    }
  }

  async save(state: ApprovalStoreState): Promise<void> {
    const directory = dirname(this.path)
    await mkdir(directory, { recursive: true })
    const temporaryPath = `${this.path}.tmp-${process.pid}-${Date.now()}`
    await writeFile(temporaryPath, JSON.stringify(state, null, 2), "utf8")
    await rename(temporaryPath, this.path)
  }
}

export class ApprovalNotFoundError extends Error {}
export class ApprovalRejectedError extends Error {}

export class LocalApprovalBrokerV2 {
  private state?: ApprovalStoreState
  private operation: Promise<void> = Promise.resolve()

  constructor(
    private readonly store: ApprovalStore,
    private readonly now: () => number = Date.now,
  ) {}

  async request(input: Omit<ApprovalRequestV2, "approvalId" | "createdAtEpochMs" | "state">): Promise<{ approvalId: string; workflowRunId: string }> {
    return this.serial(async () => {
      const state = await this.current()
      if (input.reusableGrantId && state.revokedGrantIds.includes(input.reusableGrantId)) throw new ApprovalRejectedError("GRANT_REVOKED")
      const active = Object.values(state.requests).find(
        (request) => request.workflowRunId === input.workflowRunId && request.executionPlanDigest === input.executionPlanDigest && request.state === "PENDING",
      )
      if (active) return { approvalId: active.approvalId, workflowRunId: active.workflowRunId }
      const approvalId = deterministicId(input, state.nextOrdinal)
      const request: ApprovalRequestV2 = { ...input, approvalId, createdAtEpochMs: this.now(), state: "PENDING" }
      await this.save({ ...state, nextOrdinal: state.nextOrdinal + 1, requests: { ...state.requests, [approvalId]: request }, history: [...state.history, { action: "REQUESTED", approvalId, atEpochMs: this.now(), state: "PENDING" }] })
      return { approvalId, workflowRunId: request.workflowRunId }
    })
  }

  async resolve(id: string, decision: "APPROVED" | "DENIED", actor: ApprovalPrincipal, context: ApprovalResolutionContext): Promise<ApprovalOutcomeV2> {
    return this.serial(async () => {
      assertHumanActor(actor)
      const state = await this.current()
      const request = state.requests[id]
      if (!request) return { approvalId: id, state: "DENIED", reason: "UNKNOWN_APPROVAL" }
      if (actor.id === request.principal.id) throw new ApprovalRejectedError("SELF_APPROVAL_FORBIDDEN")
      if (!sameBinding(request, context)) return this.close(state, request, "STALE", actor, "APPROVAL_STALE")
      if (request.state !== "PENDING") return { approvalId: id, state: request.state, reason: "ALREADY_RESOLVED" }
      if (request.expiresAtEpochMs < this.now()) return this.close(state, request, "EXPIRED", actor, "APPROVAL_EXPIRED")
      return this.close(state, request, decision, actor)
    })
  }

  async cancel(id: string, actor: ApprovalPrincipal): Promise<void> {
    await this.serial(async () => {
      assertHumanActor(actor)
      const state = await this.current()
      const request = state.requests[id]
      if (!request) throw new ApprovalNotFoundError(id)
      if (actor.id === request.principal.id) throw new ApprovalRejectedError("SELF_APPROVAL_FORBIDDEN")
      if (request.state === "PENDING") await this.close(state, request, "CANCELLED", actor, "CANCELLED_BY_ACTOR")
    })
  }

  async inspect(id: string): Promise<ApprovalRequestV2> {
    return this.serial(async () => {
      const state = await this.current()
      const request = state.requests[id]
      if (!request) throw new ApprovalNotFoundError(id)
      return this.expireIfNeeded(state, request)
    })
  }

  async listPending(filter?: ApprovalFilter): Promise<ApprovalRequestV2[]> {
    return this.serial(async () => {
      const state = await this.current()
      const requests: ApprovalRequestV2[] = []
      for (const request of Object.values(state.requests)) requests.push(await this.expireIfNeeded(state, request))
      return requests.filter((request) => request.state === "PENDING" && matches(request, filter))
    })
  }

  async listHistory(filter?: ApprovalFilter): Promise<ApprovalAuditEntry[]> {
    const state = await this.current()
    return state.history.filter((entry) => !filter?.workflowRunId || entry.approvalId === undefined || state.requests[entry.approvalId]?.workflowRunId === filter.workflowRunId)
  }

  async revokeGrant(grantId: string, actor: ApprovalPrincipal): Promise<void> {
    if (actor.kind !== "human") throw new ApprovalRejectedError("HUMAN_ACTOR_REQUIRED")
    await this.serial(async () => {
      const state = await this.current()
      if (state.revokedGrantIds.includes(grantId)) return
      await this.save({ ...state, revokedGrantIds: [...state.revokedGrantIds, grantId], history: [...state.history, { action: "REVOKED", grantId, atEpochMs: this.now(), actor }] })
    })
  }

  private async close(state: ApprovalStoreState, request: ApprovalRequestV2, next: ApprovalState, actor: ApprovalPrincipal, reason?: string): Promise<ApprovalOutcomeV2> {
    const updated = { ...request, state: next }
    const outcome = { approvalId: request.approvalId, state: next, actor, resolvedAtEpochMs: this.now(), ...(reason ? { reason } : {}) }
    await this.save({ ...state, requests: { ...state.requests, [request.approvalId]: updated }, history: [...state.history, { action: next === "CANCELLED" ? "CANCELLED" : next === "EXPIRED" ? "EXPIRED" : "RESOLVED", approvalId: request.approvalId, atEpochMs: outcome.resolvedAtEpochMs, actor, state: next, ...(reason ? { reason } : {}) }] })
    return outcome
  }

  private async expireIfNeeded(state: ApprovalStoreState, request: ApprovalRequestV2): Promise<ApprovalRequestV2> {
    if (request.state === "PENDING" && request.expiresAtEpochMs < this.now()) {
      await this.close(state, request, "EXPIRED", { id: "system", kind: "service" }, "APPROVAL_EXPIRED")
      return { ...request, state: "EXPIRED" }
    }
    return request
  }

  private async current(): Promise<ApprovalStoreState> {
    this.state ??= await this.store.load()
    return this.state
  }

  private async save(state: ApprovalStoreState): Promise<void> {
    this.state = state
    await this.store.save(state)
  }

  private async serial<T>(operation: () => Promise<T>): Promise<T> {
    let result!: T
    const run = this.operation.then(async () => { result = await operation() })
    this.operation = run.catch(() => undefined)
    await run
    return result
  }
}

function emptyState(): ApprovalStoreState { return { nextOrdinal: 1, requests: {}, history: [], revokedGrantIds: [] } }
function clone<T>(value: T): T { return JSON.parse(JSON.stringify(value)) as T }
function parseState(raw: string): ApprovalStoreState { const value = JSON.parse(raw) as Partial<ApprovalStoreState>; if (!value.requests || !Array.isArray(value.history) || !Array.isArray(value.revokedGrantIds) || typeof value.nextOrdinal !== "number") throw new Error("Approval store snapshot is invalid"); return value as ApprovalStoreState }
function deterministicId(input: Omit<ApprovalRequestV2, "approvalId" | "createdAtEpochMs" | "state">, ordinal: number): string { const canonical = JSON.stringify({ workflowRunId: input.workflowRunId, logicalInvocationId: input.logicalInvocationId, executionPlanDigest: input.executionPlanDigest, ordinal }); return `approval-v2-${createHash("sha256").update(canonical).digest("hex").slice(0, 24)}` }
function sameBinding(request: ApprovalRequestV2, context: ApprovalResolutionContext): boolean { return request.executionPlanDigest === context.executionPlanDigest && (!context.resourceScope || includesAll(request.resourceScope, context.resourceScope)) && (!context.capabilityRefs || includesAll(request.capabilityRefs, context.capabilityRefs)) && (!context.policyVersion || request.policyVersion === context.policyVersion) && (!context.ownershipScope || JSON.stringify(request.ownershipScope) === JSON.stringify(context.ownershipScope)) && (!context.deploymentScope || JSON.stringify(request.deploymentScope) === JSON.stringify(context.deploymentScope)) }
function includesAll(allowed: readonly string[], requested: readonly string[]): boolean { return requested.every((item) => allowed.includes(item)) }
function matches(request: ApprovalRequestV2, filter?: ApprovalFilter): boolean { return !filter?.workflowRunId || request.workflowRunId === filter.workflowRunId }
function isNoEnt(error: unknown): boolean { return typeof error === "object" && error !== null && (error as { code?: string }).code === "ENOENT" }
function assertHumanActor(actor: ApprovalPrincipal): void { if (!actor || actor.kind !== "human" || actor.id.length === 0) throw new ApprovalRejectedError("HUMAN_ACTOR_REQUIRED") }
