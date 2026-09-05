/* SPDX-License-Identifier: MIT */
/* Copyright (c) 2026 Unifia contributors */

/**
 * NativeDurableHistoryAuthority + NativeApprovalAuthority durable proofs
 * (ADR-000 ratified: UNIFIA_NATIVE). These are the D-02 V4 production
 * durable gate proofs: real SQLite persistence across restart, authority
 * fencing (stale generation/owner), atomic state+history commit.
 */

import { describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { NativeDurableHistoryAuthority } from "../src/native-history"
import { NativeApprovalAuthority, type NativeApprovalAuthorityOptions } from "../src/native-approval-authority"
import { NativeAttemptAuthority } from "../src/native-attempts"
import { ApprovalBrokerV4, ApprovalV4Error, type AuthorityToken, type ApprovalBinding } from "../src/approval-v4"
import type { WorkflowRun } from "@unifia/contracts"

const scope = { organizationId: "org", workspaceId: "ws" }
const deployment = { ownershipScope: scope, environmentId: "test" }

const makeRun = (runId: string): WorkflowRun => ({
  runId, deploymentId: "dep-1", workflowVersionId: "ver-1", deploymentScope: deployment,
  triggerId: "trig-1", triggerEventId: "evt-1", durableAuthorityId: runId, durableAuthorityKind: "native",
  status: "running", createdAt: 100, updatedAt: 100,
})

const fixedNow = { value: 10_000 }
const clock = () => fixedNow.value

function freshHistory(): { authority: NativeDurableHistoryAuthority; dir: string; path: string } {
  const dir = mkdtempSync(join(tmpdir(), "unifia-native-hist-"))
  const path = join(dir, "history.sqlite")
  const authority = new NativeDurableHistoryAuthority({ databasePath: path, now: clock })
  authority.initialize()
  return { authority, dir, path }
}

describe("NativeDurableHistoryAuthority", () => {
  test("registers a run and returns a deep copy", async () => {
    const ctx = freshHistory(); try {
      ctx.authority.register(makeRun("run-1"))
      const run = await ctx.authority.getRun("run-1")
      expect(run).not.toBeNull(); expect(run!.status).toBe("running")
      run!.status = "completed"
      expect((await ctx.authority.getRun("run-1"))!.status).toBe("running")
    } finally { ctx.authority.close(); rmSync(ctx.dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }) }
  })

  test("applies a legal transition atomically and journals it", async () => {
    const ctx = freshHistory(); try {
      ctx.authority.register(makeRun("run-1"))
      await ctx.authority.transition("run-1", { from: "running", to: "waiting", effectSlotId: "slot-1", occurredAt: 1100, isCompensating: false })
      const run = await ctx.authority.getRun("run-1")
      expect(run!.status).toBe("waiting"); expect(run!.updatedAt).toBe(1100)
      const history = ctx.authority.inspectTransitions("run-1")
      expect(history).toHaveLength(1)
      expect(history[0]).toMatchObject({ from: "running", to: "waiting", effectSlotId: "slot-1" })
    } finally { ctx.authority.close(); rmSync(ctx.dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }) }
  })

  test("rejects illegal transitions and from-mismatches", async () => {
    const ctx = freshHistory(); try {
      ctx.authority.register(makeRun("run-1"))
      await ctx.authority.transition("run-1", { from: "running", to: "completed", effectSlotId: "slot-1", occurredAt: 1100, isCompensating: false })
      await expect(ctx.authority.transition("run-1", { from: "completed", to: "running", effectSlotId: "slot-2", occurredAt: 1200, isCompensating: false })).rejects.toThrow("Illegal transition")
      await expect(ctx.authority.transition("run-1", { from: "waiting", to: "completed", effectSlotId: "slot-3", occurredAt: 1200, isCompensating: false })).rejects.toThrow("does not match current status")
      expect((await ctx.authority.getRun("run-1"))!.status).toBe("completed")
    } finally { ctx.authority.close(); rmSync(ctx.dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }) }
  })

  test("rejects a future occurredAt (substrate obligation)", async () => {
    const ctx = freshHistory(); try {
      ctx.authority.register(makeRun("run-1"))
      await expect(ctx.authority.transition("run-1", { from: "running", to: "waiting", effectSlotId: "slot-1", occurredAt: 20_000, isCompensating: false })).rejects.toThrow("future")
    } finally { ctx.authority.close(); rmSync(ctx.dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }) }
  })

  test("enqueues commands and applies timer overlap policies", async () => {
    const ctx = freshHistory(); try {
      ctx.authority.register(makeRun("run-1"))
      await ctx.authority.enqueueCommand("run-1", { kind: "tool.http", payload: { url: "/x" } })
      await ctx.authority.scheduleTimer("t-1", "run-1", 2000, "allow")
      await ctx.authority.scheduleTimer("t-1", "run-1", 2500, "forbid")
      await ctx.authority.scheduleTimer("t-1", "run-1", 3000, "replace")
      const timers = ctx.authority.inspectTimers("run-1")
      expect(timers).toHaveLength(1); expect(timers[0]!.fireAt).toBe(3000)
      expect(ctx.authority.inspectCommands("run-1")).toHaveLength(1)
    } finally { ctx.authority.close(); rmSync(ctx.dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }) }
  })

  test("derives the materialized projection from persisted facts", async () => {
    const ctx = freshHistory(); try {
      ctx.authority.register(makeRun("run-1"))
      await ctx.authority.enqueueCommand("run-1", { kind: "tool.http", payload: {} })
      await ctx.authority.scheduleTimer("t-1", "run-1", 2000, "allow")
      await ctx.authority.transition("run-1", { from: "running", to: "waiting", effectSlotId: "slot-1", occurredAt: 1100, isCompensating: false })
      const projection = await ctx.authority.getMaterializedProjection("run-1")
      expect(projection).toMatchObject({ runId: "run-1", status: "waiting", lastTransitionAt: 1100 })
      expect(projection.pendingEffects).toEqual(["tool.http:run-1"])
      expect(projection.pendingTimers).toEqual([{ timerId: "t-1", fireAt: 2000 }])
    } finally { ctx.authority.close(); rmSync(ctx.dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }) }
  })

  test("RESTART: every fact survives close + reopen (no replay ambiguity)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "unifia-native-restart-"))
    const path = join(dir, "history.sqlite")
    try {
      const first = new NativeDurableHistoryAuthority({ databasePath: path, now: clock })
      first.initialize()
      first.register(makeRun("run-1"))
      await first.transition("run-1", { from: "running", to: "waiting", effectSlotId: "slot-1", occurredAt: 1100, isCompensating: false })
      await first.enqueueCommand("run-1", { kind: "human.approval", payload: { id: "a-1" } })
      await first.scheduleTimer("t-1", "run-1", 2000, "allow")
      first.close()

      const second = new NativeDurableHistoryAuthority({ databasePath: path, now: clock })
      second.initialize()
      const run = await second.getRun("run-1")
      expect(run!.status).toBe("waiting")
      expect(second.inspectTransitions("run-1")).toHaveLength(1)
      expect(second.inspectCommands("run-1")).toHaveLength(1)
      const projection = await second.getMaterializedProjection("run-1")
      expect(projection.pendingTimers).toEqual([{ timerId: "t-1", fireAt: 2000 }])
      await second.transition("run-1", { from: "waiting", to: "running", effectSlotId: "slot-2", occurredAt: 1200, isCompensating: false })
      expect((await second.getRun("run-1"))!.status).toBe("running")
      second.close()
    } finally { rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }) }
  })
})

const binding = (overrides: Partial<ApprovalBinding> = {}): ApprovalBinding => ({
  workflowRunId: "run-1", logicalInvocationId: "invoke-1", executionPlanDigest: "plan-a", requesterPrincipalId: "workflow-1",
  ownershipScope: scope, deploymentScope: deployment, capabilityRefs: ["fs.read"], resourceScope: ["/tmp/a"],
  policyDecisionRef: "policy-a", policyVersion: "v1", ...overrides,
})

function freshApproval(): { authority: NativeApprovalAuthority; broker: ApprovalBrokerV4; token: AuthorityToken; dir: string } {
  const dir = mkdtempSync(join(tmpdir(), "unifia-native-approval-"))
  const authority = new NativeApprovalAuthority({ databasePath: join(dir, "approvals.sqlite"), now: clock })
  authority.initialize()
  authority.claim("run-1", "owner-a")
  return { authority, broker: new ApprovalBrokerV4(authority), token: { workflowRunId: "run-1", generation: 1, authorityOwnerId: "owner-a" }, dir }
}

const approvalInput = (overrides: Record<string, unknown> = {}) => ({ ...binding(), expiresAt: 20_000, requestGeneration: 1, ...overrides })

describe("NativeApprovalAuthority (D-02 V4 durable gate)", () => {
  test("fencing: stale generation and deposed owner are rejected", async () => {
    const ctx = freshApproval(); try {
      const stale: AuthorityToken = { ...ctx.token, generation: 0 }
      await expect(ctx.authority.transact(stale, async (state) => ({ state, result: 1 }))).rejects.toThrow("STALE_AUTHORITY")
      const forged: AuthorityToken = { ...ctx.token, authorityOwnerId: "owner-b" }
      await expect(ctx.authority.read(forged, "x")).rejects.toThrow("STALE_AUTHORITY")
    } finally { ctx.authority.close(); rmSync(ctx.dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }) }
  })

  test("takeover bumps generation: old token dies, new token rules (exactly one winner)", async () => {
    const ctx = freshApproval(); try {
      ctx.authority.takeover("run-1", "owner-b")
      await expect(ctx.authority.transact(ctx.token, async (state) => ({ state, result: 1 }))).rejects.toThrow("STALE_AUTHORITY")
      const fresh: AuthorityToken = { workflowRunId: "run-1", generation: 2, authorityOwnerId: "owner-b" }
      const out = await ctx.authority.transact(fresh, async (state) => ({ state, result: state.generation }))
      expect(out).toBe(2)
    } finally { ctx.authority.close(); rmSync(ctx.dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }) }
  })

  test("broker V4 on the durable authority: request -> resolve -> idempotent replay, journal monotonic", async () => {
    const ctx = freshApproval(); try {
      const requested = await ctx.broker.request(approvalInput(), ctx.token)
      expect(requested.state).toBe("PENDING")
      const resolved = await ctx.broker.resolve(requested.approvalId, "APPROVED", { id: "human-1", kind: "human" }, binding(), ctx.token)
      expect(resolved.state).toBe("APPROVED")
      const replay = await ctx.broker.resolve(requested.approvalId, "APPROVED", { id: "human-1", kind: "human" }, binding(), ctx.token)
      expect(replay.state).toBe("APPROVED")
      const events = await ctx.broker.history(requested.approvalId, ctx.token)
      expect(events.map((e) => e.kind)).toEqual(["REQUESTED", "APPROVED", "REPLAYED_RESOLVE"])
      expect(events.map((e) => e.eventSequence)).toEqual([1, 2, 3])
    } finally { ctx.authority.close(); rmSync(ctx.dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }) }
  })

  test("RESTART: approvals, journal and generation survive close + reopen", async () => {
    const dir = mkdtempSync(join(tmpdir(), "unifia-native-approval-restart-"))
    try {
      const first = new NativeApprovalAuthority({ databasePath: join(dir, "approvals.sqlite"), now: clock })
      first.initialize(); first.claim("run-1", "owner-a")
      const brokerA = new ApprovalBrokerV4(first)
      const tokenA: AuthorityToken = { workflowRunId: "run-1", generation: 1, authorityOwnerId: "owner-a" }
      const requested = await brokerA.request(approvalInput(), tokenA)
      await brokerA.resolve(requested.approvalId, "APPROVED", { id: "human-1", kind: "human" }, binding(), tokenA)
      first.close()

      const second = new NativeApprovalAuthority({ databasePath: join(dir, "approvals.sqlite"), now: clock })
      second.initialize()
      const brokerB = new ApprovalBrokerV4(second)
      const inspected = await brokerB.inspect(requested.approvalId, tokenA)
      expect(inspected!.state).toBe("APPROVED")
      const events = await brokerB.history(requested.approvalId, tokenA)
      expect(events.map((e) => e.kind)).toEqual(["REQUESTED", "APPROVED"])
      // a resolution replay after restart stays idempotent (REPLAYED_RESOLVE)
      const replay = await brokerB.resolve(requested.approvalId, "APPROVED", { id: "human-1", kind: "human" }, binding(), tokenA)
      expect(replay.state).toBe("APPROVED")
      const events2 = await brokerB.history(requested.approvalId, tokenA)
      expect(events2[events2.length - 1]!.kind).toBe("REPLAYED_RESOLVE")
      second.close()
    } finally { rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }) }
  })

  test("concurrent transact on the same run: fencing rejects the loser", async () => {
    const ctx = freshApproval(); try {
      const first = ctx.authority.transact(ctx.token, async (state) => {
        const record = { ...binding(), approvalId: "a-x", ordinal: 1, requestGeneration: 1, createdAt: clock(), expiresAt: 2000, state: "PENDING" as const }
        return { state: { ...state, approvals: { ...state.approvals, "a-x": record } }, result: 1 }
      })
      await first
      // simulate a lost authority (generation bump by another claim)
      ctx.authority.takeover("run-1", "owner-b")
      await expect(ctx.authority.transact(ctx.token, async (state) => ({ state, result: 2 }))).rejects.toThrow("STALE_AUTHORITY")
    } finally { ctx.authority.close(); rmSync(ctx.dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }) }
  })
})

describe("D-02 V4 directive-8 proofs on the durable authority", () => {
  test("pending approval survives restart and resolves after it", async () => {
    const dir = mkdtempSync(join(tmpdir(), "unifia-v4-pending-"))
    try {
      const first = new NativeApprovalAuthority({ databasePath: join(dir, "a.sqlite"), now: clock })
      first.initialize(); first.claim("run-1", "owner-a")
      const brokerA = new ApprovalBrokerV4(first)
      const tokenA: AuthorityToken = { workflowRunId: "run-1", generation: 1, authorityOwnerId: "owner-a" }
      const requested = await brokerA.request(approvalInput(), tokenA)
      first.close()
      const second = new NativeApprovalAuthority({ databasePath: join(dir, "a.sqlite"), now: clock })
      second.initialize()
      const brokerB = new ApprovalBrokerV4(second)
      const resolved = await brokerB.resolve(requested.approvalId, "APPROVED", { id: "human-1", kind: "human" }, binding(), tokenA)
      expect(resolved.state).toBe("APPROVED")
      second.close()
    } finally { rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }) }
  })

  test("derived ApprovalId: identical duplicate request returns the same record", async () => {
    const ctx = freshApproval(); try {
      const first = await ctx.broker.request(approvalInput(), ctx.token)
      const second = await ctx.broker.request(approvalInput(), ctx.token)
      expect(second.approvalId).toBe(first.approvalId); expect(second.ordinal).toBe(1)
    } finally { ctx.authority.close(); rmSync(ctx.dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }) }
  })

  test("binding TOCTOU + policy drift are journalled as distinct STALE kinds", async () => {
    const ctx = freshApproval(); try {
      const a = await ctx.broker.request(approvalInput(), ctx.token)
      await expect(ctx.broker.resolve(a.approvalId, "APPROVED", { id: "human-1", kind: "human" }, { ...binding(), executionPlanDigest: "plan-b" }, ctx.token)).resolves.toMatchObject({ state: "STALE" })
      const b = await ctx.broker.request({ ...approvalInput(), requestGeneration: 2 }, ctx.token)
      await expect(ctx.broker.resolve(b.approvalId, "APPROVED", { id: "human-1", kind: "human" }, { ...binding(), policyDecisionRef: "policy-b" }, ctx.token)).resolves.toMatchObject({ state: "STALE" })
      const events = await ctx.broker.history(b.approvalId, ctx.token)
      expect(events.map((e) => e.kind)).toEqual(["REQUESTED", "STALE_DIGEST_MISMATCH"])
    } finally { ctx.authority.close(); rmSync(ctx.dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }) }
  })

  test("scope list reordering does not invalidate a binding", async () => {
    const ctx = freshApproval(); try {
      const created = await ctx.broker.request({ ...approvalInput(), capabilityRefs: ["fs.read", "fs.write"], resourceScope: ["/tmp/a", "/tmp/b"] }, ctx.token)
      const reordered = { ...binding(), capabilityRefs: ["fs.write", "fs.read"], resourceScope: ["/tmp/b", "/tmp/a"] }
      await expect(ctx.broker.resolve(created.approvalId, "APPROVED", { id: "human-1", kind: "human" }, reordered, ctx.token)).resolves.toMatchObject({ state: "APPROVED" })
    } finally { ctx.authority.close(); rmSync(ctx.dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }) }
  })

  test("expiry boundary: past-expiry resolve is EXPIRED (fail-closed)", async () => {
    const ctx = freshApproval(); try {
      const created = await ctx.broker.request(approvalInput(), ctx.token)
      const late: NativeApprovalAuthorityOptions = { databasePath: ctx.dir + "/a.sqlite", now: () => 30_000 }
      void late
      ctx.authority.close()
      const lateAuthority = new NativeApprovalAuthority({ databasePath: join(ctx.dir, "approvals.sqlite"), now: () => 30_000 })
      lateAuthority.initialize()
      const lateBroker = new ApprovalBrokerV4(lateAuthority)
      await expect(lateBroker.resolve(created.approvalId, "APPROVED", { id: "human-1", kind: "human" }, binding(), ctx.token)).resolves.toMatchObject({ state: "EXPIRED" })
      lateAuthority.close()
    } finally { rmSync(ctx.dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }) }
  })

  test("requester cancellation allowed; forged system cancellation rejected", async () => {
    const ctx = freshApproval(); try {
      const first = await ctx.broker.request(approvalInput(), ctx.token)
      await expect(ctx.broker.cancel(first.approvalId, { id: "intruder", kind: "system" }, ctx.token)).rejects.toThrow("CANCEL_REJECTED")
      const cancelled = await ctx.broker.cancel(first.approvalId, { id: "workflow-1", kind: "system" }, ctx.token)
      expect(cancelled.state).toBe("CANCELLED")
      const second = await ctx.broker.request({ ...approvalInput(), requestGeneration: 2 }, ctx.token)
      const byTrusted = await ctx.broker.cancel(second.approvalId, { id: "authority-system", kind: "system" }, ctx.token)
      expect(byTrusted.state).toBe("CANCELLED")
    } finally { ctx.authority.close(); rmSync(ctx.dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }) }
  })

  test("conflicting resolution rejected; journal sequence stays durable and monotonic across restart", async () => {
    const dir = mkdtempSync(join(tmpdir(), "unifia-v4-monotonic-"))
    try {
      const first = new NativeApprovalAuthority({ databasePath: join(dir, "a.sqlite"), now: clock })
      first.initialize(); first.claim("run-1", "owner-a")
      const brokerA = new ApprovalBrokerV4(first)
      const tokenA: AuthorityToken = { workflowRunId: "run-1", generation: 1, authorityOwnerId: "owner-a" }
      const created = await brokerA.request(approvalInput(), tokenA)
      await brokerA.resolve(created.approvalId, "APPROVED", { id: "human-1", kind: "human" }, binding(), tokenA)
      await expect(brokerA.resolve(created.approvalId, "DENIED", { id: "human-2", kind: "human" }, binding(), tokenA)).rejects.toThrow("APPROVAL_ALREADY_RESOLVED")
      first.close()
      const second = new NativeApprovalAuthority({ databasePath: join(dir, "a.sqlite"), now: clock })
      second.initialize()
      const brokerB = new ApprovalBrokerV4(second)
      const events = await brokerB.history(created.approvalId, tokenA)
      expect(events.map((e) => e.eventSequence)).toEqual([1, 2])
      second.close()
    } finally { rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }) }
  })
})

describe("NativeAttemptAuthority (M3 durable attempt/effect identity)", () => {
  test("retry semantics: same LI + same EffectKey -> NEW AttemptId, monotonic seq", () => {
    const dir = mkdtempSync(join(tmpdir(), "unifia-att-"))
    try {
      const a = new NativeAttemptAuthority({ databasePath: join(dir, "x.sqlite"), now: clock })
      a.initialize()
      const first = a.allocateAttempt("run-1", "li-1", "ek.mail.send")
      const second = a.allocateAttempt("run-1", "li-1", "ek.mail.send")
      expect(first.attemptId).not.toBe(second.attemptId)
      expect(first.seq).toBe(1); expect(second.seq).toBe(2)
      const effectId = NativeAttemptAuthority.effectId("run-1", "ek.mail.send")
      expect(first.effectKey).toBe("ek.mail.send")
      expect(a.inspectEffect("run-1", "ek.mail.send")!.effectId).toBe(effectId)
      a.close()
    } finally { rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }) }
  })

  test("outcome recording: attempt becomes terminal, effect follows; double-record rejected", () => {
    const dir = mkdtempSync(join(tmpdir(), "unifia-att2-"))
    try {
      const a = new NativeAttemptAuthority({ databasePath: join(dir, "x.sqlite"), now: clock })
      a.initialize()
      const first = a.allocateAttempt("run-1", "li-1", "ek.http.call")
      a.recordAttemptOutcome("run-1", "li-1", first.attemptId, "SUCCEEDED", { result: { ok: 1 } })
      expect(() => a.recordAttemptOutcome("run-1", "li-1", first.attemptId, "FAILED", {})).toThrow("already terminal")
      expect(a.inspectEffect("run-1", "ek.http.call")!.status).toBe("SUCCEEDED")
      // a NEW attempt on the same LI still works (retry after success is allowed to allocate, outcome re-records a new attempt row)
      const retry = a.allocateAttempt("run-1", "li-1", "ek.http.call")
      expect(retry.seq).toBe(2)
      a.close()
    } finally { rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }) }
  })

  test("UNKNOWN_EXTERNAL_STATE: first-class outcome; terminal states are never overwritten; reconciliation journals", () => {
    const dir = mkdtempSync(join(tmpdir(), "unifia-att3-"))
    try {
      const a = new NativeAttemptAuthority({ databasePath: join(dir, "x.sqlite"), now: clock })
      a.initialize()
      const first = a.allocateAttempt("run-1", "li-1", "ek.pay.charge")
      a.recordAttemptOutcome("run-1", "li-1", first.attemptId, "UNKNOWN_EXTERNAL_STATE", { ackLost: true })
      expect(a.inspectEffect("run-1", "ek.pay.charge")!.status).toBe("UNKNOWN_EXTERNAL_STATE")
      // a late SUCCEEDED attempt outcome must NOT silently overwrite UNKNOWN
      const retry = a.allocateAttempt("run-1", "li-1", "ek.pay.charge")
      a.recordAttemptOutcome("run-1", "li-1", retry.attemptId, "SUCCEEDED", { result: { ok: 1 } })
      expect(a.inspectEffect("run-1", "ek.pay.charge")!.status).toBe("UNKNOWN_EXTERNAL_STATE")
      // only explicit reconciliation moves it, and it is journalled + flagged
      a.reconcileEffect("run-1", "ek.pay.charge", "SUCCEEDED", { reconciled: true })
      const effect = a.inspectEffect("run-1", "ek.pay.charge")
      expect(effect!.status).toBe("SUCCEEDED"); expect(effect!.reconciled).toBe(true)
      expect(() => a.reconcileEffect("run-1", "ek.pay.charge", "FAILED", {})).toThrow("already terminal")
      a.close()
    } finally { rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }) }
  })

  test("idempotency: terminal effect is never overwritten by a late attempt outcome", () => {
    const dir = mkdtempSync(join(tmpdir(), "unifia-att4-"))
    try {
      const a = new NativeAttemptAuthority({ databasePath: join(dir, "x.sqlite"), now: clock })
      a.initialize()
      const first = a.allocateAttempt("run-1", "li-1", "ek.fs.write")
      a.recordAttemptOutcome("run-1", "li-1", first.attemptId, "SUCCEEDED", { result: { n: 1 } })
      const retry = a.allocateAttempt("run-1", "li-1", "ek.fs.write")
      a.recordAttemptOutcome("run-1", "li-1", retry.attemptId, "FAILED", { result: { n: 2 } })
      const effect = a.inspectEffect("run-1", "ek.fs.write")
      expect(effect!.status).toBe("SUCCEEDED")
      const attempts = a.inspectAttempts("run-1", "li-1")
      expect(attempts).toHaveLength(2)
      expect(attempts[0]!.outcome).toBe("SUCCEEDED"); expect(attempts[1]!.outcome).toBe("FAILED")
      a.close()
    } finally { rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }) }
  })

  test("RESTART: attempts, effects and journal survive close + reopen", () => {
    const dir = mkdtempSync(join(tmpdir(), "unifia-att5-"))
    try {
      const a = new NativeAttemptAuthority({ databasePath: join(dir, "x.sqlite"), now: clock })
      a.initialize()
      const first = a.allocateAttempt("run-1", "li-1", "ek.x")
      a.recordAttemptOutcome("run-1", "li-1", first.attemptId, "UNKNOWN_EXTERNAL_STATE", {})
      a.close()
      const b = new NativeAttemptAuthority({ databasePath: join(dir, "x.sqlite"), now: clock })
      b.initialize()
      expect(b.inspectAttempts("run-1", "li-1")).toHaveLength(1)
      expect(b.inspectEffect("run-1", "ek.x")!.status).toBe("UNKNOWN_EXTERNAL_STATE")
      b.reconcileEffect("run-1", "ek.x", "FAILED", {})
      expect(b.inspectEffect("run-1", "ek.x")!.status).toBe("FAILED")
      b.close()
    } finally { rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }) }
  })
})

describe("NativeDurableHistoryAuthority — durable timers (directives 16-17)", () => {
  test("no early fire; due exactly at fireAt; markTimerFired removes from due (at-most-once)", () => {
    const ctx = freshHistory(); try {
      ctx.authority.register(makeRun("run-1"))
      ctx.authority.scheduleTimer("t-1", "run-1", 5000, "allow")
      expect(ctx.authority.dueTimers(4999)).toHaveLength(0)
      expect(ctx.authority.dueTimers(5000)).toEqual([{ runId: "run-1", timerId: "t-1", fireAt: 5000 }])
      ctx.authority.markTimerFired("run-1", "t-1", 5000)
      expect(ctx.authority.dueTimers(99999)).toHaveLength(0)
      expect(ctx.authority.firedTimers("run-1")).toEqual([{ runId: "run-1", timerId: "t-1", firedAt: 5000 }])
      try { ctx.authority.markTimerFired("run-1", "t-1", 5001); expect.unreachable() } catch { /* at-most-once */ }
    } finally { ctx.authority.close(); rmSync(ctx.dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }) }
  })

  test("RESTART: a timer scheduled before shutdown fires after restart (durable catch-up), no duplicate", () => {
    const dir = mkdtempSync(join(tmpdir(), "unifia-timer-restart-"))
    try {
      const first = new NativeDurableHistoryAuthority({ databasePath: join(dir, "h.sqlite"), now: clock })
      first.initialize()
      first.register(makeRun("run-1"))
      first.scheduleTimer("t-9", "run-1", 7000, "allow")
      first.close()
      const second = new NativeDurableHistoryAuthority({ databasePath: join(dir, "h.sqlite"), now: clock })
      second.initialize()
      const due = second.dueTimers(8000)
      expect(due).toEqual([{ runId: "run-1", timerId: "t-9", fireAt: 7000 }])
      second.markTimerFired("run-1", "t-9", 8000)
      // a THIRD process sees the fired fact (no duplicate logical fire)
      const third = new NativeDurableHistoryAuthority({ databasePath: join(dir, "h.sqlite"), now: clock })
      third.initialize()
      expect(third.dueTimers(99999)).toHaveLength(0)
      expect(third.firedTimers("run-1")).toHaveLength(1)
      third.close()
      second.close()
    } finally { rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }) }
  })
})
