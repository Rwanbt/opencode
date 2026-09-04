/* SPDX-License-Identifier: MIT */
/* Copyright (c) 2026 Unifia contributors */

import { createHash } from "node:crypto"
import type { DeploymentScope, OwnershipScope } from "@unifia/contracts"

export type ApprovalV4State = "PENDING" | "APPROVED" | "DENIED" | "EXPIRED" | "CANCELLED" | "STALE"
export type ApprovalDecision = "APPROVED" | "DENIED"
export type ApprovalActor = { readonly id: string; readonly kind: "human" | "system" }
export type AuthorityToken = { readonly workflowRunId: string; readonly generation: number; readonly authorityOwnerId: string }

export type ApprovalBinding = {
  readonly workflowRunId: string
  readonly logicalInvocationId: string
  readonly executionPlanDigest: string
  readonly requesterPrincipalId: string
  readonly ownershipScope: OwnershipScope
  readonly deploymentScope: DeploymentScope
  readonly capabilityRefs: readonly string[]
  readonly resourceScope: readonly string[]
  readonly policyDecisionRef: string
  readonly policyVersion: string
}

export type ApprovalRecord = ApprovalBinding & {
  readonly approvalId: string
  readonly ordinal: number
  readonly requestGeneration: number
  readonly createdAt: number
  readonly expiresAt: number
  readonly state: ApprovalV4State
  readonly resolvedBy?: ApprovalActor
  readonly resolvedAt?: number
  readonly decision?: ApprovalDecision
}

export type ApprovalHistoryEvent = {
  readonly eventSequence: number
  readonly eventId: string
  readonly approvalId: string
  readonly kind: "REQUESTED" | "APPROVED" | "DENIED" | "EXPIRED" | "CANCELLED" | "STALE"
  readonly actorId: string
  readonly occurredAt: number
}

export type ApprovalAuthorityState = {
  readonly generation: number
  readonly ownerId: string
  readonly approvals: Readonly<Record<string, ApprovalRecord>>
  readonly history: readonly ApprovalHistoryEvent[]
}

export type ApprovalAuthority = {
  readonly now: () => number
  isTrustedSystemActor(actor: ApprovalActor, token: AuthorityToken): boolean
  transact<T>(token: AuthorityToken, mutation: (state: ApprovalAuthorityState) => Promise<{ state: ApprovalAuthorityState; result: T }>): Promise<T>
  read(token: AuthorityToken, id: string): Promise<ApprovalRecord | undefined>
}

export type ApprovalRequest = Omit<ApprovalBinding, "workflowRunId"> & {
  readonly workflowRunId: string
  readonly expiresAt: number
  readonly requestGeneration: number
}

export class ApprovalV4Error extends Error {
  constructor(readonly code: string) { super(code) }
}

export class ApprovalBrokerV4 {
  constructor(private readonly authority: ApprovalAuthority) {}

  async request(input: ApprovalRequest, token: AuthorityToken): Promise<ApprovalRecord> {
    validateRequest(input)
    return this.authority.transact(token, async (state) => {
      const existing = Object.values(state.approvals).find((item) => sameRequest(item, input) && item.state === "PENDING")
      if (existing) return { state, result: existing }
      const ordinal = Object.values(state.approvals).filter((item) => sameFamily(item, input)).reduce((max, item) => Math.max(max, item.ordinal), 0) + 1
      const binding = { ...input }
      const approvalId = deriveApprovalId(binding, ordinal)
      const now = this.authority.now()
      const record: ApprovalRecord = { ...binding, approvalId, ordinal, createdAt: now, state: "PENDING" }
      const event = eventFor(state, record, "REQUESTED", { id: "system", kind: "system" }, now)
      return { state: { ...state, approvals: { ...state.approvals, [approvalId]: record }, history: [...state.history, event] }, result: record }
    })
  }

  async resolve(id: string, decision: ApprovalDecision, actor: ApprovalActor, binding: ApprovalBinding, token: AuthorityToken): Promise<ApprovalRecord> {
    assertHuman(actor)
    return this.authority.transact(token, async (state) => {
      const current = requireApproval(state, id)
      if (current.requesterPrincipalId === actor.id) throw new ApprovalV4Error("SELF_APPROVAL_REJECTED")
      if (!sameBinding(current, binding)) return this.stale(state, current, actor)
      if (current.state !== "PENDING") {
        if (current.decision === decision && current.resolvedBy?.id === actor.id) return { state, result: current }
        throw new ApprovalV4Error("APPROVAL_ALREADY_RESOLVED")
      }
      if (this.authority.now() >= current.expiresAt) return this.close(state, current, "EXPIRED", actor)
      return this.close(state, current, decision, actor)
    })
  }

  async cancel(id: string, actor: ApprovalActor, token: AuthorityToken): Promise<ApprovalRecord> {
    if (!actor || !actor.id) throw new ApprovalV4Error("ACTOR_REQUIRED")
    return this.authority.transact(token, async (state) => {
      const current = requireApproval(state, id)
      if (current.state !== "PENDING") return { state, result: current }
      if (actor.kind === "system" && this.authority.isTrustedSystemActor(actor, token)) return this.close(state, current, "CANCELLED", actor)
      if (current.requesterPrincipalId !== actor.id) throw new ApprovalV4Error("CANCEL_REJECTED")
      return this.close(state, current, "CANCELLED", actor)
    })
  }

  inspect(id: string, token: AuthorityToken): Promise<ApprovalRecord | undefined> { return this.authority.read(token, id) }

  private close(state: ApprovalAuthorityState, current: ApprovalRecord, next: Exclude<ApprovalV4State, "PENDING">, actor: ApprovalActor): { state: ApprovalAuthorityState; result: ApprovalRecord } {
    const now = this.authority.now()
    const updated = { ...current, state: next, resolvedBy: actor, resolvedAt: now, ...(next === "APPROVED" || next === "DENIED" ? { decision: next } : {}) }
    return { state: { ...state, approvals: { ...state.approvals, [current.approvalId]: updated }, history: [...state.history, eventFor(state, updated, next, actor, now)] }, result: updated }
  }

  private stale(state: ApprovalAuthorityState, current: ApprovalRecord, actor: ApprovalActor): { state: ApprovalAuthorityState; result: ApprovalRecord } {
    return this.close(state, current, "STALE", actor)
  }
}

function validateRequest(input: ApprovalRequest): void {
  if (!input.workflowRunId || !input.logicalInvocationId || !input.requesterPrincipalId) throw new ApprovalV4Error("INVALID_REQUESTER_OR_IDENTITY")
  if (!input.executionPlanDigest || !input.policyDecisionRef || !input.policyVersion) throw new ApprovalV4Error("INVALID_BINDING")
  if (!Number.isSafeInteger(input.expiresAt) || input.expiresAt <= 0) throw new ApprovalV4Error("INVALID_EXPIRY")
  if (!Number.isSafeInteger(input.requestGeneration) || input.requestGeneration < 1) throw new ApprovalV4Error("INVALID_REQUEST_GENERATION")
}

function assertHuman(actor: ApprovalActor): void { if (!actor || actor.kind !== "human" || !actor.id) throw new ApprovalV4Error("HUMAN_ACTOR_REQUIRED") }
function requireApproval(state: ApprovalAuthorityState, id: string): ApprovalRecord { const current = state.approvals[id]; if (!current) throw new ApprovalV4Error("APPROVAL_NOT_FOUND"); return current }
function sameFamily(a: ApprovalRecord, b: ApprovalRequest): boolean { return a.workflowRunId === b.workflowRunId && a.logicalInvocationId === b.logicalInvocationId }
function sameRequest(a: ApprovalRecord, b: ApprovalRequest): boolean { return sameFamily(a, b) && a.requestGeneration === b.requestGeneration && sameBinding(a, b) }
function sameBinding(a: ApprovalBinding, b: ApprovalBinding): boolean { return digest(a) === digest(b) }
function canonical(value: ApprovalBinding): Record<string, unknown> { return { workflowRunId: value.workflowRunId, logicalInvocationId: value.logicalInvocationId, executionPlanDigest: value.executionPlanDigest, requesterPrincipalId: value.requesterPrincipalId, ownershipScope: value.ownershipScope, deploymentScope: value.deploymentScope, capabilityRefs: [...value.capabilityRefs], resourceScope: [...value.resourceScope], policyDecisionRef: value.policyDecisionRef, policyVersion: value.policyVersion } }
function digest(value: ApprovalBinding): string { return createHash("sha256").update(JSON.stringify(canonical(value))).digest("hex") }
function deriveApprovalId(value: ApprovalBinding, ordinal: number): string { return `approval-v4-${createHash("sha256").update(JSON.stringify({ binding: canonical(value), ordinal })).digest("hex").slice(0, 32)}` }
function eventFor(state: ApprovalAuthorityState, approval: ApprovalRecord, kind: ApprovalHistoryEvent["kind"], actor: ApprovalActor, now: number): ApprovalHistoryEvent { const eventSequence = state.history.length + 1; return { eventSequence, eventId: `${approval.approvalId}:${eventSequence}`, approvalId: approval.approvalId, kind, actorId: actor.id, occurredAt: now } }
