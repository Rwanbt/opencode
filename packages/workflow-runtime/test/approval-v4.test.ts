/* SPDX-License-Identifier: MIT */
/* Copyright (c) 2026 Unifia contributors */

/**
 * ApprovalBrokerV4 contract matrix (master plan D-02 sections 7-19).
 *
 * Level: CONTRACT gate on the authority facade — the durable production gate
 * (real substrate fencing, restart, power loss) stays separate and cannot
 * close before ADR-000 (master plan section 20).
 */

import { describe, expect, test } from "bun:test"
import { ApprovalBrokerV4, ApprovalV4Error, type ApprovalAuthority, type ApprovalAuthorityState, type ApprovalBinding, type ApprovalRecord, type AuthorityToken } from "../src/approval-v4"

const scope = { organizationId: "org", workspaceId: "ws" }
const deployment = { ownershipScope: scope, environmentId: "test" }
const token: AuthorityToken = { workflowRunId: "run-1", generation: 1, authorityOwnerId: "owner-a" }
const requester = { id: "workflow-1", kind: "system" as const }
const approver = { id: "human-1", kind: "human" as const }
const input = (overrides: Partial<ApprovalBinding> & { requestGeneration?: number; expiresAt?: number } = {}) => ({
  workflowRunId: "run-1", logicalInvocationId: "invoke-1", executionPlanDigest: "plan-a", requesterPrincipalId: requester.id,
  ownershipScope: scope, deploymentScope: deployment, capabilityRefs: ["fs.read"], resourceScope: ["/tmp/a"],
  policyDecisionRef: "policy-a", policyVersion: "v1", expiresAt: 200, requestGeneration: 1, ...overrides,
})

const seedRecord = (overrides: Partial<ApprovalRecord> = {}): ApprovalRecord => ({
  workflowRunId: "run-1", logicalInvocationId: "invoke-1", executionPlanDigest: "plan-a", requesterPrincipalId: "workflow-1",
  ownershipScope: scope, deploymentScope: deployment, capabilityRefs: ["fs.read"], resourceScope: ["/tmp/a"],
  policyDecisionRef: "policy-a", policyVersion: "v1",
  approvalId: "seed-1", ordinal: 1, requestGeneration: 1, createdAt: 50, expiresAt: 200, state: "PENDING",
  ...overrides,
})

function authority(now = 100, seed: Partial<ApprovalAuthorityState> = {}): {
  impl: ApprovalAuthority
  time: { value: number }
  takeover: (newOwner: string) => void
  serialize: () => string
} {
  const time = { value: now }
  let state: ApprovalAuthorityState = { generation: 1, ownerId: "owner-a", approvals: {}, history: [], ...seed }
  const fenced = (current: AuthorityToken) => {
    if (current.workflowRunId !== "run-1" || current.generation !== state.generation || current.authorityOwnerId !== state.ownerId) throw new ApprovalV4Error("STALE_AUTHORITY")
  }
  const impl: ApprovalAuthority = {
    now: () => time.value,
    isTrustedSystemActor: (actor, current) => actor.id === "authority-system" && current.authorityOwnerId === "owner-a",
    async transact(current, mutation) {
      fenced(current)
      const next = await mutation(state)
      state = next.state
      return next.result
    },
    async read(current, id) {
      fenced(current)
      return state.approvals[id]
    },
    async readHistory(current, approvalId) {
      fenced(current)
      return state.history.filter((event) => event.approvalId === approvalId)
    },
  }
  return {
    impl,
    time,
    takeover: (newOwner) => { state = { ...state, generation: state.generation + 1, ownerId: newOwner } },
    serialize: () => JSON.stringify(state),
  }
}

describe("ApprovalBrokerV4", () => {
  test("derives a stable id and persists requested history in the run authority", async () => {
    const ctx = authority(); const broker = new ApprovalBrokerV4(ctx.impl)
    const first = await broker.request(input(), token); const second = await broker.request(input(), token)
    expect(second.approvalId).toBe(first.approvalId); expect(first.ordinal).toBe(1)
    const events = await broker.history(first.approvalId, token)
    expect(events.map((event) => event.kind)).toEqual(["REQUESTED"])
    expect(events[0].previousState).toBeNull()
    expect(events[0].eventSequence).toBe(1)
  })

  test("requires complete binding equality, including policy and scopes", async () => {
    const ctx = authority(); const broker = new ApprovalBrokerV4(ctx.impl); const first = await broker.request(input(), token)
    const changed = { ...input(), policyDecisionRef: "policy-b" }
    await expect(broker.resolve(first.approvalId, "APPROVED", approver, changed, token)).resolves.toMatchObject({ state: "STALE" })
    const events = await broker.history(first.approvalId, token)
    expect(events[1].kind).toBe("STALE_DIGEST_MISMATCH")
    expect(events[1].previousState).toBe("PENDING")
  })

  test("separates plan changes from other binding drift in the journal", async () => {
    const ctx = authority(); const broker = new ApprovalBrokerV4(ctx.impl); const first = await broker.request(input(), token)
    const changedPlan = { ...input(), executionPlanDigest: "plan-b" }
    await expect(broker.resolve(first.approvalId, "APPROVED", approver, changedPlan, token)).resolves.toMatchObject({ state: "STALE" })
    const events = await broker.history(first.approvalId, token)
    expect(events[1].kind).toBe("STALE_PLAN_CHANGED")
  })

  test("scope list reordering does not invalidate a binding", async () => {
    const ctx = authority(); const broker = new ApprovalBrokerV4(ctx.impl)
    const created = await broker.request({ ...input(), capabilityRefs: ["fs.read", "fs.write"], resourceScope: ["/tmp/a", "/tmp/b"] }, token)
    const reordered = { ...input(), capabilityRefs: ["fs.write", "fs.read"], resourceScope: ["/tmp/b", "/tmp/a"] }
    await expect(broker.resolve(created.approvalId, "APPROVED", approver, reordered, token)).resolves.toMatchObject({ state: "APPROVED" })
  })

  test("rejects self approval and allows requester cancellation only", async () => {
    const ctx = authority(); const broker = new ApprovalBrokerV4(ctx.impl); const first = await broker.request(input(), token)
    await expect(broker.resolve(first.approvalId, "APPROVED", { id: requester.id, kind: "human" }, input(), token)).rejects.toThrow("SELF_APPROVAL_REJECTED")
    const second = await broker.request({ ...input(), requestGeneration: 2 }, token)
    await expect(broker.cancel(second.approvalId, { id: "other", kind: "human" }, token)).rejects.toThrow("CANCEL_REJECTED")
    await expect(broker.cancel(second.approvalId, requester, token)).resolves.toMatchObject({ state: "CANCELLED" })
  })

  test("requires authority proof for system cancellation", async () => {
    const ctx = authority(); const broker = new ApprovalBrokerV4(ctx.impl); const first = await broker.request(input(), token)
    await expect(broker.cancel(first.approvalId, { id: "forged", kind: "system" }, token)).rejects.toThrow("CANCEL_REJECTED")
    await expect(broker.cancel(first.approvalId, { id: "authority-system", kind: "system" }, token)).resolves.toMatchObject({ state: "CANCELLED" })
  })

  test("uses the equality expiry boundary on both sides", async () => {
    const early = authority(199); const earlyBroker = new ApprovalBrokerV4(early.impl)
    const earlyRecord = await earlyBroker.request(input(), token)
    await expect(earlyBroker.resolve(earlyRecord.approvalId, "APPROVED", approver, input(), token)).resolves.toMatchObject({ state: "APPROVED" })

    const at = authority(200); const atBroker = new ApprovalBrokerV4(at.impl)
    const atRecord = await atBroker.request(input(), token)
    await expect(atBroker.resolve(atRecord.approvalId, "APPROVED", approver, input(), token)).resolves.toMatchObject({ state: "EXPIRED" })

    const late = authority(201); const lateBroker = new ApprovalBrokerV4(late.impl)
    const lateRecord = await lateBroker.request(input(), token)
    await expect(lateBroker.resolve(lateRecord.approvalId, "APPROVED", approver, input(), token)).resolves.toMatchObject({ state: "EXPIRED" })
  })

  test("expires a past-expiry duplicate and issues a fresh request", async () => {
    const ctx = authority(100); const broker = new ApprovalBrokerV4(ctx.impl)
    const first = await broker.request({ ...input(), expiresAt: 150 }, token)
    ctx.time.value = 200
    const second = await broker.request({ ...input(), expiresAt: 300 }, token)
    expect(second.approvalId).not.toBe(first.approvalId)
    expect(second.ordinal).toBe(2)
    await expect(broker.inspect(first.approvalId, token)).resolves.toMatchObject({ state: "EXPIRED" })
    const events = await broker.history(first.approvalId, token)
    expect(events.map((event) => event.kind)).toEqual(["REQUESTED", "EXPIRED"])
  })

  test("supports idempotent replay but rejects a conflicting terminal decision", async () => {
    const ctx = authority(); const broker = new ApprovalBrokerV4(ctx.impl); const first = await broker.request(input(), token)
    await broker.resolve(first.approvalId, "APPROVED", approver, input(), token)
    await expect(broker.resolve(first.approvalId, "APPROVED", approver, input(), token)).resolves.toMatchObject({ state: "APPROVED" })
    await expect(broker.resolve(first.approvalId, "DENIED", approver, input(), token)).rejects.toThrow("APPROVAL_ALREADY_RESOLVED")
    const events = await broker.history(first.approvalId, token)
    expect(events.map((event) => event.kind)).toEqual(["REQUESTED", "APPROVED", "REPLAYED_RESOLVE"])
  })

  test("never re-transitions a terminal record on binding mismatch", async () => {
    const ctx = authority(); const broker = new ApprovalBrokerV4(ctx.impl); const first = await broker.request(input(), token)
    await broker.resolve(first.approvalId, "APPROVED", approver, input(), token)
    const changed = { ...input(), policyDecisionRef: "policy-b" }
    await expect(broker.resolve(first.approvalId, "APPROVED", approver, changed, token)).rejects.toThrow("APPROVAL_ALREADY_RESOLVED")
    await expect(broker.inspect(first.approvalId, token)).resolves.toMatchObject({ state: "APPROVED" })
    const events = await broker.history(first.approvalId, token)
    expect(events.map((event) => event.kind)).toEqual(["REQUESTED", "APPROVED"])
  })

  test("fences every mutating operation with the authority token", async () => {
    const ctx = authority(); const broker = new ApprovalBrokerV4(ctx.impl); const stale = { ...token, generation: 0 }
    await expect(broker.request(input(), stale)).rejects.toThrow("STALE_AUTHORITY")
  })

  test("stale owner loses every mutation; takeover owner resolves", async () => {
    const ctx = authority(); const broker = new ApprovalBrokerV4(ctx.impl)
    const created = await broker.request(input(), token)
    ctx.takeover("owner-b")
    const tokenB: AuthorityToken = { workflowRunId: "run-1", generation: 2, authorityOwnerId: "owner-b" }
    await expect(broker.request(input(), token)).rejects.toThrow("STALE_AUTHORITY")
    await expect(broker.resolve(created.approvalId, "APPROVED", approver, input(), token)).rejects.toThrow("STALE_AUTHORITY")
    await expect(broker.cancel(created.approvalId, requester, token)).rejects.toThrow("STALE_AUTHORITY")
    await expect(broker.resolve(created.approvalId, "APPROVED", approver, input(), tokenB)).resolves.toMatchObject({ state: "APPROVED" })
  })

  test("new request generation gets a distinct approval id", async () => {
    const ctx = authority(); const broker = new ApprovalBrokerV4(ctx.impl)
    const first = await broker.request(input(), token); await broker.resolve(first.approvalId, "DENIED", approver, input(), token)
    const second = await broker.request({ ...input(), requestGeneration: 2 }, token)
    expect(second.approvalId).not.toBe(first.approvalId)
  })

  test("unrelated approvals do not disturb deterministic identity", async () => {
    const ctx = authority(); const broker = new ApprovalBrokerV4(ctx.impl)
    const a1 = await broker.request(input(), token)
    const b1 = await broker.request({ ...input(), logicalInvocationId: "invoke-2" }, token)
    const a2 = await broker.request({ ...input(), requestGeneration: 2 }, token)
    expect(a1.ordinal).toBe(1)
    expect(b1.ordinal).toBe(1)
    expect(a2.ordinal).toBe(2)
    expect(a2.approvalId).not.toBe(a1.approvalId)
    expect(b1.approvalId).not.toBe(a1.approvalId)
  })

  test("rejects run mismatches between token and request or record", async () => {
    const ctx = authority(); const broker = new ApprovalBrokerV4(ctx.impl)
    await expect(broker.request({ ...input(), workflowRunId: "run-2" }, token)).rejects.toThrow("AUTHORITY_RUN_MISMATCH")
    const seeded = authority(100, { approvals: { "run-2-record": seedRecord({ approvalId: "run-2-record", workflowRunId: "run-2" }) } })
    const seededBroker = new ApprovalBrokerV4(seeded.impl)
    await expect(seededBroker.resolve("run-2-record", "APPROVED", approver, input(), token)).rejects.toThrow("AUTHORITY_RUN_MISMATCH")
    await expect(seededBroker.cancel("run-2-record", requester, token)).rejects.toThrow("AUTHORITY_RUN_MISMATCH")
  })

  test("substrate failure leaves no torn state or partial history", async () => {
    const ctx = authority()
    const failing: ApprovalAuthority = {
      now: () => ctx.time.value,
      isTrustedSystemActor: () => false,
      async transact(_current, mutation) {
        await mutation({ generation: 1, ownerId: "owner-a", approvals: {}, history: [] })
        throw new ApprovalV4Error("SUBSTRATE_COMMIT_FAILED")
      },
      async read() { return undefined },
      async readHistory() { return [] },
    }
    const broker = new ApprovalBrokerV4(failing)
    await expect(broker.request(input(), token)).rejects.toThrow("SUBSTRATE_COMMIT_FAILED")
    const healthy = new ApprovalBrokerV4(ctx.impl)
    const after = await healthy.request(input(), token)
    expect(after.ordinal).toBe(1)
    const events = await healthy.history(after.approvalId, token)
    expect(events.map((event) => event.kind)).toEqual(["REQUESTED"])
  })

  test("pending approval survives authority rehydration with identical identity", async () => {
    const first = authority(); const firstBroker = new ApprovalBrokerV4(first.impl)
    const created = await firstBroker.request(input(), token)
    const snapshot = first.serialize()
    const revived = authority(100, JSON.parse(snapshot) as Partial<ApprovalAuthorityState>)
    const revivedBroker = new ApprovalBrokerV4(revived.impl)
    await expect(revivedBroker.inspect(created.approvalId, token)).resolves.toMatchObject({ state: "PENDING", approvalId: created.approvalId })
    await expect(revivedBroker.request(input(), token)).resolves.toMatchObject({ approvalId: created.approvalId })
    await expect(revivedBroker.history(created.approvalId, token)).resolves.toHaveLength(1)
    await expect(revivedBroker.resolve(created.approvalId, "APPROVED", approver, input(), token)).resolves.toMatchObject({ state: "APPROVED" })
  })

  test("history is a dense, ordered, per-transition journal", async () => {
    const ctx = authority(); const broker = new ApprovalBrokerV4(ctx.impl)
    const created = await broker.request(input(), token)
    await broker.resolve(created.approvalId, "APPROVED", approver, input(), token)
    const events = await broker.history(created.approvalId, token)
    expect(events.map((event) => event.eventSequence)).toEqual([1, 2])
    expect(new Set(events.map((event) => event.eventId)).size).toBe(events.length)
    expect(events[1].previousState).toBe("PENDING")
  })

  test("rejects invalid runtime inputs before durable mutation", async () => {
    const ctx = authority(); const broker = new ApprovalBrokerV4(ctx.impl)
    const created = await broker.request(input(), token)
    await expect(broker.resolve(created.approvalId, "APPROVED", null as unknown as typeof approver, input(), token)).rejects.toThrow("HUMAN_ACTOR_REQUIRED")
    await expect(broker.resolve(created.approvalId, "APPROVED", { id: "", kind: "human" }, input(), token)).rejects.toThrow("HUMAN_ACTOR_REQUIRED")
    await expect(broker.resolve(created.approvalId, "APPROVED", { id: "authority-system", kind: "system" }, input(), token)).rejects.toThrow("HUMAN_ACTOR_REQUIRED")
    await expect(broker.cancel(created.approvalId, null as unknown as typeof requester, token)).rejects.toThrow("ACTOR_REQUIRED")
    await expect(broker.resolve("missing", "APPROVED", approver, input(), token)).rejects.toThrow("APPROVAL_NOT_FOUND")
    await expect(broker.request({ ...input(), logicalInvocationId: "" }, token)).rejects.toThrow("INVALID_REQUESTER_OR_IDENTITY")
    await expect(broker.request({ ...input(), policyVersion: "" }, token)).rejects.toThrow("INVALID_BINDING")
    await expect(broker.request({ ...input(), expiresAt: 0 }, token)).rejects.toThrow("INVALID_EXPIRY")
    await expect(broker.request({ ...input(), requestGeneration: 0 }, token)).rejects.toThrow("INVALID_REQUEST_GENERATION")
    await expect(broker.resolve(created.approvalId, "APPROVED", approver, { ...input(), executionPlanDigest: "" }, token)).resolves.toMatchObject({ state: "STALE" })
    const events = await broker.history(created.approvalId, token)
    expect(events.map((event) => event.kind)).toEqual(["REQUESTED", "STALE_PLAN_CHANGED"])
  })

  test("rejects missing or malformed authority tokens at the boundary", async () => {
    const ctx = authority(); const broker = new ApprovalBrokerV4(ctx.impl)
    const created = await broker.request(input(), token)
    await expect(broker.request(input(), undefined as unknown as AuthorityToken)).rejects.toThrow("AUTHORITY_TOKEN_REQUIRED")
    await expect(broker.resolve(created.approvalId, "APPROVED", approver, input(), undefined as unknown as AuthorityToken)).rejects.toThrow("AUTHORITY_TOKEN_REQUIRED")
    await expect(broker.cancel(created.approvalId, requester, undefined as unknown as AuthorityToken)).rejects.toThrow("AUTHORITY_TOKEN_REQUIRED")
    await expect(broker.request(input(), { ...token, workflowRunId: "" })).rejects.toThrow("AUTHORITY_TOKEN_REQUIRED")
    await expect(broker.request(input(), { ...token, generation: 1.5 })).rejects.toThrow("AUTHORITY_TOKEN_REQUIRED")
    await expect(broker.request(input(), { ...token, authorityOwnerId: "" })).rejects.toThrow("AUTHORITY_TOKEN_REQUIRED")
  })
})