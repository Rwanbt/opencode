/* SPDX-License-Identifier: MIT */
/* Copyright (c) 2026 Unifia contributors */

import { digest as digestEnvelope } from "@unifia/digest-runtime"
import type { DeploymentScope, OwnershipScope } from "@unifia/contracts"
import type { AuthorityToken } from "./authority.ts"

export type { AuthorityToken } from "./authority.ts"

export type ApprovalV4State = "PENDING" | "APPROVED" | "DENIED" | "EXPIRED" | "CANCELLED" | "STALE"
export type ApprovalDecision = "APPROVED" | "DENIED"
export type ApprovalActor = { readonly id: string; readonly kind: "human" | "system" }

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

// ADR-0007 V3 event taxonomy: STALE distinguishes a changed plan from any
// other binding drift; REPLAYED_RESOLVE journals an idempotent replay.
export type ApprovalHistoryEventKind =
  | "REQUESTED"
  | "APPROVED"
  | "DENIED"
  | "EXPIRED"
  | "CANCELLED"
  | "STALE_PLAN_CHANGED"
  | "STALE_DIGEST_MISMATCH"
  | "REPLAYED_RESOLVE"

export type ApprovalHistoryEvent = {
  readonly eventSequence: number
  readonly eventId: string
  readonly approvalId: string
  readonly kind: ApprovalHistoryEventKind
  readonly previousState: ApprovalV4State | null
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
  readHistory(token: AuthorityToken, approvalId: string): Promise<readonly ApprovalHistoryEvent[]>
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
    assertToken(token)
    // ADR-0007 "facade, pas une seconde authority": a request for run X must
    // never ride a token fencing a different run — the facade is the domain
    // guard, the injected authority stays the only durable owner.
    if (input.workflowRunId !== token.workflowRunId) throw new ApprovalV4Error("AUTHORITY_RUN_MISMATCH")
    validateRequest(input)
    return this.authority.transact(token, async (state) => {
      const now = this.authority.now()
      const existing = Object.values(state.approvals).find((item) => sameRequest(item, input) && item.state === "PENDING")
      if (existing && now < existing.expiresAt) return { state, result: existing }
      // Fail-closed expiry (ADR-0007 invariant 5): a past-expiry duplicate is
      // transitioned EXPIRED inside the same transaction — never handed back
      // as PENDING — and the fresh request takes the next family ordinal.
      const base = existing ? this.expire(state, existing, now) : state
      const ordinal = Object.values(base.approvals).filter((item) => sameFamily(item, input)).reduce((max, item) => Math.max(max, item.ordinal), 0) + 1
      const binding = { ...input }
      const approvalId = deriveApprovalId(binding, ordinal)
      const record: ApprovalRecord = { ...binding, approvalId, ordinal, createdAt: now, state: "PENDING" }
      const event = eventFor(base, record, "REQUESTED", { id: "system", kind: "system" }, now, null)
      return { state: { ...base, approvals: { ...base.approvals, [approvalId]: record }, history: [...base.history, event] }, result: record }
    })
  }

  async resolve(id: string, decision: ApprovalDecision, actor: ApprovalActor, binding: ApprovalBinding, token: AuthorityToken): Promise<ApprovalRecord> {
    assertToken(token)
    assertHuman(actor)
    return this.authority.transact(token, async (state) => {
      const current = requireApproval(state, id)
      if (current.workflowRunId !== token.workflowRunId) throw new ApprovalV4Error("AUTHORITY_RUN_MISMATCH")
      if (current.requesterPrincipalId === actor.id) throw new ApprovalV4Error("SELF_APPROVAL_REJECTED")
      // ADR-0007 invariant 2 (single effective resolution): a terminal record
      // is immutable — a mismatched binding must never re-transition it.
      // STALE is a PENDING-only outcome.
      if (current.state !== "PENDING") {
        if (current.decision === decision && current.resolvedBy?.id === actor.id && sameBinding(current, binding)) {
          const now = this.authority.now()
          return { state: { ...state, history: [...state.history, eventFor(state, current, "REPLAYED_RESOLVE", actor, now, current.state)] }, result: current }
        }
        throw new ApprovalV4Error("APPROVAL_ALREADY_RESOLVED")
      }
      if (!sameBinding(current, binding)) return this.stale(state, current, actor, binding)
      if (this.authority.now() >= current.expiresAt) return this.close(state, current, "EXPIRED", actor, "EXPIRED")
      return this.close(state, current, decision, actor, decision)
    })
  }

  async cancel(id: string, actor: ApprovalActor, token: AuthorityToken): Promise<ApprovalRecord> {
    assertToken(token)
    if (!actor || !actor.id) throw new ApprovalV4Error("ACTOR_REQUIRED")
    return this.authority.transact(token, async (state) => {
      const current = requireApproval(state, id)
      if (current.workflowRunId !== token.workflowRunId) throw new ApprovalV4Error("AUTHORITY_RUN_MISMATCH")
      if (current.state !== "PENDING") return { state, result: current }
      // Cancelling someone else's request is system cancellation and requires
      // the authority's trusted-actor proof; a forged system actor falls
      // through to the requester check and is rejected there.
      if (actor.kind === "system" && this.authority.isTrustedSystemActor(actor, token)) return this.close(state, current, "CANCELLED", actor, "CANCELLED")
      if (current.requesterPrincipalId !== actor.id) throw new ApprovalV4Error("CANCEL_REJECTED")
      return this.close(state, current, "CANCELLED", actor, "CANCELLED")
    })
  }

  inspect(id: string, token: AuthorityToken): Promise<ApprovalRecord | undefined> { return this.authority.read(token, id) }

  history(approvalId: string, token: AuthorityToken): Promise<readonly ApprovalHistoryEvent[]> { return this.authority.readHistory(token, approvalId) }

  private close(state: ApprovalAuthorityState, current: ApprovalRecord, next: Exclude<ApprovalV4State, "PENDING">, actor: ApprovalActor, kind: ApprovalHistoryEventKind): { state: ApprovalAuthorityState; result: ApprovalRecord } {
    const now = this.authority.now()
    const updated = { ...current, state: next, resolvedBy: actor, resolvedAt: now, ...(next === "APPROVED" || next === "DENIED" ? { decision: next } : {}) }
    return { state: { ...state, approvals: { ...state.approvals, [current.approvalId]: updated }, history: [...state.history, eventFor(state, updated, kind, actor, now, current.state)] }, result: updated }
  }

  private expire(state: ApprovalAuthorityState, current: ApprovalRecord, now: number): ApprovalAuthorityState {
    const updated: ApprovalRecord = { ...current, state: "EXPIRED", resolvedAt: now }
    return { ...state, approvals: { ...state.approvals, [current.approvalId]: updated }, history: [...state.history, eventFor(state, updated, "EXPIRED", { id: "system", kind: "system" }, now, current.state)] }
  }

  // ADR-0007 distinguishes a changed plan from any other binding drift in the
  // audit journal; the record state is STALE in both cases.
  private stale(state: ApprovalAuthorityState, current: ApprovalRecord, actor: ApprovalActor, binding: ApprovalBinding): { state: ApprovalAuthorityState; result: ApprovalRecord } {
    return this.close(state, current, "STALE", actor, current.executionPlanDigest !== binding.executionPlanDigest ? "STALE_PLAN_CHANGED" : "STALE_DIGEST_MISMATCH")
  }
}

function validateRequest(input: ApprovalRequest): void {
  if (!input.workflowRunId || !input.logicalInvocationId || !input.requesterPrincipalId) throw new ApprovalV4Error("INVALID_REQUESTER_OR_IDENTITY")
  if (!input.executionPlanDigest || !input.policyDecisionRef || !input.policyVersion) throw new ApprovalV4Error("INVALID_BINDING")
  if (!Number.isSafeInteger(input.expiresAt) || input.expiresAt <= 0) throw new ApprovalV4Error("INVALID_EXPIRY")
  if (!Number.isSafeInteger(input.requestGeneration) || input.requestGeneration < 1) throw new ApprovalV4Error("INVALID_REQUEST_GENERATION")
}

function assertToken(token: AuthorityToken): void { if (!token || !token.workflowRunId || !token.authorityOwnerId || !Number.isSafeInteger(token.generation)) throw new ApprovalV4Error("AUTHORITY_TOKEN_REQUIRED") }

function assertHuman(actor: ApprovalActor): void { if (!actor || actor.kind !== "human" || !actor.id) throw new ApprovalV4Error("HUMAN_ACTOR_REQUIRED") }
function requireApproval(state: ApprovalAuthorityState, id: string): ApprovalRecord { const current = state.approvals[id]; if (!current) throw new ApprovalV4Error("APPROVAL_NOT_FOUND"); return current }
function sameFamily(a: ApprovalRecord, b: ApprovalRequest): boolean { return a.workflowRunId === b.workflowRunId && a.logicalInvocationId === b.logicalInvocationId }
function sameRequest(a: ApprovalRecord, b: ApprovalRequest): boolean { return sameFamily(a, b) && a.requestGeneration === b.requestGeneration && sameBinding(a, b) }
function sameBinding(a: ApprovalBinding, b: ApprovalBinding): boolean { return bindingDigest(a) === bindingDigest(b) }

// WHY: scope/capability lists are sets — reordering them must not invalidate a
// binding. JCS (RFC 8785) sorts object keys but preserves array order, so the
// set-typed arrays are sorted before canonicalization.
function canonical(value: ApprovalBinding): Record<string, unknown> { return { workflowRunId: value.workflowRunId, logicalInvocationId: value.logicalInvocationId, executionPlanDigest: value.executionPlanDigest, requesterPrincipalId: value.requesterPrincipalId, ownershipScope: value.ownershipScope, deploymentScope: value.deploymentScope, capabilityRefs: [...value.capabilityRefs].sort(), resourceScope: [...value.resourceScope].sort(), policyDecisionRef: value.policyDecisionRef, policyVersion: value.policyVersion } }

// ADR-001: binding digests and derived approval ids both flow through the
// shared JCS-v1 + SHA-256 machinery — no local serialization dialect.
function bindingDigest(value: ApprovalBinding): string { return digestEnvelope(canonical(value), "approval-effect").value }
function deriveApprovalId(value: ApprovalBinding, ordinal: number): string { return `approval-v4-${digestEnvelope({ binding: canonical(value), ordinal }, "approval-effect").value.slice(0, 32)}` }

function eventFor(state: ApprovalAuthorityState, approval: ApprovalRecord, kind: ApprovalHistoryEventKind, actor: ApprovalActor, now: number, previousState: ApprovalV4State | null): ApprovalHistoryEvent { const eventSequence = state.history.length + 1; return { eventSequence, eventId: `${approval.approvalId}:${eventSequence}`, approvalId: approval.approvalId, kind, previousState, actorId: actor.id, occurredAt: now } }
