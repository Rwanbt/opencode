/* SPDX-License-Identifier: MIT */

import { describe, expect, test } from "bun:test"
import { ApprovalBrokerV4, ApprovalV4Error, type ApprovalAuthority, type ApprovalAuthorityState, type ApprovalBinding, type AuthorityToken } from "../src/approval-v4"

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

function authority(now = 100): { impl: ApprovalAuthority; state: ApprovalAuthorityState; time: { value: number } } {
  const time = { value: now }
  let state: ApprovalAuthorityState = { generation: 1, ownerId: "owner-a", approvals: {}, history: [] }
  const impl: ApprovalAuthority = {
    now: () => time.value,
    isTrustedSystemActor: (actor, current) => actor.id === "authority-system" && current.authorityOwnerId === "owner-a",
    async transact(current, mutation) {
      if (current.workflowRunId !== "run-1" || current.generation !== state.generation || current.authorityOwnerId !== state.ownerId) throw new ApprovalV4Error("STALE_AUTHORITY")
      const next = await mutation(state)
      state = next.state
      return next.result
    },
    async read(current, id) {
      if (current.workflowRunId !== "run-1" || current.generation !== state.generation || current.authorityOwnerId !== state.ownerId) throw new ApprovalV4Error("STALE_AUTHORITY")
      return state.approvals[id]
    },
  }
  return { impl, state, time }
}

describe("ApprovalBrokerV4", () => {
  test("derives a stable id and persists requested history in the run authority", async () => {
    const ctx = authority(); const broker = new ApprovalBrokerV4(ctx.impl)
    const first = await broker.request(input(), token); const second = await broker.request(input(), token)
    expect(second.approvalId).toBe(first.approvalId); expect(first.ordinal).toBe(1)
  })

  test("requires complete binding equality, including policy and scopes", async () => {
    const ctx = authority(); const broker = new ApprovalBrokerV4(ctx.impl); const first = await broker.request(input(), token)
    const changed = { ...input(), policyDecisionRef: "policy-b" }
    await expect(broker.resolve(first.approvalId, "APPROVED", approver, changed, token)).resolves.toMatchObject({ state: "STALE" })
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

  test("uses the equality expiry boundary", async () => {
    const ctx = authority(200); const broker = new ApprovalBrokerV4(ctx.impl); const first = await broker.request(input(), token)
    await expect(broker.resolve(first.approvalId, "APPROVED", approver, input(), token)).resolves.toMatchObject({ state: "EXPIRED" })
  })

  test("supports idempotent replay but rejects a conflicting terminal decision", async () => {
    const ctx = authority(); const broker = new ApprovalBrokerV4(ctx.impl); const first = await broker.request(input(), token)
    await broker.resolve(first.approvalId, "APPROVED", approver, input(), token)
    await expect(broker.resolve(first.approvalId, "APPROVED", approver, input(), token)).resolves.toMatchObject({ state: "APPROVED" })
    await expect(broker.resolve(first.approvalId, "DENIED", approver, input(), token)).rejects.toThrow("APPROVAL_ALREADY_RESOLVED")
  })

  test("fences every mutating operation with the authority token", async () => {
    const ctx = authority(); const broker = new ApprovalBrokerV4(ctx.impl); const stale = { ...token, generation: 0 }
    await expect(broker.request(input(), stale)).rejects.toThrow("STALE_AUTHORITY")
  })

  test("new request generation gets a distinct approval id", async () => {
    const ctx = authority(); const broker = new ApprovalBrokerV4(ctx.impl)
    const first = await broker.request(input(), token); await broker.resolve(first.approvalId, "DENIED", approver, input(), token)
    const second = await broker.request({ ...input(), requestGeneration: 2 }, token)
    expect(second.approvalId).not.toBe(first.approvalId)
  })
})
