import { describe, test, expect, beforeAll, afterAll } from "bun:test"
import { withInProcessServer, type InProcessServer } from "../lib/in-process-server"
import { tmpdir } from "../fixture/fixture"
import { Instance } from "../../src/project/instance"
import { Session } from "../../src/session"
import { ObservabilityRepository } from "../../src/observability/repository"
import { parseObservabilityEvent } from "../../src/observability/event-schema"
import { createTraceContext } from "../../src/observability/trace-context"
import { ObservabilityId } from "../../src/observability/id"

// HTTP-level coverage for DELETE /observability/data — confirmation header
// gate, scope-by-scope deletion, and the same real-ownership check as the
// events routes (a foreign session id must 404, not silently delete).

const PASSWORD = "observability-delete-test-pw"
const AUTH = "Basic " + Buffer.from("opencode:" + PASSWORD).toString("base64")

let server: InProcessServer

beforeAll(async () => {
  server = await withInProcessServer({ password: PASSWORD })
})

afterAll(async () => {
  await server.close()
})

function call(method: string, route: string, dir: string, body?: unknown, confirm = true) {
  const sep = route.includes("?") ? "&" : "?"
  const url = `${route}${sep}directory=${encodeURIComponent(dir)}`
  const headers: Record<string, string> = { Authorization: AUTH, "Content-Type": "application/json" }
  if (confirm) headers["X-Confirm-Delete"] = "yes"
  return server.fetch(url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) })
}

function makeEvent(context: ReturnType<typeof createTraceContext>) {
  const parsed = parseObservabilityEvent({
    eventId: ObservabilityId.create(),
    context,
    type: "llm.call.started",
    status: "started",
    tsMs: Date.now(),
    enqueueSeq: 1,
  })
  if (!parsed.success) throw new Error("invalid fixture event: " + JSON.stringify(parsed.error))
  return parsed.data
}

async function createSession(dir: string) {
  return Instance.provide({ directory: dir, fn: () => Session.create({}) })
}

async function eventsFor(dir: string, sessionId: string) {
  const r = await call("GET", `/observability/events?sessionId=${sessionId}`, dir)
  return (await r.json()) as any[]
}

describe("DELETE /observability/data", () => {
  test("400s without the confirmation header", async () => {
    await using tmp = await tmpdir()
    const r = await call("DELETE", "/observability/data", tmp.path, { scope: "all" }, false)
    expect(r.status).toBe(400)
  })

  test("deletes a session's events and only that session's", async () => {
    await using tmp = await tmpdir()
    const kept = await createSession(tmp.path)
    const removed = await createSession(tmp.path)
    await ObservabilityRepository.insert([
      makeEvent(createTraceContext({ sessionId: kept.id })),
      makeEvent(createTraceContext({ sessionId: removed.id })),
    ])

    const r = await call("DELETE", "/observability/data", tmp.path, { scope: "session", id: removed.id })
    expect(r.status).toBe(200)
    const body = (await r.json()) as { deletedCount: number }
    expect(body.deletedCount).toBe(1)

    expect(await eventsFor(tmp.path, removed.id)).toHaveLength(0)
    expect(await eventsFor(tmp.path, kept.id)).toHaveLength(1)
  })

  test("404s when the session belongs to another project", async () => {
    await using tmpA = await tmpdir({ git: true })
    await using tmpB = await tmpdir({ git: true })
    const sessionB = await createSession(tmpB.path)
    await ObservabilityRepository.insert([makeEvent(createTraceContext({ sessionId: sessionB.id }))])

    const r = await call("DELETE", "/observability/data", tmpA.path, { scope: "session", id: sessionB.id })
    expect(r.status).toBe(404)
    expect(await eventsFor(tmpB.path, sessionB.id)).toHaveLength(1)
  })

  test("400s for a project scope id that doesn't match the current project", async () => {
    await using tmp = await tmpdir()
    const r = await call("DELETE", "/observability/data", tmp.path, { scope: "project", id: "proj_someone_else" })
    expect(r.status).toBe(400)
  })

  test('"all" scope deletes the given session\'s events regardless of project', async () => {
    await using tmp = await tmpdir()
    const session = await createSession(tmp.path)
    await ObservabilityRepository.insert([makeEvent(createTraceContext({ sessionId: session.id }))])
    expect(await eventsFor(tmp.path, session.id)).toHaveLength(1)

    const r = await call("DELETE", "/observability/data", tmp.path, { scope: "all" })
    expect(r.status).toBe(200)
    const body = (await r.json()) as { deletedCount: number }
    expect(body.deletedCount).toBeGreaterThan(0)

    expect(await eventsFor(tmp.path, session.id)).toHaveLength(0)
  })
})
