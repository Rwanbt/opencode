/* SPDX-License-Identifier: MIT */

import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"

import { mkdtemp, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { P3_CAPABILITIES } from "@unifia/contracts"
import { WorkbenchClient } from "@unifia/workbench-shell"
import { createWorkbenchApp, type WorkbenchConfig } from "../src/bootstrap.js"

const root = await mkdtemp(path.join(os.tmpdir(), "unifia-connected-surfaces-"))
try {
  await writeFile(path.join(root, "README.md"), "connected surfaces")
  const config: WorkbenchConfig = {
    signingKey: "unifia-connected-surfaces-signing-key-0123456789",
    issuer: "unifia-connected-surfaces",
    audience: "workbench",
    host: "127.0.0.1",
    port: 0,
    runtime: "fake",
    auditLogPath: path.join(root, ".unifia", "connected-audit.jsonl"),
    rateBudget: 240,
    rateWindowMs: 60_000,
    allowlistedCapabilities: new Set(P3_CAPABILITIES),
    artifactRoot: mkdtempSync(path.join(tmpdir(), "unifia-artifacts-")),
    presentLinkTtlMs: 60_000,
  }
  const app = createWorkbenchApp(config)
  const request = (input: RequestInfo | URL, init?: RequestInit) => app.server.fetch(new Request(input, init))
  const admin = app.authenticator.sign({ id: "connected-test", scopes: new Set(["workspace.register", "workspace.open", ...P3_CAPABILITIES]), workspaces: "*" }, Date.now() + 60_000)
  const authorization = { authorization: `Bearer ${admin}` }
  const registered = await request("http://local/v1/workspaces/register", { method: "POST", headers: authorization, body: JSON.stringify({ name: "connected", path: root }) })
  if (registered.status !== 201) throw new Error(`connected test could not register workspace: ${registered.status}`)
  const workspaceId = (await registered.json() as { id: string }).id
  const opened = await request(`http://local/v1/workspaces/${workspaceId}/open`, { method: "POST", headers: authorization })
  if (opened.status !== 200) throw new Error(`connected test could not open workspace: ${opened.status}`)
  const fileSession = (await opened.json() as { token: string }).token
  const transportFetch = (input: RequestInfo | URL, init?: RequestInit) => {
    const headers = new Headers(init?.headers)
    headers.set("x-unifia-file-session", fileSession)
    return request(input, { ...init, headers })
  }
  const client = new WorkbenchClient({ baseUrl: "http://local", instanceId: app.server.instanceId, fetchImpl: transportFetch as typeof fetch, token: { current: () => admin, refresh: async () => admin } })

  const handshake = await client.handshake()
  if (!handshake.accepted) throw new Error("connected surfaces handshake was refused")

  const work = await client.listFiles(workspaceId)
  if (!work.entries.some((entry) => entry.path === "README.md")) throw new Error("Work surface did not expose the workspace file")

  const design = await client.validateSpec(workspaceId, { id: "connected-design", version: "1.0.0", target: "design", title: "Connected Design", rules: [] })
  if (!design.valid || design.capabilities.denied.length !== 0) throw new Error("Design surface rejected the valid connected spec")

  const sessionResponse = await request(`http://local/v1/workspaces/${workspaceId}/sessions`, { method: "POST", headers: { ...authorization, "x-unifia-file-session": fileSession } })
  if (sessionResponse.status !== 201) throw new Error(`Code surface could not create a session: ${sessionResponse.status}`)
  const sessionId = (await sessionResponse.json() as { session: { id: string } }).session.id
  const prompt = await client.request(`/v1/sessions/${encodeURIComponent(sessionId)}/prompt`, { method: "POST", body: { prompt: "connected" }, idempotencyKey: "connected-surfaces-prompt" as never })
  if (!prompt) throw new Error("Code surface returned no prompt result")

  console.log("ConnectedSurfaces: Code/Work/Design passed")
} finally {
  await rm(root, { recursive: true, force: true })
}
