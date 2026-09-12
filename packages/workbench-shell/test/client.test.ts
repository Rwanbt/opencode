/* SPDX-License-Identifier: MIT */

import { WorkbenchClient, WorkbenchEventDispatcher, WorkbenchHttpError, newRequestId } from "../src/index.js"
import { test } from "bun:test"

test('client.test', async () => {

let checks = 0
const check = (condition: boolean, message: string): void => {
  checks += 1
  if (!condition) throw new Error(message)
}

let token = "expired"
let refreshes = 0
const requests: Array<{ url: string; init?: RequestInit }> = []
const client = new WorkbenchClient({
  baseUrl: "http://127.0.0.1:7444",
  instanceId: "instance-1",
  token: {
    current: () => token,
    refresh: async () => { refreshes += 1; token = "fresh"; return token },
  },
  fetchImpl: async (input, init) => {
    requests.push({ url: new URL(String(input)).pathname + new URL(String(input)).search, init })
    if (init?.headers && token === "expired") return new Response(null, { status: 401 })
    const path = new URL(String(input)).pathname
    const payload = path === "/v1/specs/validate"
      ? { valid: true, spec: {}, capabilities: { granted: [], denied: [] } }
      : path === "/v1/handshake"
      ? { kind: "workbench.handshake.accepted", accepted: true, protocolVersion: 1, supportedVersions: [1], instanceId: "server-instance-1" }
      : path === "/v1/trace" ? { kind: "trace", events: [], nextCursor: null } : path === "/v1/activity" ? { kind: "activity", events: [], nextCursor: null } : path === "/v1/design-systems" ? { version: 1, designSystems: [] } : path === "/v1/design-skills" ? { skills: [] } : { ok: true, entries: [] }
    return new Response(JSON.stringify(payload), { status: 200, headers: { "content-type": "application/json" } })
  },
})

const listRequest = await client.listFiles("workspace-1", "src")
check(requests.at(-1)?.url === "/v1/files/list?workspaceId=workspace-1&prefix=src", "file list client route was not encoded deterministically")
check(listRequest.entries.length === 0, "file list client did not decode the response")
await client.readFiles("workspace-1", [".unifia/workflows/demo.json"])
check(requests.at(-1)?.url === "/v1/files/read", "file read client route was not selected")
const searchRequest = await client.searchFiles("workspace-1", "main.ts")
check(requests.at(-1)?.url === "/v1/files/search?workspaceId=workspace-1&query=main.ts&prefix=.", "file search client route was not encoded deterministically")
check(searchRequest.entries.length === 0, "file search client did not decode the response")
await client.listArtifacts("workspace-1")
check(requests.at(-1)?.url === "/v1/artifacts?workspaceId=workspace-1", "artifact list client route was not encoded deterministically")
await client.listDocuments("workspace-1")
check(requests.at(-1)?.url === "/v1/documents?workspaceId=workspace-1", "document list client route was not encoded deterministically")
const designSystems = await client.listDesignSystems("workspace-1")
check(requests.at(-1)?.url === "/v1/design-systems?workspaceId=workspace-1" && designSystems.version === 1, "design-system manifest client route was not encoded deterministically")
const designSkills = await client.listDesignSkills("workspace-1")
check(requests.at(-1)?.url === "/v1/design-skills?workspaceId=workspace-1" && designSkills.skills.length === 0, "design-skill manifest client route was not encoded deterministically")
const trace = await client.trace("workspace-1", 4, 2)
check(requests.at(-1)?.url === "/v1/trace?workspaceId=workspace-1&after=4&limit=2", "trace client route was not encoded deterministically")
check(trace.kind === "trace" && trace.events.length === 0, "trace client did not decode the typed page")
const activity = await client.activity("workspace-1")
check(requests.at(-1)?.url === "/v1/activity?workspaceId=workspace-1&after=0&limit=50", "activity client route did not apply bounded defaults")
check(activity.kind === "activity", "activity client did not preserve the page kind")
await client.listApprovals("workspace-1")
check(requests.at(-1)?.url === "/v1/approvals?workspaceId=workspace-1", "approval list client route was not encoded deterministically")
await client.searchCapabilities("workspace-1", { tag: "design", trustLevel: "verified", enabledOnly: true })
check(requests.at(-1)?.url === "/v1/capabilities/search?workspaceId=workspace-1&tag=design&trustLevel=verified&enabledOnly=true", "capability search client route was not encoded deterministically")
await client.exportArtifact("workspace-1", "artifact-123", { metadata: "strip" })
check(requests.at(-1)?.url === "/v1/artifacts/export", "artifact export client route was not selected")
await client.getArtifact("workspace-1", "artifact-123")
check(requests.at(-1)?.url === "/v1/artifacts/artifact-123?workspaceId=workspace-1", "artifact detail client route was not encoded deterministically")
await client.createArtifact({ workspaceId: "workspace-1", kind: "text", filename: "note.md", content: "hello" })
check(requests.at(-1)?.url === "/v1/artifacts", "artifact create client route was not selected")
await client.startWorkflow("workspace-1", { kind: "test" })
check(requests.at(-1)?.url === "/v1/workflows/start", "workflow start client route was not selected")
await client.validateSpec("workspace-1", { kind: "design" })
check(requests.at(-1)?.url === "/v1/specs/validate", "spec validation client route was not selected")
await client.resolveApproval("approval-1", "allow")
check(requests.at(-1)?.url === "/v1/approvals/approval-1", "approval resolution client route was not selected")

const handshake = await client.handshake()
const handshakeRequest = requests.at(-1)
const handshakeBody = JSON.parse(String(handshakeRequest?.init?.body)) as Record<string, unknown>
check(handshake.kind === "workbench.handshake.accepted", "client did not parse the handshake response")
check(handshakeRequest?.url === "/v1/handshake" && handshakeBody.kind === "workbench.handshake" && handshakeBody.clientInstanceId === "instance-1", "client handshake request was not encoded with the wire contract")

let releaseRotation: (() => void) | undefined
let rotationApplied = false
let resolveRotation = new Promise<void>((resolve) => { releaseRotation = resolve })
const rotating = new WorkbenchClient({
  baseUrl: "http://127.0.0.1:7444",
  instanceId: "instance-rotation",
  token: {
    current: () => "current",
    refresh: async () => "refreshed",
    applyRotation: async () => { await resolveRotation; rotationApplied = true },
  },
  fetchImpl: async (_input, init) => {
    check(rotationApplied, "request escaped before token rotation completed")
    check(String(init?.headers && new Headers(init.headers).get("authorization")) === "Bearer current", "request did not preserve the provider-owned token")
    return new Response(JSON.stringify({ ok: true }), { status: 200 })
  },
})
rotating.applyTokenRotation({ state: "rotating", token: "next", previousToken: "current", gracePeriodMs: 30_000, expiresAt: Date.now() + 60_000 })
const pendingRotationRequest = rotating.request<{ ok: boolean }>("/v1/read")
await new Promise((resolve) => setTimeout(resolve, 0))
check(!rotationApplied, "rotation completed synchronously instead of waiting for the native provider")
releaseRotation?.()
check((await pendingRotationRequest).ok, "request after token rotation did not complete")

check((await client.request<{ ok: boolean }>("/v1/read")).ok, "a GET did not retry after token refresh")
check(refreshes === 1, "GET refresh count was not exactly one")

let postCalls = 0
const mutant = new WorkbenchClient({
  baseUrl: "http://127.0.0.1:7444",
  instanceId: "instance-1",
  token: { current: () => "expired", refresh: async () => "fresh" },
  fetchImpl: async () => { postCalls += 1; return new Response(null, { status: 401 }) },
})
try { await mutant.request("/v1/write", { method: "POST", body: { value: 1 } }) } catch (error) { check(error instanceof WorkbenchHttpError && error.status === 401, "mutant POST returned the wrong error") }
check(postCalls === 1, "mutant POST was replayed without idempotency")

const dispatcher = new WorkbenchEventDispatcher()
// operation.updated is a MUTATION event: the wire contract requires a
// `resource` naming the entity it targets, because the query-invalidation map
// scopes the refetch on `resource.id` instead of dropping the whole workspace
// cache. parseWorkspaceEvent refuses a mutation event without one.
dispatcher.apply({ eventId: "1", workspaceId: "ws", sequenceId: 1, cursor: "c1", type: "operation.updated", resource: { type: "operation", id: "op-1" }, payload: { state: "running" } })
dispatcher.apply({ eventId: "2", workspaceId: "ws", sequenceId: 3, cursor: "c3", type: "operation.updated", resource: { type: "operation", id: "op-1" }, payload: { state: "done" } })
check(dispatcher.lastSequence === 3 && dispatcher.resyncRequired, "sequence gap did not request resync")
check(dispatcher.events.filter((event) => event.type === "operation.updated").length === 1, "last-wins event was not merged")
check(newRequestId().includes("-7"), "idempotency key was not UUID v7")

console.log(`WorkbenchClient: ${checks}/${checks} passed`)
})
