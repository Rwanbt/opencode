/* SPDX-License-Identifier: MIT */

// FUNC-005/C5-2: GET /v1/files/list and /v1/files/search on a non-existent
// prefix must return 200 + entries: [] (an empty, legitimate result),
// distinguishing "absent" from a real access error — the same distinction
// #designSystems already makes via isMissingFile() (index.ts). Exercised
// through the real server, not just WorkspaceRuntime directly (C1-4/C5-1
// already covers that layer) — this is the generic server-boundary
// contract FUNC-005 is about, decoupled from Automate's UI (out of scope,
// see ADR-1033).

import { mkdtemp, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { FakeRuntimeAdapter } from "@unifia/contracts"
import { WorkspaceRuntime } from "@unifia/workspace-runtime"
import { UnauthenticatedPrincipal, WorkbenchServer } from "../src/index.js"

describe("GET /v1/files/{list,search} on a non-existent prefix (FUNC-005/C5-2)", () => {
  let root: string
  beforeEach(async () => { root = await mkdtemp(path.join(os.tmpdir(), "unifia-missing-prefix-")) })
  afterEach(async () => { await rm(root, { recursive: true, force: true }) })

  async function open(server: WorkbenchServer) {
    const registered = await server.fetch(new Request("http://localhost/v1/workspaces/register", { method: "POST", body: JSON.stringify({ name: "fixture", path: root }) }))
    const { id } = (await registered.json()) as { id: string }
    const opened = await server.fetch(new Request(`http://localhost/v1/workspaces/${id}/open`, { method: "POST" }))
    return (await opened.json()) as { id: string; token: string }
  }

  it("list returns 200 with an empty page for any absent prefix", async () => {
    const server = new WorkbenchServer({ auth: new UnauthenticatedPrincipal("anonymous", ["workspace.register", "workspace.open", "workspace.read"]), workspace: new WorkspaceRuntime(), runtime: new FakeRuntimeAdapter(), audit: { record: () => undefined }, capability: { check: async () => "allow" } })
    const handle = await open(server)
    const response = await server.fetch(new Request(`http://localhost/v1/files/list?workspaceId=${handle.id}&prefix=does-not-exist`, { headers: { authorization: `Bearer ${handle.token}` } }))
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ entries: [] })
  })

  it("search returns 200 with an empty result for any absent prefix", async () => {
    const server = new WorkbenchServer({ auth: new UnauthenticatedPrincipal("anonymous", ["workspace.register", "workspace.open", "workspace.read"]), workspace: new WorkspaceRuntime(), runtime: new FakeRuntimeAdapter(), audit: { record: () => undefined }, capability: { check: async () => "allow" } })
    const handle = await open(server)
    const response = await server.fetch(new Request(`http://localhost/v1/files/search?workspaceId=${handle.id}&query=foo&prefix=does-not-exist`, { headers: { authorization: `Bearer ${handle.token}` } }))
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ entries: [] })
  })
})
