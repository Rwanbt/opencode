/* SPDX-License-Identifier: MIT */

// C1-1: the client's real header set and the server's real preflight
// response are measured independently, then cross-checked. Hardcoding an
// expected header list here would recreate the exact drift this test
// exists to catch (see C2-1's warning against hardcoding the three
// missing headers instead of deriving both sides from one source).

import { describe, expect, it } from "vitest"
import { WorkbenchClient, WorkbenchEventDispatcher } from "@unifia/workbench-shell"
import { WorkbenchServer } from "../src/index.js"

// The four real Tauri v2 desktop origins this branch must support (audit
// FUNC-002). Only two of these currently pass; that gap is the point of
// this red test.
const SUPPORTED_ORIGINS = ["http://tauri.localhost", "https://tauri.localhost", "tauri://localhost", "http://ipc.localhost"] as const

async function captureClientRequestHeaders(): Promise<ReadonlySet<string>> {
  const seen = new Set<string>()

  const client = new WorkbenchClient({
    baseUrl: "http://origin-under-test",
    instanceId: "test-instance",
    token: { current: () => "test-token", refresh: async () => "test-token" },
    fetchImpl: (async (input: RequestInfo | URL, init?: RequestInit) => {
      for (const key of Object.keys((init?.headers as Record<string, string> | undefined) ?? {})) seen.add(key.toLowerCase())
      if (String(input).includes("/v1/handshake")) {
        return new Response(
          JSON.stringify({ kind: "workbench.handshake.accepted", accepted: true, protocolVersion: 1, supportedVersions: [1], instanceId: "test-instance" }),
          { status: 200 },
        )
      }
      return new Response("{}", { status: 200 })
    }) as unknown as typeof fetch,
  })

  // Every public request-issuing method of WorkbenchClient, so a header
  // added to only one endpoint is still caught.
  await client.handshake()
  await client.listFiles("ws-1")
  await client.searchFiles("ws-1", "query")
  await client.readFiles("ws-1", ["a.txt"])
  await client.listDesignSystems("ws-1")
  await client.listArtifacts("ws-1")
  await client.getArtifact("ws-1", "artifact-1")
  await client.createArtifact({ workspaceId: "ws-1", kind: "text", filename: "a.txt", content: "" })
  await client.listDocuments("ws-1")
  await client.trace("ws-1")
  await client.activity("ws-1")
  await client.listApprovals("ws-1")
  await client.searchCapabilities("ws-1")
  await client.exportArtifact("ws-1", "artifact-1")
  await client.resolveApproval("approval-1", "allow")
  await client.cancelApproval("approval-1")
  await client.startWorkflow("ws-1", { id: "wf-1", version: 1, steps: [] })
  await client.validateSpec("ws-1", "{}")
  await client.updateWorkflow("wf-1", "resume")
  await client.events("ws-1", new WorkbenchEventDispatcher()).next().catch(() => undefined)

  return seen
}

describe("workbench CORS contract: client headers vs server preflight", () => {
  it.each(SUPPORTED_ORIGINS)("origin %s gets a 204 preflight covering every header the client actually sends", async (origin) => {
    const clientHeaders = await captureClientRequestHeaders()
    expect(clientHeaders.size).toBeGreaterThan(0)

    const server = new WorkbenchServer({
      auth: { authenticate: async () => undefined },
      workspace: {} as never,
      runtime: {} as never,
      audit: { record: () => undefined },
      capability: { check: async () => "deny" },
    })

    const response = await server.fetch(
      new Request("http://127.0.0.1/v1/workspaces", {
        method: "OPTIONS",
        headers: { origin, "access-control-request-method": "POST", "access-control-request-headers": [...clientHeaders].join(",") },
      }),
    )

    const allowed = (response.headers.get("access-control-allow-headers") ?? "").toLowerCase().split(",").map((header) => header.trim())
    const missing = [...clientHeaders].filter((header) => !allowed.includes(header))

    expect({ origin, status: response.status, missing }).toEqual({ origin, status: 204, missing: [] })
  })
})
