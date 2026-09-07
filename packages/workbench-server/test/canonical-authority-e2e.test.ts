/* SPDX-License-Identifier: MIT */

import { describe, expect, test } from "bun:test"
import { Database } from "bun:sqlite"
import { mkdtempSync, rmSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import {
  ApprovalBrokerV4,
  type ApprovalV4Error,
  type AuthorityError,
  type ApprovalBinding,
  type AuthorityToken,
} from "@unifia/workflow-runtime"
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

async function removeTempDir(dir: string): Promise<void> {
  // Windows can keep SQLite file locks briefly after close; retry the
  // teardown instead of failing the gate on an environmental EBUSY.
  for (let attempt = 0; attempt < 12; attempt++) {
    try {
      rmSync(dir, { recursive: true, force: true })
      return
    } catch {
      Bun.gc(true)
      await new Promise((resolve) => setTimeout(resolve, 250))
    }
  }
  rmSync(dir, { recursive: true, force: true })
}

function makeServer(port: NativeWorkflowRuntimePort, owner: string): WorkbenchServer {
  return new WorkbenchServer({
    auth: { authenticate: async () => ({ id: owner, kind: "human" }) as never },
    workspace: {} as never,
    runtime: {} as never,
    workflow: port,
    audit: { record: () => undefined },
    capability: { check: async () => "allow" },
  })
}

describe("canonical authority production path", () => {
  test("fences every native mutation through the production port assembly", async () => {
    const dir = mkdtempSync(join(tmpdir(), "unifia-authority-e2e-"))
    const path = join(dir, "workflow.sqlite")
    // #47: the ONLY durable handles are the port's own assembly. Nothing
    // is constructed laterally on the same file — graph, history,
    // attempts and approvals all flow through `port`.
    const port = new NativeWorkflowRuntimePort({ databasePath: path, now })

    try {
      const server = makeServer(port, "owner-a")

      const started = await server.fetch(new Request("http://127.0.0.1/v1/workflows", {
        method: "POST",
        headers: { authorization: "Bearer test", "content-type": "application/json" },
        body: JSON.stringify(definition),
      }))
      expect(started.status).toBe(201)
      const state = await started.json() as { workflowId: string; authorityToken: AuthorityToken }
      const runId = state.workflowId
      const tokenA = state.authorityToken
      expect(tokenA).toMatchObject({ workflowRunId: runId, generation: 1, authorityOwnerId: "owner-a" })

      // Exactly one shared authority row after the HTTP start.
      const db = new Database(path)
      try {
        expect(db.query("SELECT COUNT(*) AS count FROM workflow_authority WHERE run_id = ?").get(runId)).toEqual({ count: 1 })
        expect(db.query("SELECT generation, owner_id FROM workflow_authority WHERE run_id = ?").get(runId)).toEqual({ generation: 1, owner_id: "owner-a" })
      } finally {
        db.close()
      }

      const broker = new ApprovalBrokerV4(port.approvalAuthority)
      const history = port.historyAuthority
      const attempts = port.attemptAuthority

      const tokenA4 = port.takeover(port.takeover(port.takeover(tokenA, "owner-a-2"), "owner-a-3"), "owner-a-4")
      expect(tokenA4.generation).toBe(4)
      const tokenB = port.takeover(tokenA4, "owner-b")
      expect(tokenB).toMatchObject({ workflowRunId: runId, generation: 5, authorityOwnerId: "owner-b" })
      const staleA = tokenA

      // Graph through the assembly.
      await expectStale(() => port.graphEngineFor(staleA), "graph assembly")
      const engine = port.graphEngineFor(tokenB)
      await expectStale(() => engine.setDeadline(runId, staleA, "step-0", 20_000), "graph")
      engine.setDeadline(runId, tokenB, "step-0", 20_000)

      // History + timers through the assembly.
      await expectStale(() => history.transition(staleA, runId, { from: "running", to: "waiting", effectSlotId: "slot-a", occurredAt: 9_999, isCompensating: false }), "history transition")
      await expectStale(() => history.scheduleTimer(staleA, "timer-a", runId, 10_100, "allow"), "history timer")
      await history.transition(tokenB, runId, { from: "running", to: "waiting", effectSlotId: "slot-b", occurredAt: 10_000, isCompensating: false })
      await history.scheduleTimer(tokenB, "timer-b", runId, 10_100, "allow")
      history.markTimerFired(tokenB, runId, "timer-b", 10_100)
      expect(history.inspectTransitions(runId)).toHaveLength(1)
      expect(history.inspectTimers(runId)).toHaveLength(0)

      // Attempts + effects through the assembly.
      await expectStale(() => attempts.allocateAttempt(staleA, "li-a", "effect-a"), "attempt allocation")
      const attempt = attempts.allocateAttempt(tokenB, "li-b", "effect-b")
      attempts.recordAttemptOutcome(tokenB, "li-b", attempt.attemptId, "UNKNOWN_EXTERNAL_STATE", { ackLost: true })
      await expectStale(() => attempts.reconcileEffect(staleA, "effect-b", "SUCCEEDED"), "effect reconciliation")
      attempts.reconcileEffect(tokenB, "effect-b", "SUCCEEDED", { ok: true })
      expect(attempts.inspectEffect(runId, "effect-b")?.status).toBe("SUCCEEDED")

      // Approvals through the assembly.
      const firstBinding = binding(runId, "li-approval-1")
      await expectStale(() => broker.request({ ...firstBinding, expiresAt: 20_000, requestGeneration: 5 }, staleA), "approval request")
      const first = await broker.request({ ...firstBinding, expiresAt: 20_000, requestGeneration: 5 }, tokenB)
      await expectStale(() => broker.resolve(first.approvalId, "APPROVED", { id: "approver", kind: "human" }, firstBinding, staleA), "approval resolve")
      expect((await broker.resolve(first.approvalId, "APPROVED", { id: "approver", kind: "human" }, firstBinding, tokenB)).state).toBe("APPROVED")

      const secondBinding = binding(runId, "li-approval-2")
      const second = await broker.request({ ...secondBinding, expiresAt: 20_000, requestGeneration: 5 }, tokenB)
      await expectStale(() => broker.cancel(second.approvalId, { id: "requester", kind: "human" }, staleA), "approval cancel")
      expect((await broker.cancel(second.approvalId, { id: "requester", kind: "human" }, tokenB)).state).toBe("CANCELLED")

      // Cancel through the assembly: late A is fenced before any mutation.
      await expectStale(() => port.cancel(staleA), "workflow cancel")

      // Restart: a fresh port on the same file rediscovers the assembly.
      port.close()
      const restartedPort = new NativeWorkflowRuntimePort({ databasePath: path, now })
      const restartedBroker = new ApprovalBrokerV4(restartedPort.approvalAuthority)
      const restartedServer = makeServer(restartedPort, "owner-b")
      const restartedHistory = restartedPort.historyAuthority
      const restartedAttempts = restartedPort.attemptAuthority
      const restartedEngine = restartedPort.graphEngineFor(tokenB)
      await expectStale(() => restartedPort.graphEngineFor(staleA), "restarted graph assembly")
      await expectStale(() => restartedEngine.setDeadline(runId, staleA, "step-0", 21_000), "restarted graph")
      restartedEngine.setDeadline(runId, tokenB, "step-0", 21_000)
      await expectStale(() => restartedAttempts.allocateAttempt(staleA, "li-restart", "effect-restart"), "restarted attempt")
      const restartedAttempt = restartedAttempts.allocateAttempt(tokenB, "li-restart", "effect-restart")
      restartedAttempts.recordAttemptOutcome(tokenB, "li-restart", restartedAttempt.attemptId, "SUCCEEDED", { result: { ok: true } })
      await expectStale(() => restartedBroker.request({ ...binding(runId, "li-restart-approval"), expiresAt: 20_000, requestGeneration: 5 }, staleA), "restarted approval")
      const restartedApproval = await restartedBroker.request({ ...binding(runId, "li-restart-approval"), expiresAt: 20_000, requestGeneration: 5 }, tokenB)
      expect(restartedApproval.state).toBe("PENDING")
      // occurredAt stays within the frozen clock so the ONLY possible
      // failure is the authority fence itself.
      await expectStale(() => restartedHistory.transition(staleA, runId, { from: "waiting", to: "failed", effectSlotId: "slot-stale", occurredAt: 9_999, isCompensating: false }), "restarted history")
      // #47: the HTTP surface itself must surface the fence as a typed 409,
      // not only the in-process port boundary.
      const staleResume = await restartedServer.fetch(new Request(`http://127.0.0.1/v1/workflows/${runId}/resume`, { method: "POST", headers: { authorization: "Bearer test", "x-workflow-authority-token": JSON.stringify(staleA) } }))
      expect(staleResume.status).toBe(409)
      expect(((await staleResume.json()) as { error: string }).error).toBe("STALE_AUTHORITY")
      const staleCancel = await restartedServer.fetch(new Request(`http://127.0.0.1/v1/workflows/${runId}/cancel`, { method: "POST", headers: { authorization: "Bearer test", "x-workflow-authority-token": JSON.stringify(staleA) } }))
      expect(staleCancel.status).toBe(409)
      expect(((await staleCancel.json()) as { error: string }).error).toBe("STALE_AUTHORITY")
      const cancelled = await restartedServer.fetch(new Request(`http://127.0.0.1/v1/workflows/${runId}/cancel`, {
        method: "POST",
        headers: { authorization: "Bearer test", "x-workflow-authority-token": JSON.stringify(tokenB) },
      }))
      expect(cancelled.status).toBe(200)
      expect((await cancelled.json() as { status: string }).status).toBe("cancelled")
      // P0-A: cancellation is canonically durable, and survives reopen.
      expect((await restartedPort.historyAuthority.getMaterializedProjection(runId))!.status).toBe("cancelled")
      restartedPort.close()
      const reread = new NativeWorkflowRuntimePort({ databasePath: path, now })
      try {
        const rereadServer = makeServer(reread, "owner-b")
        const reinspected = await rereadServer.fetch(new Request(`http://127.0.0.1/v1/workflows/${runId}`, {
          headers: { authorization: "Bearer test", "x-workflow-authority-token": JSON.stringify(tokenB) },
        }))
        expect(reinspected.status).toBe(200)
        expect((await reinspected.json() as { status: string }).status).toBe("cancelled")
        expect((await reread.historyAuthority.getMaterializedProjection(runId))!.status).toBe("cancelled")
      } finally {
        reread.close()
      }

      const db2 = new Database(path)
      try {
        expect(db2.query("SELECT COUNT(*) AS count FROM workflow_authority WHERE run_id = ?").get(runId)).toEqual({ count: 1 })
        expect(db2.query("SELECT generation, owner_id FROM workflow_authority WHERE run_id = ?").get(runId)).toEqual({ generation: 5, owner_id: "owner-b" })
      } finally {
        db2.close()
      }
    } finally {
      Bun.gc(true)
      await new Promise((resolve) => setTimeout(resolve, 100))
      await removeTempDir(dir)
    }
  })
})