/* SPDX-License-Identifier: MIT */
/* Copyright (c) 2026 Unifia contributors */

/**
 * P1 #44 production proof: multi-run isolation and immutable version pinning
 * through the HTTP/runtime path (not only direct class calls).
 *
 * POST Definition A/V1 -> R1, POST Definition A/V1 -> R2 (distinct runs,
 * same pinned V1), publish/start A/V2 -> R3. Cancel R1: R2/R3 keep
 * running. Restart the port: R1 still cancelled+V1, R2 still running+V1,
 * R3 still running+V2.
 */
import { describe, expect, test } from "bun:test"
import { Database } from "bun:sqlite"
import { mkdtempSync, rmSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import type { AuthorityToken } from "@unifia/workflow-runtime"
import { WorkbenchServer } from "../src/index.js"
import { NativeWorkflowRuntimePort } from "../src/native-workflow-port.js"

const now = () => 10_000

function definition(version: number) {
  return {
    id: "versioned-automate",
    version,
    workspaceId: "ws",
    steps: [{ id: "s0", capability: "workspace.read", input: {} }],
  }
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

async function start(server: WorkbenchServer, version: number): Promise<{ runId: string; token: AuthorityToken; versionId: string }> {
  const res = await server.fetch(new Request("http://127.0.0.1/v1/workflows", {
    method: "POST",
    headers: { authorization: "Bearer test", "content-type": "application/json" },
    body: JSON.stringify(definition(version)),
  }))
  expect(res.status).toBe(201)
  const body = await res.json() as { workflowId: string; authorityToken: AuthorityToken; versionId: string }
  return { runId: body.workflowId, token: body.authorityToken, versionId: body.versionId }
}

async function inspectStatus(server: WorkbenchServer, runId: string, token: AuthorityToken): Promise<{ status: string; versionId: string }> {
  const res = await server.fetch(new Request(`http://127.0.0.1/v1/workflows/${runId}`, {
    headers: { authorization: "Bearer test", "x-workflow-authority-token": JSON.stringify(token) },
  }))
  expect(res.status).toBe(200)
  return await res.json() as { status: string; versionId: string }
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

describe("multi-run version pin over HTTP (#44)", () => {
  test("R1/R2 share V1, R3 pins V2, cancel is isolated, restart preserves pins", async () => {
    const dir = mkdtempSync(join(tmpdir(), "unifia-versions-http-"))
    const path = join(dir, "w.sqlite")
    const port = new NativeWorkflowRuntimePort({ databasePath: path, now })
    try {
      const server = makeServer(port)
      const r1 = await start(server, 1)
      const r2 = await start(server, 1)
      expect(r1.runId).not.toBe(r2.runId)
      expect(r2.versionId).toBe(r1.versionId)
      const v1 = r1.versionId
      const r3 = await start(server, 2)
      expect(r3.versionId).not.toBe(v1)
      const v2 = r3.versionId

      expect((await inspectStatus(server, r1.runId, r1.token)).versionId).toBe(v1)
      expect((await inspectStatus(server, r2.runId, r2.token)).versionId).toBe(v1)
      expect((await inspectStatus(server, r3.runId, r3.token)).versionId).toBe(v2)

      // Cancel R1 only: R2/R3 keep running (isolation through HTTP).
      const cancelled = await server.fetch(new Request(`http://127.0.0.1/v1/workflows/${r1.runId}/cancel`, {
        method: "POST",
        headers: { authorization: "Bearer test", "x-workflow-authority-token": JSON.stringify(r1.token) },
      }))
      expect(cancelled.status).toBe(200)
      expect((await inspectStatus(server, r1.runId, r1.token)).status).toBe("cancelled")
      expect((await inspectStatus(server, r2.runId, r2.token)).status).toBe("running")
      expect((await inspectStatus(server, r3.runId, r3.token)).status).toBe("running")
      port.close()

      // Restart: pins and states survive on durable facts alone.
      const reopened = new NativeWorkflowRuntimePort({ databasePath: path, now })
      try {
        const server2 = makeServer(reopened)
        const s1 = await inspectStatus(server2, r1.runId, r1.token)
        expect(s1.status).toBe("cancelled")
        expect(s1.versionId).toBe(v1)
        const s2 = await inspectStatus(server2, r2.runId, r2.token)
        expect(s2.status).toBe("running")
        expect(s2.versionId).toBe(v1)
        const s3 = await inspectStatus(server2, r3.runId, r3.token)
        expect(s3.status).toBe("running")
        expect(s3.versionId).toBe(v2)
      } finally {
        reopened.close()
      }

      const db = new Database(path)
      try {
        expect(db.query("SELECT COUNT(*) AS count FROM workflow_runs").get()).toEqual({ count: 3 })
        expect(db.query("SELECT COUNT(*) AS count FROM workflow_versions").get()).toEqual({ count: 2 })
      } finally {
        db.close()
      }
    } finally {
      try { port.close() } catch { /* already closed */ }
      await removeTempDir(dir)
    }
  })
})
