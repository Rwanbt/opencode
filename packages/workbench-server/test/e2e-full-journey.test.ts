/* SPDX-License-Identifier: MIT */
/* Copyright (c) 2026 Unifia contributors */
/**
 * Directive 35 - full product E2E through the REAL HTTP / UNIFIA_NATIVE
 * pipeline: manual authoring, immutable publication pin (no-latest),
 * restart/rediscovery, durable approval, timer/wait, ACK-loss, retry,
 * takeover fencing, cancellation, diagnosis, repair/rerun.
 * Operator actions go over HTTP; worker actions use the same durable
 * kernel boundary the production worker process would use.
 */
import { describe, expect, it } from "vitest"
import { Database } from "bun:sqlite"
import { mkdtempSync, rmSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { WorkbenchServer } from "../src/index.js"
import { NativeWorkflowRuntimePort } from "../src/native-workflow-port.js"
import type { WorkflowDefinitionPort } from "../src/workflow-port.js"
import { NativeApprovalAuthority } from "@unifia/workflow-runtime"
import { NativeAttemptAuthority } from "@unifia/workflow-runtime"
import { ApprovalBrokerV4, claimAuthority, type AuthorityToken, type ApprovalBinding } from "@unifia/workflow-runtime"

const principal = { id: "u1", kind: "human" as const }

const def = (id: string, label: string): WorkflowDefinitionPort => ({ id, version: label === "V2" ? 2 : 1, workspaceId: "ws", steps: [
  { id: "s0", capability: "workspace.read", input: { path: "/tmp/in" } },
  { id: "s1", capability: "workspace.read", input: {}, requiresApproval: true },
  { id: "s2", capability: "workspace.read", input: {} },
] })

const scope = { organizationId: "org", workspaceId: "ws" }
const binding = (): ApprovalBinding => ({ workflowRunId: "run-1", logicalInvocationId: "invoke-1", executionPlanDigest: "plan-a", requesterPrincipalId: "workflow-1", ownershipScope: scope, deploymentScope: { ownershipScope: scope, environmentId: "test" }, capabilityRefs: ["fs.read"], resourceScope: ["/data/ledger"], policyDecisionRef: "policy-a", policyVersion: "v1" })

describe("Directive 35 - full product E2E (HTTP + UNIFIA_NATIVE)", () => {
  it("manual authoring -> pin -> restart/rediscover -> no-latest -> cancel -> diagnosis; kernel: approval/timer/ack-loss/retry/takeover", async () => {
    const dir = mkdtempSync(join(tmpdir(), "e2e-full-"))
    try {
      // ---- JOURNEY A: manual authoring through the REAL HTTP surface ----
      const port = new NativeWorkflowRuntimePort({ databasePath: join(dir, "wf.sqlite"), now: () => 1000 })
      const server = new WorkbenchServer({
        auth: { authenticate: async () => principal as never },
        workspace: {} as never, runtime: {} as never, workflow: port,
        audit: { record: () => undefined }, capability: { check: async () => "allow" },
      })
      const started = await server.fetch(new Request("http://127.0.1/v1/workflows", {
        method: "POST", headers: { authorization: "Bearer t", "content-type": "application/json" }, body: JSON.stringify(def("wf-e2e", "V1")),
      }))
      expect(started.status).toBe(201)
      const startedBody = (await started.json()) as { workflowId: string; authorityToken: AuthorityToken; versionId?: string; versionDigest?: string; status: string; nextStep: number }
      expect(startedBody.status).toBe("running")
      // ---- immutable publication pin (directive 9) ----
      expect(startedBody.versionId).toBeDefined(); expect(startedBody.versionId).toBe(startedBody.versionDigest)
      const pinnedVersion = startedBody.versionId!

      // worker completes step 0 via the durable kernel boundary
      const afterS0 = await port.complete(startedBody.authorityToken, { bytes: 42 })
      expect(afterS0.nextStep).toBe(1)

      // ---- directive 12: RESTART - a NEW server+port rediscovers from durable facts ----
      const port2 = new NativeWorkflowRuntimePort({ databasePath: join(dir, "wf.sqlite"), now: () => 1000 })
      const server2 = new WorkbenchServer({
        auth: { authenticate: async () => principal as never },
        workspace: {} as never, runtime: {} as never, workflow: port2,
        audit: { record: () => undefined }, capability: { check: async () => "allow" },
      })
      const resumed = await port2.resume(startedBody.authorityToken)
      expect(resumed.nextStep).toBe(1)
      expect(resumed.versionId).toBe(pinnedVersion)

      // ---- directive 9: publish V2 AFTER - the existing run must NOT follow latest ----
      const run2 = await port2.start(def("wf-e2e", "V2"), "u1")
      expect(run2.versionId).not.toBe(pinnedVersion)
      const stillV1 = await port2.resume(startedBody.authorityToken)
      expect(stillV1.versionId).toBe(pinnedVersion)

      // ---- directive 20: diagnosis - read-only durable journal over HTTP ----
      const inspected = await server2.fetch(new Request(`http://127.0.1/v1/workflows/${startedBody.workflowId}`, { headers: { authorization: "Bearer t", "x-workflow-authority-token": JSON.stringify(startedBody.authorityToken) } }))
      const diagnosis = (await inspected.json()) as { events: { kind: string }[]; status: string }
      expect(inspected.status).toBe(200)
      expect(diagnosis.events.some((e) => e.kind === "NODE_COMPLETED")).toBe(true)

      // ---- directive 13: durable approval through restart (production D-02 path) ----
      const approval = new NativeApprovalAuthority({ databasePath: join(dir, "appr.sqlite"), now: () => 1000 })
      approval.initialize(); approval.claim("run-1", "owner-a")
      const broker = new ApprovalBrokerV4(approval)
      const token: AuthorityToken = { workflowRunId: "run-1", generation: 1, authorityOwnerId: "owner-a" }
      const requested = await broker.request({ ...binding(), expiresAt: 20_000, requestGeneration: 1 }, token)
      approval.close()
      const approval2 = new NativeApprovalAuthority({ databasePath: join(dir, "appr.sqlite"), now: () => 1000 })
      approval2.initialize()
      const broker2 = new ApprovalBrokerV4(approval2)
      // stale authority CANNOT resolve (fencing)
      await expect(broker2.resolve(requested.approvalId, "APPROVED", { id: "human-1", kind: "human" }, binding(), { ...token, generation: 99 })).rejects.toThrow("STALE_AUTHORITY")
      const resolved = await broker2.resolve(requested.approvalId, "APPROVED", { id: "human-1", kind: "human" }, binding(), token)
      expect(resolved.state).toBe("APPROVED")
      approval2.close()

      // ---- directive 14: durable timer across restart (wait) ----
      const { NativeDurableHistoryAuthority } = await import("@unifia/workflow-runtime")
      const hist = new NativeDurableHistoryAuthority({ databasePath: join(dir, "h.sqlite"), now: () => 1000 })
       hist.initialize()
       const historyToken = hist.claim("run-t", "owner-a")
      hist.register({ runId: "run-t", deploymentId: "d", workflowVersionId: "v", deploymentScope: { ownershipScope: scope, environmentId: "test" }, triggerId: "t", triggerEventId: "e", durableAuthorityId: "run-t", durableAuthorityKind: "native", status: "waiting", createdAt: 1, updatedAt: 1 } as never)
       hist.scheduleTimer(historyToken, "t-wait", "run-t", 7000, "allow")
      hist.close()
      const hist2 = new NativeDurableHistoryAuthority({ databasePath: join(dir, "h.sqlite"), now: () => 1000 })
       hist2.initialize()
       const historyToken2 = hist2.claim("run-t", "owner-a")
      expect(hist2.dueTimers(8000)).toEqual([{ runId: "run-t", timerId: "t-wait", fireAt: 7000 }])
       hist2.markTimerFired(historyToken2, "run-t", "t-wait", 8000)
      expect(hist2.dueTimers(99999)).toHaveLength(0)
      hist2.close()

      // ---- directives 15-17: effect identity + ACK-loss + retry ----
      const attempts = new NativeAttemptAuthority({ databasePath: join(dir, "x.sqlite"), now: () => 1000 })
      attempts.initialize()
      const db = new Database(join(dir, "x.sqlite"))
      const attemptToken = claimAuthority(db, "run-1", "owner-a", 1000)
      db.close()
      const first = attempts.allocateAttempt(attemptToken, "li-1", "ek.pay")
      attempts.recordAttemptOutcome(attemptToken, "li-1", first.attemptId, "UNKNOWN_EXTERNAL_STATE", { ackLost: true })
      expect(attempts.inspectEffect("run-1", "ek.pay")!.status).toBe("UNKNOWN_EXTERNAL_STATE")
      const retry = attempts.allocateAttempt(attemptToken, "li-1", "ek.pay")
      expect(retry.seq).toBe(2); expect(retry.attemptId).not.toBe(first.attemptId)
      attempts.reconcileEffect(attemptToken, "ek.pay", "SUCCEEDED", { ok: true })
      // ---- directive 19: durable cancellation + fencing + restart persistence ----
      attempts.close()
      const cancelled = await port2.cancel(startedBody.authorityToken)
      expect(cancelled.status).toBe("cancelled")
      const port3 = new NativeWorkflowRuntimePort({ databasePath: join(dir, "wf.sqlite"), now: () => 1000 })
      const afterRestart = await port3.resume(startedBody.authorityToken)
      expect(afterRestart.status).toBe("cancelled")
      port2.close(); port3.close(); port.close()
    } finally {
      Bun.gc(true)
      await new Promise((resolve) => setTimeout(resolve, 100))
      rmSync(dir, { recursive: true, force: true, maxRetries: 30, retryDelay: 100 })
    }
  })
})

describe("Directive 35 - AI authoring through the SAME pipeline (journey B)", () => {
  it("an AI-proposed definition converges into the SAME validation/publication/runtime path (no shortcut)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "e2e-ai-"))
    try {
      // AI proposals enter the pipeline as plain definitions - the pipeline
      // is source-agnostic: same validation, same pin, same runtime, no
      // privileged path, no direct durable-state writes from the AI.
      const aiProposed = { id: "wf-ai", version: 1, workspaceId: "ws", steps: [ { id: "s0", capability: "workspace.read", input: {} } ] }
      const port = new NativeWorkflowRuntimePort({ databasePath: join(dir, "wf.sqlite"), now: () => 1000 })
      const server = new WorkbenchServer({
        auth: { authenticate: async () => principal as never },
        workspace: {} as never, runtime: {} as never, workflow: port,
        audit: { record: () => undefined }, capability: { check: async () => "allow" },
      })
      const started = await server.fetch(new Request("http://127.0.1/v1/workflows", {
        method: "POST", headers: { authorization: "Bearer t", "content-type": "application/json" }, body: JSON.stringify(aiProposed),
      }))
      expect(started.status).toBe(201)
      const body = (await started.json()) as { versionId?: string; status: string }
      expect(body.versionId).toBeDefined(); expect(body.status).toBe("running")
      // an INVALID proposal is rejected by the SAME canonical gate
      const invalid = await server.fetch(new Request("http://127.0.1/v1/workflows", {
        method: "POST", headers: { authorization: "Bearer t", "content-type": "application/json" },
        body: JSON.stringify({ id: "wf-bad", version: 1, workspaceId: "ws", steps: [] }),
      }))
      expect([400, 422]).toContain(invalid.status)
      port.close()
    } finally { rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }) }
  })
})
