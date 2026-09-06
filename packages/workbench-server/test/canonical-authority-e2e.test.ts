/* SPDX-License-Identifier: MIT */

import { describe, expect, test } from "bun:test"
import { Database } from "bun:sqlite"
import { mkdtempSync, rmSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import {
  ApprovalBrokerV4,
  ApprovalV4Error,
  GraphRuntimeEngine,
  NativeApprovalAuthority,
  NativeAttemptAuthority,
  NativeDurableHistoryAuthority,
  AuthorityError,
  takeoverAuthority,
  type ApprovalBinding,
  type AuthorityToken,
} from "@unifia/workflow-runtime"
import type { WorkflowRun } from "@unifia/contracts"
import { WorkbenchServer } from "../src/index.js"
import { NativeWorkflowRuntimePort } from "../src/native-workflow-port.js"

const now = () => 10_000
const scope = { organizationId: "org", workspaceId: "ws" }
const deployment = { ownershipScope: scope, environmentId: "test" }

const definition = {
  id: "canonical-authority-e2e",
  version: 1,
  workspaceId: "ws",
  steps: [{ id: "s0", capability: "workspace.read", input: {} }],
}

const graphDefinition = {
  definitionId: definition.id,
  ownershipScope: scope,
  displayName: definition.id,
  nodes: [{ id: "step-0", family: "tool.http" as const, config: { capability: "workspace.read", input: {} } }],
  edges: [],
  concurrency: { kind: "single" as const },
  defaultFailurePolicy: { kind: "propagate" as const },
  defaultTimeoutMs: 0,
  createdAt: 0,
  updatedAt: 0,
}

function run(runId: string): WorkflowRun {
  return {
    runId,
    deploymentId: "dep-1",
    workflowVersionId: "ver-1",
    deploymentScope: deployment,
    triggerId: "trig-1",
    triggerEventId: "evt-1",
    durableAuthorityId: runId,
    durableAuthorityKind: "native",
    status: "running",
    createdAt: 100,
    updatedAt: 100,
  }
}

function binding(runId: string, invocation: string): ApprovalBinding {
  return {
    workflowRunId: runId,
    logicalInvocationId: invocation,
    executionPlanDigest: "plan-digest",
    requesterPrincipalId: "requester",
    ownershipScope: scope,
    deploymentScope: deployment,
    capabilityRefs: ["workspace.read"],
    resourceScope: ["workspace:ws"],
    policyDecisionRef: "policy-1",
    policyVersion: "policy-v1",
  }
}

async function expectStale(action: () => unknown, label: string): Promise<void> {
  try {
    await action()
  } catch (error) {
    expect(error).toBeInstanceOf(Error)
    expect((error as AuthorityError | ApprovalV4Error).code, label).toBe("STALE_AUTHORITY")
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

describe("canonical authority production path", () => {
  test("fences every native mutation across one HTTP-started run and SQLite file", async () => {
    const dir = mkdtempSync(join(tmpdir(), "unifia-authority-e2e-"))
    const path = join(dir, "workflow.sqlite")
    const port = new NativeWorkflowRuntimePort({ databasePath: path, now })
    const history = new NativeDurableHistoryAuthority({ databasePath: path, now })
    const attempts = new NativeAttemptAuthority({ databasePath: path, now })
    const approvals = new NativeApprovalAuthority({ databasePath: path, now })
    const graph = new GraphRuntimeEngine({ databasePath: path, definition: graphDefinition, now })
    const broker = new ApprovalBrokerV4(approvals)

    try {
      history.initialize()
      attempts.initialize()
      approvals.initialize()
      graph.initialize()
      const server = new WorkbenchServer({
        auth: { authenticate: async () => ({ id: "owner-a", kind: "human" }) as never },
        workspace: {} as never,
        runtime: {} as never,
        workflow: port,
        audit: { record: () => undefined },
        capability: { check: async () => "allow" },
      })

      const started = await server.fetch(new Request("http://127.0.0.1/v1/workflows", {
        method: "POST",
        headers: { authorization: "Bearer test", "content-type": "application/json" },
        body: JSON.stringify(definition),
      }))
      expect(started.status).toBe(201)
      const state = await started.json() as { workflowId: string; authorityToken: AuthorityToken }
      const runId = state.workflowId
      const tokenA = state.authorityToken

      history.register(run(runId))
      expect(history.claim(runId, "owner-a")).toEqual(tokenA)
      approvals.claim(runId, "owner-a")

      const tokenA4 = takeover(path, takeover(path, takeover(path, tokenA, "owner-a-2"), "owner-a-3"), "owner-a-4")
      expect(tokenA4.generation).toBe(4)
      const tokenB = takeover(path, tokenA4, "owner-b")
      expect(tokenB).toMatchObject({ workflowRunId: runId, generation: 5, authorityOwnerId: "owner-b" })
      const staleA = tokenA

      await expectStale(() => graph.setDeadline(runId, staleA, "step-0", 20_000), "graph")
      graph.setDeadline(runId, tokenB, "step-0", 20_000)

      await expectStale(() => history.transition(staleA, runId, { from: "running", to: "waiting", effectSlotId: "slot-a", occurredAt: 9_999, isCompensating: false }), "history transition")
      await expectStale(() => history.scheduleTimer(staleA, "timer-a", runId, 10_100, "allow"), "history timer")
      await history.transition(tokenB, runId, { from: "running", to: "waiting", effectSlotId: "slot-b", occurredAt: 10_000, isCompensating: false })
      await history.scheduleTimer(tokenB, "timer-b", runId, 10_100, "allow")
      history.markTimerFired(tokenB, runId, "timer-b", 10_100)
      expect(history.inspectTransitions(runId)).toHaveLength(1)
      expect(history.inspectTimers(runId)).toHaveLength(0)

      await expectStale(() => attempts.allocateAttempt(staleA, "li-a", "effect-a"), "attempt allocation")
      const attempt = attempts.allocateAttempt(tokenB, "li-b", "effect-b")
      attempts.recordAttemptOutcome(tokenB, "li-b", attempt.attemptId, "UNKNOWN_EXTERNAL_STATE", { ackLost: true })
      await expectStale(() => attempts.reconcileEffect(staleA, "effect-b", "SUCCEEDED"), "effect reconciliation")
      attempts.reconcileEffect(tokenB, "effect-b", "SUCCEEDED", { ok: true })
      expect(attempts.inspectEffect(runId, "effect-b")?.status).toBe("SUCCEEDED")

      const firstBinding = binding(runId, "li-approval-1")
      await expectStale(() => broker.request({ ...firstBinding, expiresAt: 20_000, requestGeneration: 5 }, staleA), "approval request")
      const first = await broker.request({ ...firstBinding, expiresAt: 20_000, requestGeneration: 5 }, tokenB)
      await expectStale(() => broker.resolve(first.approvalId, "APPROVED", { id: "approver", kind: "human" }, firstBinding, staleA), "approval resolve")
      expect((await broker.resolve(first.approvalId, "APPROVED", { id: "approver", kind: "human" }, firstBinding, tokenB)).state).toBe("APPROVED")

      const secondBinding = binding(runId, "li-approval-2")
      const second = await broker.request({ ...secondBinding, expiresAt: 20_000, requestGeneration: 5 }, tokenB)
      await expectStale(() => broker.cancel(second.approvalId, { id: "requester", kind: "human" }, staleA), "approval cancel")
      expect((await broker.cancel(second.approvalId, { id: "requester", kind: "human" }, tokenB)).state).toBe("CANCELLED")

      await expectStale(() => port.cancel(staleA), "workflow cancel")

      graph.close(); port.close(); history.close(); attempts.close(); approvals.close()
      const restartedPort = new NativeWorkflowRuntimePort({ databasePath: path, now })
      const restartedHistory = new NativeDurableHistoryAuthority({ databasePath: path, now })
      const restartedAttempts = new NativeAttemptAuthority({ databasePath: path, now })
      const restartedApprovals = new NativeApprovalAuthority({ databasePath: path, now })
      const restartedGraph = new GraphRuntimeEngine({ databasePath: path, definition: graphDefinition, now })
      restartedHistory.initialize(); restartedAttempts.initialize(); restartedApprovals.initialize(); restartedGraph.initialize()
      const restartedBroker = new ApprovalBrokerV4(restartedApprovals)
      const restartedServer = new WorkbenchServer({
        auth: { authenticate: async () => ({ id: "owner-b", kind: "human" }) as never },
        workspace: {} as never, runtime: {} as never, workflow: restartedPort,
        audit: { record: () => undefined }, capability: { check: async () => "allow" },
      })
      await expectStale(() => restartedGraph.setDeadline(runId, staleA, "step-0", 21_000), "restarted graph")
      restartedGraph.setDeadline(runId, tokenB, "step-0", 21_000)
      await expectStale(() => restartedAttempts.allocateAttempt(staleA, "li-restart", "effect-restart"), "restarted attempt")
      const restartedAttempt = restartedAttempts.allocateAttempt(tokenB, "li-restart", "effect-restart")
      restartedAttempts.recordAttemptOutcome(tokenB, "li-restart", restartedAttempt.attemptId, "SUCCEEDED", { result: { ok: true } })
      await expectStale(() => restartedBroker.request({ ...binding(runId, "li-restart-approval"), expiresAt: 20_000, requestGeneration: 5 }, staleA), "restarted approval")
      const restartedApproval = await restartedBroker.request({ ...binding(runId, "li-restart-approval"), expiresAt: 20_000, requestGeneration: 5 }, tokenB)
      expect(restartedApproval.state).toBe("PENDING")
      const cancelled = await restartedServer.fetch(new Request(`http://127.0.0.1/v1/workflows/${runId}/cancel`, {
        method: "POST",
        headers: { authorization: "Bearer test", "x-workflow-authority-token": JSON.stringify(tokenB) },
      }))
      expect(cancelled.status).toBe(200)
      expect((await cancelled.json() as { status: string }).status).toBe("cancelled")

      const db = new Database(path)
      try {
        expect(db.query("SELECT COUNT(*) AS count FROM workflow_authority WHERE run_id = ?").get(runId)).toEqual({ count: 1 })
        expect(db.query("SELECT generation, owner_id FROM workflow_authority WHERE run_id = ?").get(runId)).toEqual({ generation: 5, owner_id: "owner-b" })
      } finally {
        db.close()
      }
      restartedGraph.close()
      restartedPort.close()
      restartedHistory.close()
      restartedAttempts.close()
      restartedApprovals.close()
    } finally {
      Bun.gc(true)
      await new Promise((resolve) => setTimeout(resolve, 100))
      rmSync(dir, { recursive: true, force: true, maxRetries: 30, retryDelay: 100 })
    }
  })
})
