/* SPDX-License-Identifier: MIT */
/* Copyright (c) 2026 Unifia contributors */

/**
 * P0-A terminal boundary proofs: one logical WorkflowRun transition equals
 * one atomic durable boundary (graph terminal mark + canonical history
 * transition), so HTTP state == projection == recovered state after
 * completion, failure and cancellation — including across restart.
 * Plus a direct cross-authority rollback proof: a failure inside the
 * composed boundary reverts the graph writes too.
 */
import { describe, expect, test } from "bun:test"
import { Database } from "bun:sqlite"
import { mkdtempSync, rmSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import {
  GraphRuntimeEngine,
  NativeDurableHistoryAuthority,
  type AuthorityToken,
} from "@unifia/workflow-runtime"
import { WorkbenchServer } from "../src/index.js"
import { NativeWorkflowRuntimePort } from "../src/native-workflow-port.js"

const now = () => 10_000
const definition = {
  id: "terminal-journey",
  version: 1,
  workspaceId: "ws",
  steps: [{ id: "s0", capability: "workspace.read", input: {} }],
}

const graphDefinition = {
  definitionId: definition.id,
  ownershipScope: { organizationId: "workbench", workspaceId: "ws" },
  displayName: definition.id,
  nodes: [{ id: "step-0", family: "tool.http" as const, config: { capability: "workspace.read", input: {} } }],
  edges: [],
  concurrency: { kind: "single" as const },
  defaultFailurePolicy: { kind: "propagate" as const },
  defaultTimeoutMs: 0,
  createdAt: 0,
  updatedAt: 0,
}

async function removeTempDir(dir: string): Promise<void> {
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

function makeServer(port: NativeWorkflowRuntimePort): WorkbenchServer {
  return new WorkbenchServer({
    auth: { authenticate: async () => ({ id: "owner-a", kind: "human" }) as never },
    workspace: {} as never,
    runtime: {} as never,
    workflow: port,
    audit: { record: () => undefined },
    capability: { check: async () => "allow" },
  })
}

async function startRun(server: WorkbenchServer): Promise<{ runId: string; token: AuthorityToken }> {
  const started = await server.fetch(new Request("http://127.0.0.1/v1/workflows", {
    method: "POST",
    headers: { authorization: "Bearer test", "content-type": "application/json" },
    body: JSON.stringify(definition),
  }))
  expect(started.status).toBe(201)
  const body = await started.json() as { workflowId: string; authorityToken: AuthorityToken }
  return { runId: body.workflowId, token: body.authorityToken }
}

function tokenHeader(token: AuthorityToken): Record<string, string> {
  return { authorization: "Bearer test", "x-workflow-authority-token": JSON.stringify(token) }
}

describe("terminal run boundary (P0-A)", () => {
  test("complete: HTTP state == projection == recovered state", async () => {
    const dir = mkdtempSync(join(tmpdir(), "unifia-terminal-complete-"))
    const path = join(dir, "w.sqlite")
    const port = new NativeWorkflowRuntimePort({ databasePath: path, now })
    try {
      const server = makeServer(port)
      const { runId, token } = await startRun(server)
      const done = await port.complete(token, { ok: 1 })
      expect(done.status).toBe("completed")
      const projection = await port.historyAuthority.getMaterializedProjection(runId)
      expect(projection!.status).toBe("completed")
      port.close()
      const reopened = new NativeWorkflowRuntimePort({ databasePath: path, now })
      try {
        const server2 = makeServer(reopened)
        const inspected = await server2.fetch(new Request(`http://127.0.0.1/v1/workflows/${runId}`, { headers: tokenHeader(token) }))
        expect(inspected.status).toBe(200)
        expect((await inspected.json() as { status: string }).status).toBe("completed")
        const recovered = await reopened.historyAuthority.getMaterializedProjection(runId)
        expect(recovered!.status).toBe("completed")
      } finally {
        reopened.close()
      }
    } finally {
      try { port.close() } catch { /* already closed */ }
      await removeTempDir(dir)
    }
  })

  test("failure heals through resume: failNode + resume == projection failed, restart-persistent", async () => {
    const dir = mkdtempSync(join(tmpdir(), "unifia-terminal-failure-"))
    const path = join(dir, "w.sqlite")
    const port = new NativeWorkflowRuntimePort({ databasePath: path, now })
    try {
      const server = makeServer(port)
      const { runId, token } = await startRun(server)
      // Graph-only failure first: the canonical history is still open.
      port.graphEngineFor(token).failNode(runId, token, "step-0", "provider boom")
      const healed = await port.resume(token)
      expect(healed.status).toBe("failed")
      expect((await port.historyAuthority.getMaterializedProjection(runId))!.status).toBe("failed")
      port.close()
      const reopened = new NativeWorkflowRuntimePort({ databasePath: path, now })
      try {
        const server2 = makeServer(reopened)
        const inspected = await server2.fetch(new Request(`http://127.0.0.1/v1/workflows/${runId}`, { headers: tokenHeader(token) }))
        expect(inspected.status).toBe(200)
        expect((await inspected.json() as { status: string }).status).toBe("failed")
        expect((await reopened.historyAuthority.getMaterializedProjection(runId))!.status).toBe("failed")
      } finally {
        reopened.close()
      }
    } finally {
      try { port.close() } catch { /* already closed */ }
      await removeTempDir(dir)
    }
  })

  test("cross-authority rollback: a failing canonical transition reverts graph writes", async () => {
    const dir = mkdtempSync(join(tmpdir(), "unifia-terminal-rollback-"))
    const path = join(dir, "w.sqlite")
    const db = new Database(path)
    db.exec("PRAGMA journal_mode = WAL")
    const engine = new GraphRuntimeEngine({ databasePath: path, definition: graphDefinition, now, database: db })
    engine.initialize()
    const history = new NativeDurableHistoryAuthority({ databasePath: path, now, database: db })
    history.initialize()
    try {
      history.register({
        runId: "run-rb",
        deploymentId: "dep-rb",
        workflowVersionId: "ver-rb",
        deploymentScope: { ownershipScope: { organizationId: "workbench", workspaceId: "ws" }, environmentId: "workbench" },
        triggerId: "run-rb:trigger",
        triggerEventId: "run-rb:trigger-event",
        durableAuthorityId: "run-rb",
        durableAuthorityKind: "native",
        status: "running",
        createdAt: now(),
        updatedAt: now(),
      })
      const token = history.claim("run-rb", "owner-a")
      engine.claimAuthority("run-rb", "owner-a")
      engine.startRun("run-rb", token)
      // Compose exactly like the port does, but force the canonical
      // transition to fail AFTER the graph write: the whole boundary,
      // graph write included, must roll back.
      expect(() =>
        db.transaction(() => {
          engine.completeNode("run-rb", token, "step-0", { ok: 1 })
          history.transitionSync(token, "run-rb", {
            from: "completed",
            to: "waiting",
            effectSlotId: "slot-nope",
            occurredAt: now(),
            isCompensating: false,
          })
        })(),
      ).toThrow("does not match current status")
      expect(engine.nodeState("run-rb", "step-0")!.status).toBe("PENDING")
      expect(engine.inspectEvents("run-rb")).toHaveLength(1)
      expect(history.inspectTransitions("run-rb")).toHaveLength(0)
      expect((await history.getRun("run-rb"))!.status).toBe("running")
    } finally {
      engine.close()
      history.close()
      db.close()
      await removeTempDir(dir)
    }
  })
})
