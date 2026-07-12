import { describe, test, expect, beforeAll, afterAll } from "bun:test"
import { withInProcessServer, type InProcessServer } from "../lib/in-process-server"
import { tmpdir } from "../fixture/fixture"
import { Instance } from "../../src/project/instance"
import { Session } from "../../src/session"
import { ObservabilityRepository } from "../../src/observability/repository"
import { parseObservabilityEvent } from "../../src/observability/event-schema"
import { createTraceContext } from "../../src/observability/trace-context"
import { ObservabilityId } from "../../src/observability/id"

// HTTP-level coverage for Phase 3 (ADR-1032): GET/PUT /observability/privacy,
// POST /observability/privacy/revoke, and GET /observability/trace/:traceId.
// Same ownership pattern as observability-delete-routes.test.ts: a foreign
// session/project must 404, never silently act on someone else's scope.

const PASSWORD = "observability-privacy-test-pw"
const AUTH = "Basic " + Buffer.from("opencode:" + PASSWORD).toString("base64")

let server: InProcessServer

beforeAll(async () => {
  server = await withInProcessServer({ password: PASSWORD })
})

afterAll(async () => {
  await server.close()
})

function call(method: string, route: string, dir: string, body?: unknown) {
  const sep = route.includes("?") ? "&" : "?"
  const url = `${route}${sep}directory=${encodeURIComponent(dir)}`
  const headers: Record<string, string> = { Authorization: AUTH, "Content-Type": "application/json" }
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

describe("GET/PUT /observability/privacy", () => {
  test("GET returns optIn: null when nothing is opted in", async () => {
    await using tmp = await tmpdir()
    const session = await createSession(tmp.path)
    const r = await call("GET", `/observability/privacy?scope=session&id=${session.id}`, tmp.path)
    expect(r.status).toBe(200)
    expect(await r.json()).toEqual({ optIn: null })
  })

  test("PUT creates an opt-in, then GET reflects it", async () => {
    await using tmp = await tmpdir()
    const session = await createSession(tmp.path)

    const put = await call("PUT", "/observability/privacy", tmp.path, { scope: "session", id: session.id, level: "local_full", ttlDays: 3 })
    expect(put.status).toBe(200)
    const created = (await put.json()) as { scope: string; scopeId: string; level: string; ttlDays: number }
    expect(created).toMatchObject({ scope: "session", scopeId: session.id, level: "local_full", ttlDays: 3 })

    const get = await call("GET", `/observability/privacy?scope=session&id=${session.id}`, tmp.path)
    const body = (await get.json()) as { optIn: { level: string; ttlDays: number } | null }
    expect(body.optIn).toMatchObject({ level: "local_full", ttlDays: 3 })
  })

  test("PUT rejects a ttlDays beyond the maximum with 400", async () => {
    await using tmp = await tmpdir()
    const session = await createSession(tmp.path)
    const r = await call("PUT", "/observability/privacy", tmp.path, { scope: "session", id: session.id, level: "local_full", ttlDays: 9999 })
    expect(r.status).toBe(400)
  })

  test("GET/PUT 404 for a session belonging to another project", async () => {
    await using tmpA = await tmpdir({ git: true })
    await using tmpB = await tmpdir({ git: true })
    const sessionB = await createSession(tmpB.path)

    const get = await call("GET", `/observability/privacy?scope=session&id=${sessionB.id}`, tmpA.path)
    expect(get.status).toBe(404)

    const put = await call("PUT", "/observability/privacy", tmpA.path, { scope: "session", id: sessionB.id, level: "local_full", ttlDays: 1 })
    expect(put.status).toBe(404)
  })

  test("PUT 404s for a project scope id that doesn't match the current project", async () => {
    // Unlike DELETE /data's project branch (which 400s — a plain validation
    // error, not an ownership probe), the privacy routes treat all three
    // scopes uniformly through requireOwnedScope() -> the same non-revealing
    // 404 as session/workspace.
    await using tmp = await tmpdir()
    const r = await call("PUT", "/observability/privacy", tmp.path, { scope: "project", id: "proj_someone_else", level: "local_full", ttlDays: 1 })
    expect(r.status).toBe(404)
  })
})

describe("POST /observability/privacy/revoke", () => {
  test("revoking clears the opt-in and previously-captured content, keeps the row", async () => {
    await using tmp = await tmpdir()
    const session = await createSession(tmp.path)
    await call("PUT", "/observability/privacy", tmp.path, { scope: "session", id: session.id, level: "local_full", ttlDays: 5 })
    await ObservabilityRepository.insert([
      { ...makeEvent(createTraceContext({ sessionId: session.id })), localFull: "captured before revoke", contentExpiresAtMs: Date.now() + 999_999_999 },
    ])

    const revoke = await call("POST", "/observability/privacy/revoke", tmp.path, { scope: "session", id: session.id })
    expect(revoke.status).toBe(200)
    const body = (await revoke.json()) as { revoked: boolean; contentCleared: number }
    expect(body.revoked).toBe(true)
    expect(body.contentCleared).toBeGreaterThan(0)

    const get = await call("GET", `/observability/privacy?scope=session&id=${session.id}`, tmp.path)
    expect((await get.json()) as { optIn: unknown }).toEqual({ optIn: null })

    const events = await call("GET", `/observability/events?sessionId=${session.id}`, tmp.path)
    const rows = (await events.json()) as { localFull?: string }[]
    expect(rows).toHaveLength(1)
    expect(rows[0].localFull).toBeUndefined()
  })

  test("404s revoking a session belonging to another project", async () => {
    await using tmpA = await tmpdir({ git: true })
    await using tmpB = await tmpdir({ git: true })
    const sessionB = await createSession(tmpB.path)
    const r = await call("POST", "/observability/privacy/revoke", tmpA.path, { scope: "session", id: sessionB.id })
    expect(r.status).toBe(404)
  })
})

describe("GET /observability/trace/:traceId", () => {
  test("returns every event sharing the traceId, oldest first", async () => {
    await using tmp = await tmpdir()
    const session = await createSession(tmp.path)
    const context = createTraceContext({ sessionId: session.id })
    const older = { ...makeEvent(context), tsMs: 1000 }
    const newer = { ...makeEvent(context), type: "llm.call.finished" as const, status: "finished" as const, tsMs: 2000 }
    await ObservabilityRepository.insert([newer, older])

    const r = await call("GET", `/observability/trace/${context.traceId}`, tmp.path)
    expect(r.status).toBe(200)
    const body = (await r.json()) as { traceId: string; events: { tsMs: number }[] }
    expect(body.traceId).toBe(context.traceId)
    expect(body.events).toHaveLength(2)
    expect(body.events[0].tsMs).toBeLessThan(body.events[1].tsMs)
  })

  test("404s for an unknown traceId", async () => {
    await using tmp = await tmpdir()
    await createSession(tmp.path)
    const r = await call("GET", `/observability/trace/${ObservabilityId.create()}`, tmp.path)
    expect(r.status).toBe(404)
  })

  test("404s for a trace belonging to another project's session", async () => {
    await using tmpA = await tmpdir({ git: true })
    await using tmpB = await tmpdir({ git: true })
    const sessionB = await createSession(tmpB.path)
    const context = createTraceContext({ sessionId: sessionB.id })
    await ObservabilityRepository.insert([makeEvent(context)])

    const r = await call("GET", `/observability/trace/${context.traceId}`, tmpA.path)
    expect(r.status).toBe(404)
  })
})
