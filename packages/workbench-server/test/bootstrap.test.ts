/* SPDX-License-Identifier: MIT */
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { HmacTokenAuthenticator, type Principal } from "../src/auth.js"
import { createWorkbenchApp, loadConfigFromEnv, startWorkbench, type WorkbenchConfig } from "../src/bootstrap.js"

let checks = 0
const check = (condition: boolean, message: string): void => {
  checks += 1
  if (!condition) throw new Error(message)
}
const throws = (run: () => unknown, expected: string, message: string): void => {
  checks += 1
  try {
    run()
  } catch (error) {
    if (error instanceof Error && error.message.includes(expected)) return
    throw new Error(`${message} (got: ${String(error)})`)
  }
  throw new Error(`${message} (did not throw)`)
}

/**
 * Minimal but real SSE frame parser.
 *
 * WHY a parser and not `text.includes(...)`: the previous event-stream test
 * substring-matched its payload, which let a stream whose frames carried
 * literal backslash-n characters pass as correct for as long as it existed.
 * Anything asserting on SSE must parse the wire format.
 */
async function readFirstSseEvent(body: ReadableStream<Uint8Array>, timeoutMs = 5_000): Promise<{ id?: string; data: string }> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ""
  const deadline = new Promise<never>((_, reject) => setTimeout(() => reject(new Error("SSE read timed out")), timeoutMs))
  try {
    for (;;) {
      const chunk = await Promise.race([reader.read(), deadline])
      if (chunk.done) throw new Error("SSE stream ended before a complete frame")
      buffer += decoder.decode(chunk.value, { stream: true })
      for (;;) {
        const boundary = buffer.indexOf("\n\n")
        if (boundary < 0) break
        const frame = buffer.slice(0, boundary)
        buffer = buffer.slice(boundary + 2)
        const fields: { id?: string; data: string } = { data: "" }
        let hasData = false
        for (const line of frame.split("\n")) {
          // A line starting with ":" is a comment and is ignored per the SSE spec.
          if (line.startsWith(":")) continue
          if (line.startsWith("id: ")) fields.id = line.slice(4)
          else if (line.startsWith("data: ")) { fields.data += line.slice(6); hasData = true }
          else throw new Error(`unrecognised SSE field line: ${JSON.stringify(line)}`)
        }
        if (hasData) return fields
      }
    }
  } finally {
    await reader.cancel().catch(() => {})
  }
}

const root = await mkdtemp(path.join(os.tmpdir(), "unifia-bootstrap-"))
const handles: Array<{ stop(): Promise<void> }> = []
try {
  await writeFile(path.join(root, "README.md"), "hello from disk")
  const validKey = "unifia-bootstrap-signing-key-0123456789"

  // --- Configuration refuses to start unsafely --------------------------------
  throws(() => loadConfigFromEnv({}), "UNIFIA_WORKBENCH_SIGNING_KEY", "a missing signing key did not refuse startup")
  throws(() => loadConfigFromEnv({ UNIFIA_WORKBENCH_SIGNING_KEY: "too-short" }), "at least 32 bytes", "a short signing key did not refuse startup")
  throws(() => loadConfigFromEnv({ UNIFIA_WORKBENCH_SIGNING_KEY: validKey, UNIFIA_WORKBENCH_HOST: "0.0.0.0" }), "loopback", "a non-loopback host was accepted")
  throws(() => loadConfigFromEnv({ UNIFIA_WORKBENCH_SIGNING_KEY: validKey, UNIFIA_WORKBENCH_RUNTIME: "wat" }), "unsupported", "an unknown runtime was accepted")
  throws(() => createWorkbenchApp({ ...loadConfigFromEnv({ UNIFIA_WORKBENCH_SIGNING_KEY: validKey }), runtime: "opencode" }), "requires an OpenCodeRuntimeBackend", "runtime=opencode started without a backend")
  // Omitting a surface must fail closed, never default to permitting it.
  const bare = createWorkbenchApp(loadConfigFromEnv({ UNIFIA_WORKBENCH_SIGNING_KEY: validKey, UNIFIA_WORKBENCH_AUDIT_LOG: path.join(root, ".unifia", "audit-bare.jsonl") }))
  const bareUi = await bare.server.fetch(new Request("http://local/v1/ui/render", { method: "POST", headers: { authorization: `Bearer ${new HmacTokenAuthenticator(validKey, "unifia-local", "workbench").sign({ id: "a", scopes: new Set(["workspace.register"]), workspaces: "*" }, Date.now() + 60_000)}` }, body: JSON.stringify({ workspaceId: "x", node: { type: "text", id: "t", props: {} } }) }))
  check(bareUi.status === 503, `an unwired UI surface returned ${bareUi.status} instead of 503`)

  const baseEnv = { UNIFIA_WORKBENCH_SIGNING_KEY: validKey, UNIFIA_WORKBENCH_PORT: "0", UNIFIA_WORKBENCH_AUDIT_LOG: path.join(root, ".unifia", "audit.jsonl") }
  const config: WorkbenchConfig = loadConfigFromEnv(baseEnv)
  check(config.host === "127.0.0.1", "the default host is not loopback")

  const handle = await startWorkbench(config)
  handles.push(handle)
  check(handle.port > 0, "the listener did not bind an ephemeral port")

  // --- Real HTTP over a real socket ------------------------------------------
  const signer = new HmacTokenAuthenticator(validKey, config.issuer, config.audience)
  // workspace.read added — SEC-001/C2-3 now checks the token's own scopes
  // before the capability gate runs. This test's subject is the gate's
  // process-level default-deny (nothing allowlisted, so even a properly
  // scoped read needs approval below) — unchanged by that token-scope layer.
  const admin: Principal = { id: "admin", scopes: new Set(["workspace.register", "workspace.open", "workspace.read", "workspace.watch"]), workspaces: "*" }
  const token = signer.sign(admin, Date.now() + 300_000)
  const bearer = { authorization: `Bearer ${token}` }

  check((await fetch(`${handle.url}/v1/workspaces/register`, { method: "POST", body: JSON.stringify({ name: "boot", path: root }) })).status === 401, "an anonymous HTTP caller was not rejected")
  const forged = `${token.split(".").slice(0, 2).join(".")}.AAAAAAAA`
  check((await fetch(`${handle.url}/v1/workspaces/register`, { method: "POST", headers: { authorization: `Bearer ${forged}` }, body: JSON.stringify({ name: "boot", path: root }) })).status === 401, "a forged signature was accepted over HTTP")

  const registered = await fetch(`${handle.url}/v1/workspaces/register`, { method: "POST", headers: bearer, body: JSON.stringify({ name: "boot", path: root }) })
  check(registered.status === 201, `register over HTTP failed with ${registered.status}`)
  const workspace = await registered.json() as { id: string }

  const opened = await fetch(`${handle.url}/v1/workspaces/${workspace.id}/open`, { method: "POST", headers: bearer })
  check(opened.status === 200, `open over HTTP failed with ${opened.status}`)
  const session = await opened.json() as { id: string; token: string }
  const scoped = { ...bearer, "x-unifia-file-session": session.token }

  // Default-deny holds at the process level: nothing is allowlisted, so even a
  // correctly scoped read must be approved before it is served.
  const readFile1 = () => fetch(`${handle.url}/v1/files/read`, { method: "POST", headers: scoped, body: JSON.stringify({ workspaceId: session.id, paths: ["README.md"] }) })
  const pendingRead = await readFile1()
  check(pendingRead.status === 202, `an unapproved read returned ${pendingRead.status} instead of 202 approval_required`)
  const approval = await pendingRead.json() as { approvalId: string }
  check(typeof approval.approvalId === "string" && approval.approvalId.length > 0, "no approval id was returned")
  const resolved = await fetch(`${handle.url}/v1/approvals/${approval.approvalId}`, { method: "POST", headers: scoped, body: JSON.stringify({ decision: "allow" }) })
  check(resolved.status === 200, `approval resolve over HTTP failed with ${resolved.status}`)
  const read = await readFile1()
  check(read.status === 200, `the approved read returned ${read.status}`)
  // The content must survive JSON serialisation. Before encodeReadResult it
  // arrived as {"type":"Buffer","data":[104,...]} — undecodable for a client.
  const readBody = await read.json() as { results: Array<{ path: string; content: string; encoding: string }> }
  const entry = readBody.results[0]
  check(entry.encoding === "base64", `read result declared encoding ${entry.encoding} instead of base64`)
  check(typeof entry.content === "string", "read result content did not serialise as a string")
  check(Buffer.from(entry.content, "base64").toString("utf8") === "hello from disk", "the decoded read result did not match the file on disk")

  // --- SSE consumed as a wire format -----------------------------------------
  const created = await fetch(`${handle.url}/v1/workspaces/${session.id}/sessions`, { method: "POST", headers: scoped })
  check(created.status === 201, `session creation over HTTP failed with ${created.status}`)
  const runtimeSession = (await created.json() as { session: { id: string } }).session

  const pendingStream = await fetch(`${handle.url}/v1/sessions/${runtimeSession.id}/events`, { headers: scoped })
  check(pendingStream.status === 202, `an unapproved event stream returned ${pendingStream.status} instead of 202`)
  const watchApproval = await pendingStream.json() as { approvalId: string }
  check((await fetch(`${handle.url}/v1/approvals/${watchApproval.approvalId}`, { method: "POST", headers: scoped, body: JSON.stringify({ decision: "allow" }) })).status === 200, "approving workspace.watch failed")
  const stream = await fetch(`${handle.url}/v1/sessions/${runtimeSession.id}/events`, { headers: scoped })
  check(stream.status === 200, `event stream over HTTP failed with ${stream.status}`)
  check(stream.headers.get("content-type") === "text/event-stream", "the event stream did not declare text/event-stream")
  check(stream.body !== null, "the event stream carried no body")
  const framePromise = readFirstSseEvent(stream.body as ReadableStream<Uint8Array>)
  const prompted = await fetch(`${handle.url}/v1/sessions/${runtimeSession.id}/prompt`, { method: "POST", headers: scoped, body: JSON.stringify({ prompt: "over the wire" }) })
  check(prompted.status === 202, `prompt over HTTP failed with ${prompted.status}`)
  const frame = await framePromise
  check(frame.id === "1", `SSE frame id was ${JSON.stringify(frame.id)} instead of "1"`)
  const payload = JSON.parse(frame.data) as { data: string; sequence: number }
  check(payload.data === "over the wire" && payload.sequence === 1, "the parsed SSE payload did not carry the prompt")

  // --- Durable audit ----------------------------------------------------------
  const auditLines = (await readFile(config.auditLogPath, "utf8")).trim().split("\n").map((line) => JSON.parse(line) as { capability: string; decision: string })
  check(auditLines.length > 0, "the audit log is empty after real traffic")
  check(auditLines.some((entry) => entry.capability === "auth.principal" && entry.decision === "deny"), "the anonymous rejection was not persisted to the audit log")
  check(auditLines.some((entry) => entry.capability === "workspace.register" && entry.decision === "allow"), "the successful register was not persisted to the audit log")

  // --- Rate limiting over HTTP ------------------------------------------------
  // Each server owns its own WorkspaceRuntime, so this one must register its
  // own workspace: the budget of 2 is spent by register then open, and the
  // third request must be refused.
  const limited = await startWorkbench({ ...config, rateBudget: 2, auditLogPath: path.join(root, ".unifia", "audit-limited.jsonl") })
  handles.push(limited)
  const limitedRegister = await fetch(`${limited.url}/v1/workspaces/register`, { method: "POST", headers: bearer, body: JSON.stringify({ name: "limited", path: root }) })
  check(limitedRegister.status === 201, `register on the limited server returned ${limitedRegister.status}`)
  const limitedWorkspace = await limitedRegister.json() as { id: string }
  const secondCall = await fetch(`${limited.url}/v1/workspaces/${limitedWorkspace.id}/open`, { method: "POST", headers: bearer })
  check(secondCall.status === 200, `the second request within budget returned ${secondCall.status}`)
  const thirdCall = await fetch(`${limited.url}/v1/workspaces/${limitedWorkspace.id}/open`, { method: "POST", headers: bearer })
  check(thirdCall.status === 429, `the rate limiter did not return 429 over HTTP (got ${thirdCall.status})`)

  // A handler that throws must become an audited 400, not an escaped rejection.
  const unregistered = await fetch(`${handle.url}/v1/workspaces/workspace-does-not-exist/open`, { method: "POST", headers: bearer })
  check(unregistered.status === 400, `a rejecting handler returned ${unregistered.status} instead of an audited 400`)
  check(((await unregistered.json()) as { error?: string }).error?.includes("not registered") === true, "the handler error was not surfaced in the response body")

  // --- Clean shutdown ---------------------------------------------------------
  const app = createWorkbenchApp({ ...config, auditLogPath: path.join(root, ".unifia", "audit-shutdown.jsonl") })
  const registeredForShutdown = await app.server.fetch(new Request("http://local/v1/workspaces/register", { method: "POST", headers: bearer, body: JSON.stringify({ name: "shutdown", path: root }) }))
  const shutdownWorkspace = await registeredForShutdown.json() as { id: string }
  await app.server.fetch(new Request(`http://local/v1/workspaces/${shutdownWorkspace.id}/open`, { method: "POST", headers: bearer }))
  check(app.server.openFileSessions === 1, "the file session was not tracked before shutdown")
  check((await app.server.shutdown()).length === 0, "shutdown reported a failure closing file sessions")
  check(app.server.openFileSessions === 0, "shutdown left a file session open")

  const stoppedPort = handle.port
  await handle.stop()
  handles.shift()
  let refused = false
  try {
    await fetch(`http://127.0.0.1:${stoppedPort}/v1/workspaces/register`, { method: "POST", headers: bearer, body: JSON.stringify({ name: "after", path: root }) })
  } catch {
    refused = true
  }
  check(refused, "the port still accepted connections after stop()")

  console.log(`WorkbenchBootstrap: ${checks}/${checks} passed`)
} finally {
  for (const open of handles) await open.stop().catch(() => {})
  await rm(root, { recursive: true, force: true })
}
