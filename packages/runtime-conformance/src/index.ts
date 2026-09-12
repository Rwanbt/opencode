/* SPDX-License-Identifier: MIT */

/**
 * Runtime conformance suite — Plan V3 section 13.
 *
 * The plan requires that the three runtimes all pass the same ten scenarios:
 * create a session, send a prompt, receive events, request a permission, answer
 * a permission, cancel, switch workspace, read and write an artefact, close
 * cleanly, and recover after a crash.
 *
 * The suite drives each runtime through the WorkbenchServer rather than the
 * RuntimeAdapter alone: permissions, artefacts and clean shutdown are owned by
 * other authorities (ApprovalBroker, ArtifactRuntime, WorkspaceRuntime), and a
 * scenario that never crosses those boundaries would not prove the runtime is
 * usable — only that its own methods return.
 *
 * KNOWN DIVERGENCE FROM THE PLAN — plan section 7.1 lists `replyApproval` on
 * RuntimeAdapter, and the implemented interface does not have it. That is not
 * an oversight to paper over here: plan section 5 makes ApprovalBroker the sole
 * authority for approvals, so putting an approval method on the runtime port
 * would create the second authority the plan forbids. The scenarios therefore
 * exercise approvals through ApprovalBroker, and this divergence is reported
 * rather than silently satisfied.
 */

import { mkdtemp, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { ArtifactStore } from "@unifia/artifact-runtime"
import { ApprovalBroker, P3_CAPABILITIES, type OpenCodeRuntimeBackend, type P3Capability, type RuntimeAdapter, type RuntimeEvent, type Session, type SendPromptInput } from "@unifia/contracts"
import { ApprovalCapabilityGate, HmacTokenAuthenticator, WorkbenchServer, type Principal } from "@unifia/workbench-server"
import { WorkspaceRuntime, WorkspaceStorage } from "@unifia/workspace-runtime"

export type ScenarioName =
  | "create-session"
  | "send-prompt"
  | "receive-events"
  | "request-permission"
  | "reply-permission"
  | "cancel"
  | "switch-workspace"
  | "artifact-read-write"
  | "clean-close"
  | "crash-recovery"

export const CONFORMANCE_SCENARIOS: readonly ScenarioName[] = [
  "create-session",
  "send-prompt",
  "receive-events",
  "request-permission",
  "reply-permission",
  "cancel",
  "switch-workspace",
  "artifact-read-write",
  "clean-close",
  "crash-recovery",
]

export type ScenarioResult = { scenario: ScenarioName; passed: boolean; detail: string }
export type ConformanceReport = { runtime: string; results: ScenarioResult[]; passed: boolean }

const SIGNING_KEY = "unifia-conformance-signing-key-0123456789"
/** Read and watch are pre-granted so the approval scenarios are the ones that exercise the gate. */
const ALLOWLISTED: ReadonlySet<P3Capability> = new Set<P3Capability>(["workspace.read", "workspace.watch"])

/** Wraps any adapter as a backend, so the delegating adapters get real behaviour. */
export function backendFromAdapter(adapter: RuntimeAdapter): OpenCodeRuntimeBackend {
  return {
    listSessions: (workspaceId: string) => adapter.listSessions({ workspaceId }),
    createSession: (workspaceId: string) => adapter.createSession({ workspaceId }),
    sendPrompt: (input: SendPromptInput) => adapter.sendPrompt(input),
    subscribeEvents: (sessionId: string, afterSequence?: number) => adapter.subscribeEvents({ sessionId, afterSequence }),
    cancelSession: (sessionId: string) => adapter.cancelSession(sessionId),
  }
}

type Fixture = {
  server: WorkbenchServer
  adapter: RuntimeAdapter
  root: string
  headers: Record<string, string>
  workspaceId: string
  artifacts: ArtifactStore
}

/**
 * WHY the target file is seeded: WorkspacePort.write resolves an *existing*
 * path by design — creating files through a write is not a capability the
 * workspace grants. The permission scenarios are about the approval gate, so
 * they must not fail for the unrelated reason that the target does not exist.
 */
const WRITE_TARGET = "conformance.txt"

async function createFixture(adapter: RuntimeAdapter, root: string): Promise<Fixture> {
  await writeFile(path.join(root, WRITE_TARGET), "seed")
  const authenticator = new HmacTokenAuthenticator(SIGNING_KEY, "unifia-local", "conformance")
  // SEC-001/C2-3: WorkbenchServer#checkCapability now requires the calling
  // principal to hold the capability being checked before the gate ever
  // runs. This suite conformance-tests the gate/broker mechanism itself
  // across all three runtime backends (Plan V3 §13) — it is not exercising
  // work-design's specific capability policy — so the fixture principal is
  // granted every P3 capability rather than the narrower set an app
  // connection would actually request.
  const principal: Principal = { id: "conformance", scopes: new Set<string>(["workspace.register", "workspace.open", ...P3_CAPABILITIES]), workspaces: "*" }
  const server = new WorkbenchServer({
    auth: authenticator,
    workspace: new WorkspaceRuntime(),
    runtime: adapter,
    audit: { record: () => undefined },
    capability: new ApprovalCapabilityGate(new ApprovalBroker(), ALLOWLISTED),
  })
  const bearer = { authorization: `Bearer ${authenticator.sign(principal, Date.now() + 600_000)}`, "content-type": "application/json" }
  const registered = await server.fetch(new Request("http://c/v1/workspaces/register", { method: "POST", headers: bearer, body: JSON.stringify({ name: "conformance", path: root }) }))
  const workspace = await registered.json() as { id: string }
  const opened = await server.fetch(new Request(`http://c/v1/workspaces/${workspace.id}/open`, { method: "POST", headers: bearer }))
  const handle = await opened.json() as { id: string; token: string }
  return { server, adapter, root, workspaceId: handle.id, headers: { ...bearer, "x-unifia-file-session": handle.token }, artifacts: new ArtifactStore(root) }
}

const call = (fixture: Fixture, url: string, init: RequestInit = {}) =>
  fixture.server.fetch(new Request(`http://c${url}`, { headers: fixture.headers, ...init }))

async function createSession(fixture: Fixture): Promise<Session> {
  const response = await call(fixture, `/v1/workspaces/${fixture.workspaceId}/sessions`, { method: "POST" })
  if (response.status !== 201) throw new Error(`session creation returned ${response.status}`)
  return (await response.json() as { session: Session }).session
}

/** Reads the first event carrying a data payload, ignoring the opening comment frame. */
async function firstEvent(body: ReadableStream<Uint8Array>, timeoutMs = 5_000): Promise<RuntimeEvent> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ""
  const deadline = new Promise<never>((_, reject) => setTimeout(() => reject(new Error("event stream timed out")), timeoutMs))
  try {
    for (;;) {
      const chunk = await Promise.race([reader.read(), deadline])
      if (chunk.done) throw new Error("event stream ended before an event")
      buffer += decoder.decode(chunk.value, { stream: true })
      for (const line of buffer.split("\n")) if (line.startsWith("data: ")) return JSON.parse(line.slice(6)) as RuntimeEvent
    }
  } finally {
    await reader.cancel().catch(() => {})
  }
}

const SCENARIOS: Readonly<Record<ScenarioName, (fixture: Fixture) => Promise<string>>> = {
  "create-session": async (fixture) => {
    const session = await createSession(fixture)
    if (session.workspaceId !== fixture.workspaceId) throw new Error("session is not scoped to its workspace")
    return `session ${session.id} created`
  },
  "send-prompt": async (fixture) => {
    const session = await createSession(fixture)
    const response = await call(fixture, `/v1/sessions/${session.id}/prompt`, { method: "POST", body: JSON.stringify({ prompt: "conformance" }) })
    if (response.status !== 202) throw new Error(`prompt returned ${response.status}`)
    return "prompt accepted"
  },
  "receive-events": async (fixture) => {
    const session = await createSession(fixture)
    const stream = await call(fixture, `/v1/sessions/${session.id}/events`)
    if (stream.status !== 200 || !stream.body) throw new Error(`event stream returned ${stream.status}`)
    const pending = firstEvent(stream.body)
    await call(fixture, `/v1/sessions/${session.id}/prompt`, { method: "POST", body: JSON.stringify({ prompt: "streamed" }) })
    const event = await pending
    if (event.data !== "streamed") throw new Error(`event carried ${JSON.stringify(event.data)}`)
    if (typeof event.sequence !== "number") throw new Error("event carried no sequence, so it is not replayable")
    return `event ${event.sequence} received`
  },
  "request-permission": async (fixture) => {
    const response = await call(fixture, "/v1/files/write", { method: "POST", body: JSON.stringify({ workspaceId: fixture.workspaceId, writes: [{ path: "conformance.txt", content: "x" }] }) })
    if (response.status !== 202) throw new Error(`unapproved write returned ${response.status} instead of 202`)
    const body = await response.json() as { approvalId?: string }
    if (!body.approvalId) throw new Error("no approval id was issued")
    return `approval ${body.approvalId} requested`
  },
  "reply-permission": async (fixture) => {
    const pending = await call(fixture, "/v1/files/write", { method: "POST", body: JSON.stringify({ workspaceId: fixture.workspaceId, writes: [{ path: "conformance.txt", content: "approved" }] }) })
    const { approvalId } = await pending.json() as { approvalId: string }
    const resolved = await call(fixture, `/v1/approvals/${approvalId}`, { method: "POST", body: JSON.stringify({ decision: "allow" }) })
    if (resolved.status !== 200) throw new Error(`approval resolve returned ${resolved.status}`)
    const retried = await call(fixture, "/v1/files/write", { method: "POST", body: JSON.stringify({ workspaceId: fixture.workspaceId, writes: [{ path: "conformance.txt", content: "approved" }] }) })
    if (retried.status !== 200) throw new Error(`approved write returned ${retried.status}`)
    return "approval granted and write served"
  },
  cancel: async (fixture) => {
    const session = await createSession(fixture)
    await fixture.adapter.cancelSession(session.id)
    let refused = false
    try {
      await fixture.adapter.sendPrompt({ sessionId: session.id, prompt: "after cancel" })
    } catch {
      refused = true
    }
    if (!refused) throw new Error("the runtime accepted a prompt after cancellation")
    return "cancelled session refuses further prompts"
  },
  "switch-workspace": async (fixture) => {
    const session = await createSession(fixture)
    const other = await mkdtemp(path.join(os.tmpdir(), "unifia-conf-other-"))
    try {
      const registered = await call(fixture, "/v1/workspaces/register", { method: "POST", body: JSON.stringify({ name: "other", path: other }) })
      const second = await registered.json() as { id: string }
      const listed = await fixture.adapter.listSessions({ workspaceId: second.id })
      if (listed.some((entry) => entry.id === session.id)) throw new Error("a session leaked across workspaces")
      return "sessions stay scoped to their workspace"
    } finally {
      await rm(other, { recursive: true, force: true })
    }
  },
  "artifact-read-write": async (fixture) => {
    const created = await fixture.artifacts.create({ kind: "text", filename: "report.txt", content: "conformance artefact" })
    const read = await fixture.artifacts.read(created)
    if (new TextDecoder().decode(read) !== "conformance artefact") throw new Error("artefact round trip lost content")
    return `artefact ${created.artifactId} verified by hash`
  },
  "clean-close": async (fixture) => {
    const failures = await fixture.server.shutdown()
    if (failures.length > 0) throw new Error(`shutdown reported ${failures.join(", ")}`)
    if (fixture.server.openFileSessions !== 0) throw new Error("shutdown left a file session open")
    const afterClose = await call(fixture, "/v1/files/read", { method: "POST", body: JSON.stringify({ workspaceId: fixture.workspaceId, paths: ["conformance.txt"] }) })
    if (afterClose.status !== 403) throw new Error(`a revoked token was still accepted with ${afterClose.status}`)
    return "file sessions revoked on shutdown"
  },
  "crash-recovery": async (fixture) => {
    const storage = new WorkspaceStorage(fixture.root)
    const saved = await storage.save(await storage.load("conformance-ws"))
    // A crash between the temp write and the rename leaves a newer candidate
    // behind; recovery must prefer it over the older committed state.
    const newer = { ...saved, generation: saved.generation + 5, metadata: { source: "recovered" } }
    await writeFile(path.join(fixture.root, ".unifia", "workspace-state.json.tmp"), `${JSON.stringify(newer)}\n`)
    const recovered = await storage.recover("conformance-ws")
    if (recovered.generation !== newer.generation || recovered.metadata.source !== "recovered") throw new Error("the newer candidate was not recovered")
    return `recovered at generation ${recovered.generation}`
  },
}

/** Runs the ten scenarios against one runtime. Each scenario gets a fresh fixture. */
export async function runConformanceSuite(label: string, createAdapter: () => RuntimeAdapter): Promise<ConformanceReport> {
  const results: ScenarioResult[] = []
  for (const scenario of CONFORMANCE_SCENARIOS) {
    const root = await mkdtemp(path.join(os.tmpdir(), "unifia-conformance-"))
    try {
      const fixture = await createFixture(createAdapter(), root)
      results.push({ scenario, passed: true, detail: await SCENARIOS[scenario](fixture) })
    } catch (error) {
      results.push({ scenario, passed: false, detail: error instanceof Error ? error.message : String(error) })
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  }
  return { runtime: label, results, passed: results.every((result) => result.passed) }
}
