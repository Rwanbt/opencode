/* SPDX-License-Identifier: MIT */
import { describe, expect, it } from "vitest"
import { mkdtempSync, rmSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { WorkbenchServer } from "../src/index.js"
import { NativeWorkflowRuntimePort } from "../src/native-workflow-port.js"

describe("durable workflow HTTP surface (directive 35)", () => {
  it("start/resume/cancel/inspect through the substrate-backed port over HTTP", async () => {
    const dir = mkdtempSync(join(tmpdir(), "wf-http-"))
    try {
      const port = new NativeWorkflowRuntimePort({ databasePath: join(dir, "wf.sqlite"), now: () => 1000 })
      const server = new WorkbenchServer({
        auth: { authenticate: async () => ({ id: "u1", kind: "human" }) as never },
        workspace: {} as never,
        runtime: {} as never,
        workflow: port,
        audit: { record: () => undefined },
        capability: { check: async () => "allow" },
      })
      const definition = { id: "wf-http-1", version: 1, workspaceId: "ws", steps: [ { id: "s0", capability: "workspace.read", input: {} } ] }
      const started = await server.fetch(new Request("http://127.0.1/v1/workflows", {
        method: "POST", headers: { authorization: "Bearer t", "content-type": "application/json" }, body: JSON.stringify(definition),
      }))
      expect(started.status).toBe(201)
      const startedBody = await started.json() as { workflowId: string }
      const inspected = await server.fetch(new Request(`http://127.0.1/v1/workflows/${startedBody.workflowId}`, { headers: { authorization: "Bearer t" } }))
      expect(inspected.status).toBe(200)
      const inspectedBody = await inspected.json()
      expect(inspectedBody.versionId).toBeDefined(); expect(inspectedBody.versionDigest).toBeDefined()
      expect(Array.isArray(inspectedBody.events)).toBe(true)
      const cancelled = await server.fetch(new Request(`http://127.0.1/v1/workflows/${startedBody.workflowId}/cancel`, {
        method: "POST", headers: { authorization: "Bearer t" }
      }))
      expect(cancelled.status).toBe(200)
      const cancelledBody = await cancelled.json()
      expect(cancelledBody.status).toBe("cancelled")
      port.close()
    } finally {
      Bun.gc(true)
      await new Promise((resolve) => setTimeout(resolve, 100))
      rmSync(dir, { recursive: true, force: true, maxRetries: 30, retryDelay: 100 })
    }
  })
})
