import { describe, test, expect, beforeAll, afterAll } from "bun:test"
import { withInProcessServer, type InProcessServer } from "../lib/in-process-server"
import { tmpdir } from "../fixture/fixture"
import { Instance } from "../../src/project/instance"
import { Session } from "../../src/session"
import { ObservabilityRepository } from "../../src/observability/repository"
import { parseObservabilityEvent } from "../../src/observability/event-schema"
import { createTraceContext } from "../../src/observability/trace-context"
import { ObservabilityId } from "../../src/observability/id"

// HTTP-level coverage for the observability events routes — pins keyset
// pagination and the cross-project ownership check (ADR-1028: a session's
// project must match the requesting instance, verified via the real
// session -> project relation, not a client-supplied scope value).

const PASSWORD = "observability-events-test-pw"
const AUTH = "Basic " + Buffer.from("opencode:" + PASSWORD).toString("base64")

let server: InProcessServer

beforeAll(async () => {
  server = await withInProcessServer({ password: PASSWORD })
})

afterAll(async () => {
  await server.close()
})

function call(method: string, route: string, dir: string) {
  const sep = route.includes("?") ? "&" : "?"
  const url = `${route}${sep}directory=${encodeURIComponent(dir)}`
  return server.fetch(url, { method, headers: { Authorization: AUTH } })
}

function makeEvent(context: ReturnType<typeof createTraceContext>, tsMs: number) {
  const parsed = parseObservabilityEvent({
    eventId: ObservabilityId.create(),
    context,
    type: "llm.call.started",
    status: "started",
    tsMs,
    enqueueSeq: 1,
  })
  if (!parsed.success) throw new Error("invalid fixture event: " + JSON.stringify(parsed.error))
  return parsed.data
}

async function createSession(dir: string) {
  return Instance.provide({ directory: dir, fn: () => Session.create({}) })
}

describe("GET /observability/events", () => {
  test("lists a session's events newest first, keyset paginated", async () => {
    await using tmp = await tmpdir()
    const session = await createSession(tmp.path)

    const base = Date.now()
    await ObservabilityRepository.insert([
      makeEvent(createTraceContext({ sessionId: session.id }), base),
      makeEvent(createTraceContext({ sessionId: session.id }), base + 10),
      makeEvent(createTraceContext({ sessionId: session.id }), base + 20),
    ])

    const r1 = await call("GET", `/observability/events?sessionId=${session.id}&limit=2`, tmp.path)
    expect(r1.status).toBe(200)
    const page1 = (await r1.json()) as any[]
    expect(page1).toHaveLength(2)
    expect(page1[0].tsMs).toBe(base + 20)
    expect(page1[1].tsMs).toBe(base + 10)
    expect(page1[0].sessionId).toBe(session.id)
    const nextCursor = r1.headers.get("x-next-cursor")
    expect(nextCursor).toBeTruthy()

    const r2 = await call(
      "GET",
      `/observability/events?sessionId=${session.id}&limit=2&before=${encodeURIComponent(nextCursor!)}`,
      tmp.path,
    )
    expect(r2.status).toBe(200)
    const page2 = (await r2.json()) as any[]
    expect(page2).toHaveLength(1)
    expect(page2[0].tsMs).toBe(base)
    expect(r2.headers.get("x-next-cursor")).toBeNull()
  })

  test("404s for a session belonging to another project", async () => {
    // Needs its own git repo per dir — without .git, Project.fromDirectory
    // falls back to the shared ProjectID.global for every directory, which
    // would make this assertion pass for the wrong reason.
    await using tmpA = await tmpdir({ git: true })
    await using tmpB = await tmpdir({ git: true })
    const sessionB = await createSession(tmpB.path)

    const r = await call("GET", `/observability/events?sessionId=${sessionB.id}`, tmpA.path)
    expect(r.status).toBe(404)
  })

  test("404s for an unknown but well-formed session id", async () => {
    await using tmp = await tmpdir()
    const r = await call("GET", "/observability/events?sessionId=ses_doesnotexist", tmp.path)
    expect(r.status).toBe(404)
  })

  test("400s for a malformed session id", async () => {
    await using tmp = await tmpdir()
    const r = await call("GET", "/observability/events?sessionId=not-a-session-id", tmp.path)
    expect(r.status).toBe(400)
  })
})

describe("GET /observability/events/:eventId", () => {
  test("returns the event when its session belongs to the current project", async () => {
    await using tmp = await tmpdir()
    const session = await createSession(tmp.path)
    const event = makeEvent(createTraceContext({ sessionId: session.id }), Date.now())
    await ObservabilityRepository.insert([event])

    const r = await call("GET", `/observability/events/${event.eventId}`, tmp.path)
    expect(r.status).toBe(200)
    const body = (await r.json()) as any
    expect(body.eventId).toBe(event.eventId)
    expect(body.sessionId).toBe(session.id)
  })

  test("404s for an event whose session belongs to another project", async () => {
    await using tmpA = await tmpdir({ git: true })
    await using tmpB = await tmpdir({ git: true })
    const sessionB = await createSession(tmpB.path)
    const event = makeEvent(createTraceContext({ sessionId: sessionB.id }), Date.now())
    await ObservabilityRepository.insert([event])

    const r = await call("GET", `/observability/events/${event.eventId}`, tmpA.path)
    expect(r.status).toBe(404)
  })

  test("404s for an unknown eventId", async () => {
    await using tmp = await tmpdir()
    const r = await call("GET", "/observability/events/nonexistent-event-id", tmp.path)
    expect(r.status).toBe(404)
  })
})
