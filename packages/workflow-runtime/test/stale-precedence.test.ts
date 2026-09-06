/* SPDX-License-Identifier: MIT */
/* Copyright (c) 2026 Unifia contributors */

/**
 * P1 authority-error precedence: for every protected mutation boundary, a
 * stale owner/generation reports typed STALE_AUTHORITY BEFORE any semantic
 * payload validation can mask the fence — with zero durable mutation.
 *
 * Each family below pairs a stale+invalid call (must be STALE_AUTHORITY)
 * with a fresh+invalid control (must be the semantic error, proving the
 * test actually exercises the masked path and is not vacuous).
 */
import { describe, expect, test } from "bun:test"
import { Database } from "bun:sqlite"
import { mkdtempSync, rmSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { NativeDurableHistoryAuthority } from "../src/native-history"
import { NativeApprovalAuthority } from "../src/native-approval-authority"
import { NativeAttemptAuthority } from "../src/native-attempts"
import { ApprovalBrokerV4, type ApprovalBinding } from "../src/approval-v4"
import { GraphRuntimeEngine } from "../src/graph-runtime"
import { claimAuthority, takeoverAuthority, type AuthorityToken } from "../src/authority"

const now = () => 10_000
const scope = { organizationId: "org", workspaceId: "ws" }

async function expectStaleCode(action: () => unknown, label: string): Promise<void> {
  try {
    await action()
  } catch (error) {
    expect(error).toBeInstanceOf(Error)
    expect((error as { code?: string }).code, label).toBe("STALE_AUTHORITY")
    return
  }
  expect.unreachable()
}

function takeover(path: string, token: AuthorityToken, owner: string): AuthorityToken {
  const db = new Database(path)
  try {
    return takeoverAuthority(db, token, owner, now())
  } finally {
    db.close()
  }
}

function historyRun(runId: string) {
  return {
    runId,
    deploymentId: "dep-1",
    workflowVersionId: "ver-1",
    deploymentScope: { ownershipScope: scope, environmentId: "test" },
    triggerId: "trig-1",
    triggerEventId: "evt-1",
    durableAuthorityId: runId,
    durableAuthorityKind: "native" as const,
    status: "running" as const,
    createdAt: 100,
    updatedAt: 100,
  }
}

function approvalBinding(runId: string): ApprovalBinding {
  return {
    workflowRunId: runId,
    logicalInvocationId: "li-1",
    executionPlanDigest: "plan",
    requesterPrincipalId: "requester",
    ownershipScope: scope,
    deploymentScope: { ownershipScope: scope, environmentId: "test" },
    capabilityRefs: ["c"],
    resourceScope: ["s"],
    policyDecisionRef: "p",
    policyVersion: "pv",
  }
}

const graphDefinition = {
  definitionId: "sp",
  ownershipScope: scope,
  displayName: "sp",
  nodes: [{ id: "step-0", family: "tool.http" as const, config: {} }],
  edges: [],
  concurrency: { kind: "single" as const },
  defaultFailurePolicy: { kind: "propagate" as const },
  defaultTimeoutMs: 0,
  createdAt: 0,
  updatedAt: 0,
}

describe("stale authority precedence over semantic validation", () => {
  test("history.transition: stale + future timestamp -> STALE_AUTHORITY, zero mutation", async () => {
    const dir = mkdtempSync(join(tmpdir(), "unifia-stale-hist-"))
    const path = join(dir, "h.sqlite")
    const history = new NativeDurableHistoryAuthority({ databasePath: path, now })
    try {
      history.initialize()
      history.register(historyRun("run-1"))
      const tokenA = history.claim("run-1", "owner-a")
      const tokenB = takeover(path, tokenA, "owner-b")
      const stale = tokenA
      const future = { from: "running" as const, to: "waiting" as const, effectSlotId: "s", occurredAt: 20_000, isCompensating: false }
      await expectStaleCode(() => history.transition(stale, "run-1", future), "stale+future")
      await expect(history.transition(tokenB, "run-1", future)).rejects.toThrow("future")
      expect(history.inspectTransitions("run-1")).toHaveLength(0)
      history.close()
    } finally {
      try { history.close() } catch { /* already closed */ }
      rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
    }
  })

  test("history.enqueueCommand: stale + empty kind -> STALE_AUTHORITY, zero mutation", async () => {
    const dir = mkdtempSync(join(tmpdir(), "unifia-stale-cmd-"))
    const path = join(dir, "h.sqlite")
    const history = new NativeDurableHistoryAuthority({ databasePath: path, now })
    try {
      history.initialize()
      history.register(historyRun("run-1"))
      const tokenA = history.claim("run-1", "owner-a")
      const tokenB = takeover(path, tokenA, "owner-b")
      await expectStaleCode(() => history.enqueueCommand(tokenA, "run-1", { kind: "", payload: {} }), "stale+empty-kind")
      await expect(history.enqueueCommand(tokenB, "run-1", { kind: "", payload: {} })).rejects.toThrow("command.kind")
      expect(history.inspectCommands("run-1")).toHaveLength(0)
      history.close()
    } finally {
      try { history.close() } catch { /* already closed */ }
      rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
    }
  })

  test("attempts.allocateAttempt: stale + empty ids -> STALE_AUTHORITY, zero mutation", async () => {
    const dir = mkdtempSync(join(tmpdir(), "unifia-stale-att-"))
    const path = join(dir, "a.sqlite")
    const attempts = new NativeAttemptAuthority({ databasePath: path, now })
    try {
      attempts.initialize()
      const db = new Database(path)
      const tokenA = claimAuthority(db, "run-1", "owner-a", now())
      db.close()
      const tokenB = takeover(path, tokenA, "owner-b")
      await expectStaleCode(() => attempts.allocateAttempt(tokenA, "", "eff"), "stale+empty-ids")
      expect(() => attempts.allocateAttempt(tokenB, "", "eff")).toThrow("required")
      expect(attempts.inspectAttempts("run-1", "")).toHaveLength(0)
      attempts.close()
    } finally {
      try { attempts.close() } catch { /* already closed */ }
      rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
    }
  })

  test("graph.decideIf: stale + family mismatch -> STALE_AUTHORITY, zero mutation", async () => {
    const dir = mkdtempSync(join(tmpdir(), "unifia-stale-graph-"))
    const path = join(dir, "g.sqlite")
    const engine = new GraphRuntimeEngine({ databasePath: path, definition: graphDefinition, now })
    try {
      engine.initialize()
      const tokenA = engine.claimAuthority("run-1", "owner-a")
      const tokenB = takeover(path, tokenA, "owner-b")
      await expectStaleCode(() => engine.decideIf("run-1", tokenA, "step-0", {}), "stale+family-mismatch")
      expect(() => engine.decideIf("run-1", tokenB, "step-0", {})).toThrow("not control.if")
      expect(engine.inspectEvents("run-1")).toHaveLength(0)
      engine.close()
    } finally {
      try { engine.close() } catch { /* already closed */ }
      rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
    }
  })

  test("approvals.request: stale + invalid binding -> STALE_AUTHORITY, zero mutation", async () => {
    const dir = mkdtempSync(join(tmpdir(), "unifia-stale-appr-"))
    const path = join(dir, "p.sqlite")
    const approvals = new NativeApprovalAuthority({ databasePath: path, now })
    try {
      approvals.initialize()
      approvals.claim("run-1", "owner-a")
      const tokenA: AuthorityToken = { workflowRunId: "run-1", generation: 1, authorityOwnerId: "owner-a" }
      const tokenB = takeover(path, tokenA, "owner-b")
      const broker = new ApprovalBrokerV4(approvals)
      const bad = { ...approvalBinding("run-1"), policyVersion: "", expiresAt: 20_000, requestGeneration: 1 }
      await expectStaleCode(() => broker.request(bad, tokenA), "stale+invalid-binding")
      await expect(broker.request(bad, tokenB)).rejects.toThrow("INVALID_BINDING")
      const good = await broker.request({ ...approvalBinding("run-1"), expiresAt: 20_000, requestGeneration: 1 }, tokenB)
      expect(good.ordinal).toBe(1)
      approvals.close()
    } finally {
      try { approvals.close() } catch { /* already closed */ }
      rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
    }
  })
})