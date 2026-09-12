/* SPDX-License-Identifier: MIT */

// C1-3/SEC-001: a token issued with only ["workspace.read", "workspace.watch"]
// must be refused (403, no approval created) on every mutating route whose
// capability has no legitimate caller in this branch. #checkCapability used
// to only ever call this.#capability.check(capability, resource,
// "workbench-server") — it never received or consulted the calling
// principal's token-scoped capabilities (built once, at #authenticate, into
// principal.scopes, and never read again). The decision was entirely
// governed by the server-wide CapabilityGate, independent of what the
// calling token actually held.
//
// artifact.create and artifact.export are step-up eligible (2026-08-17
// decision, see index.ts's STEP_UP_ELIGIBLE_CAPABILITIES): Design/Work
// trigger them for real (save/export), so a base-scoped token must still
// reach the approval gate for these two — that's covered separately below,
// not folded into the "hard refuse" list.

import { describe, expect, it } from "vitest"
import { ScopedTokenIssuer, WorkbenchServer } from "../src/index.js"

const WORKSPACE_ID = "ws-1"
const READ_ONLY_CAPABILITIES = ["workspace.read", "workspace.watch"]

type Route = { name: string; path: string; body: Record<string, unknown> }

// No legitimate caller in this branch — must fail closed at 403 and never
// reach the capability gate, regardless of what the gate would decide.
const NEVER_GRANTED_ROUTES: readonly Route[] = [
  { name: "files.write", path: "/v1/files/write", body: { workspaceId: WORKSPACE_ID, writes: [{ path: "a.txt", content: "x" }] } },
  { name: "workflows.start", path: "/v1/workflows/start", body: { workspaceId: WORKSPACE_ID, definition: { id: "wf-1", version: 1, steps: [] } } },
  { name: "desktop.control", path: "/v1/desktop/control", body: { workspaceId: WORKSPACE_ID, appId: "app-1", action: "keyboard", payload: {} } },
  { name: "capabilities.register", path: "/v1/capabilities/register", body: { workspaceId: WORKSPACE_ID, manifest: { descriptor: { id: "x", name: "x", description: "x", version: "1.0.0", author: "x", license: "MIT", schema: {}, tags: [], trustLevel: "untrusted" }, digest: "sha256:x", signature: "x", sourceRepo: "local", sourceCommit: "abc", license: "MIT", remoteCode: false } } },
]

// Design/Work trigger these for real (save/export) — a base-scoped token
// must reach the approval gate, not fail closed outright.
const STEP_UP_ROUTES: readonly Route[] = [
  { name: "artifacts.create", path: "/v1/artifacts", body: { workspaceId: WORKSPACE_ID, kind: "text", filename: "a.txt", content: "" } },
  { name: "artifacts.export", path: "/v1/artifacts/export", body: { workspaceId: WORKSPACE_ID, artifactId: "artifact-1" } },
]

function makeServer(onCheck: (capability: string) => void) {
  return new WorkbenchServer({
    auth: { authenticate: async () => undefined },
    tokenIssuer: new ScopedTokenIssuer("x".repeat(32), 60_000, 30_000),
    workspace: { open: async (id: string) => ({ id, token: `runtime-${id}` }) } as never,
    runtime: {} as never,
    artifacts: {} as never,
    workflow: {} as never,
    desktop: {} as never,
    capabilities: {} as never,
    audit: { record: () => undefined },
    capability: {
      check: async (capability) => {
        onCheck(capability)
        return { kind: "approval_required", approvalId: `approval-${capability}` }
      },
    },
  })
}

async function issueReadOnlyToken(server: WorkbenchServer) {
  const issued = await server.issueNativeScopedToken({ principalId: "principal-1", workspaceId: WORKSPACE_ID, capabilities: READ_ONLY_CAPABILITIES })
  return issued.token
}

describe("SEC-001: capability scope of the token, not just the server-wide gate (C1-3)", () => {
  it.each(NEVER_GRANTED_ROUTES)("$name refuses a read/watch-only token with 403 and creates no approval", async ({ path, body }) => {
    let approvalsCreated = 0
    const server = makeServer(() => { approvalsCreated += 1 })
    const token = await issueReadOnlyToken(server)

    const response = await server.fetch(new Request(`http://localhost${path}`, { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify(body) }))

    expect(response.status).toBe(403)
    expect(approvalsCreated).toBe(0)
  })

  it.each(STEP_UP_ROUTES)("$name step-up: a read/watch-only token reaches the approval gate instead of failing closed", async ({ path, body }) => {
    let approvalsCreated = 0
    const server = makeServer(() => { approvalsCreated += 1 })
    const token = await issueReadOnlyToken(server)

    const response = await server.fetch(new Request(`http://localhost${path}`, { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify(body) }))

    expect(response.status).toBe(202)
    expect(approvalsCreated).toBe(1)
  })

  it("workflow.run is never granted in this branch, even if the gate would allow it", async () => {
    const server = new WorkbenchServer({
      auth: { authenticate: async () => undefined },
      tokenIssuer: new ScopedTokenIssuer("x".repeat(32), 60_000, 30_000),
      workspace: { open: async (id: string) => ({ id, token: `runtime-${id}` }) } as never,
      runtime: {} as never,
      workflow: {} as never,
      audit: { record: () => undefined },
      // A misconfigured or overly permissive gate must not matter — the
      // capability isn't step-up eligible, so #checkCapability refuses it
      // before this ever runs.
      capability: { check: async () => "allow" },
    })
    const token = await issueReadOnlyToken(server)
    const response = await server.fetch(new Request("http://localhost/v1/workflows/start", { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify({ workspaceId: WORKSPACE_ID, definition: { id: "wf-1", version: 1, steps: [] } }) }))
    expect(response.status).toBe(403)
  })
})
