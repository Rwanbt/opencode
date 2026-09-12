/* SPDX-License-Identifier: MIT */

// C1-2: WORKBENCH_ROUTE_REGISTRY (client-declared contract) and
// WorkbenchClient's actual implementation are two independent sources that
// can drift from the real server route table. This test exercises both
// against a real WorkbenchServer instead of asserting on a third,
// hand-maintained list of "routes that should exist".
//
// #deny() shapes an unmatched route as `{ error: "denied", capability:
// "route.unknown" }` (src/index.ts) — the reason lives in `capability`, not
// `error`, which is always the literal string "denied".

import { describe, expect, it } from "vitest"
import { WORKBENCH_ROUTE_REGISTRY, WorkbenchClient, WorkbenchEventDispatcher } from "@unifia/workbench-shell"
import { WorkbenchServer } from "../src/index.js"

type Probe = { source: string; status: number; capability?: string }

function makeServer(): WorkbenchServer {
  return new WorkbenchServer({
    auth: { authenticate: async () => ({ id: "principal-1", scopes: new Set(), workspaces: "*" }) },
    workspace: {} as never,
    runtime: {} as never,
    audit: { record: () => undefined },
    capability: { check: async () => "deny" },
  })
}

function fillParams(route: string): string {
  return route.replace(/:([a-zA-Z]+)/g, "placeholder")
}

async function probe(results: Probe[], source: string, server: WorkbenchServer, request: Request): Promise<Response> {
  const response = await server.fetch(request)
  let capability: string | undefined
  try {
    const body = (await response.clone().json()) as { capability?: unknown }
    capability = typeof body?.capability === "string" ? body.capability : undefined
  } catch {
    // non-JSON body (e.g. SSE) — nothing to report
  }
  results.push({ source, status: response.status, capability })
  return response
}

function assertNoUnknownRoute(results: readonly Probe[]) {
  const unknown = results.filter((result) => result.status === 404 && result.capability === "route.unknown")
  expect(unknown).toEqual([])
}

describe("workbench route parity: registry and client vs the real server (C1-2/FUNC-001)", () => {
  // C2-2 decision (2026-08-17): workspace-switcher declares GET /v1/workspaces
  // but no client method ever calls it, and WorkspacePort has no "list
  // workspaces" capability — workspace switching happens client-side via
  // local desktop project state, never through this protocol. The registry
  // entry only exists because WORKBENCH_ROUTE_REGISTRY is a total mapped
  // type over WORK_V1_FUNCTIONS (routes.ts). Excluded here rather than
  // inventing a server capability nothing needs yet.
  const UNSERVED_OPERATIONS = new Set(["workspace-switcher"])

  it("no WORKBENCH_ROUTE_REGISTRY entry resolves to route.unknown", async () => {
    const server = makeServer()
    const results: Probe[] = []
    for (const [operation, entry] of Object.entries(WORKBENCH_ROUTE_REGISTRY)) {
      if (UNSERVED_OPERATIONS.has(operation)) continue
      await probe(
        results,
        `registry:${operation}`,
        server,
        new Request(`http://origin-under-test${fillParams(entry.route)}`, {
          method: entry.method,
          headers: { authorization: "Bearer test-token", "content-type": "application/json" },
          body: entry.method === "GET" ? undefined : JSON.stringify({}),
        }),
      )
    }
    assertNoUnknownRoute(results)
  })

  it("no public WorkbenchClient method resolves to route.unknown", async () => {
    const server = makeServer()
    const results: Probe[] = []

    const client = new WorkbenchClient({
      baseUrl: "http://origin-under-test",
      instanceId: "test-instance",
      token: { current: () => "test-token", refresh: async () => "test-token" },
      fetchImpl: (async (input: RequestInfo | URL, init?: RequestInit) => probe(results, String(input), server, new Request(String(input), init))) as unknown as typeof fetch,
    })

    const attempt = (run: () => Promise<unknown>) => run().catch(() => undefined)

    await attempt(() => client.handshake())
    await attempt(() => client.listFiles("ws-1"))
    await attempt(() => client.searchFiles("ws-1", "query"))
    await attempt(() => client.readFiles("ws-1", ["a.txt"]))
    await attempt(() => client.createFiles("ws-1", [{ path: "a.txt", content: "hi" }]))
    await attempt(() => client.removeFiles("ws-1", ["a.txt"]))
    await attempt(() => client.renameFile("ws-1", "a.txt", "b.txt"))
    await attempt(() => client.listDesignSystems("ws-1"))
    await attempt(() => client.listArtifacts("ws-1"))
    await attempt(() => client.getArtifact("ws-1", "artifact-1"))
    await attempt(() => client.createArtifact({ workspaceId: "ws-1", kind: "text", filename: "a.txt", content: "" }))
    await attempt(() => client.listDocuments("ws-1"))
    await attempt(() => client.trace("ws-1"))
    await attempt(() => client.activity("ws-1"))
    await attempt(() => client.listApprovals("ws-1"))
    await attempt(() => client.searchCapabilities("ws-1"))
    await attempt(() => client.exportArtifact("ws-1", "artifact-1"))
    await attempt(() => client.presentArtifactLink("ws-1", "artifact-1"))
    await attempt(() => client.resolveApproval("approval-1", "allow"))
    await attempt(() => client.cancelApproval("approval-1"))
    await attempt(() => client.startWorkflow("ws-1", { id: "wf-1", version: 1, steps: [] }))
    await attempt(() => client.validateSpec("ws-1", "{}"))
    await attempt(() => client.updateWorkflow("wf-1", "resume"))
    await attempt(() => client.events("ws-1", new WorkbenchEventDispatcher()).next())

    assertNoUnknownRoute(results)
  })
})
