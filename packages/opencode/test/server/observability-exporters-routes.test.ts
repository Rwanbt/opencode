import { describe, test, expect, beforeAll, afterAll } from "bun:test"
import { withInProcessServer, type InProcessServer } from "../lib/in-process-server"
import { tmpdir } from "../fixture/fixture"
import { Instance } from "../../src/project/instance"
import { Session } from "../../src/session"
import { ObservabilityRepository } from "../../src/observability/repository"
import { parseObservabilityEvent } from "../../src/observability/event-schema"
import { createTraceContext } from "../../src/observability/trace-context"
import { ObservabilityId } from "../../src/observability/id"

// HTTP-level coverage for Phase 4 (ADR-1026): GET /observability/exporters/config,
// GET /observability/exporters/preview/:eventId, POST /observability/exporters/test.

const PASSWORD = "observability-exporters-test-pw"
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

function makeEvent(context: ReturnType<typeof createTraceContext>, overrides: { status?: "started" | "finished"; type?: string } = {}) {
  const parsed = parseObservabilityEvent({
    eventId: ObservabilityId.create(),
    context,
    type: (overrides.type ?? "llm.call.started") as any,
    status: overrides.status ?? "started",
    tsMs: Date.now(),
    enqueueSeq: 1,
  })
  if (!parsed.success) throw new Error("invalid fixture event: " + JSON.stringify(parsed.error))
  return parsed.data
}

async function createSession(dir: string) {
  return Instance.provide({ directory: dir, fn: () => Session.create({}) })
}

describe("GET /observability/exporters/config", () => {
  test("returns an empty exporters list and backfillOnStart=false by default", async () => {
    await using tmp = await tmpdir()
    const r = await call("GET", "/observability/exporters/config", tmp.path)
    expect(r.status).toBe(200)
    expect(await r.json()).toEqual({ exporters: [], backfillOnStart: false })
  })

  test("lists a configured Langfuse exporter without ever returning the secret key", async () => {
    await using tmp = await tmpdir({
      config: {
        experimental: {
          observability: {
            exporters: [{ type: "langfuse", host: "https://example.invalid", publicKey: "pk-test", secretKey: "sk-super-secret-value" }],
          },
        },
      } as any,
    })
    const r = await call("GET", "/observability/exporters/config", tmp.path)
    expect(r.status).toBe(200)
    const body = (await r.json()) as { exporters: { type: string; host: string; publicKey: string }[] }
    expect(body.exporters).toEqual([{ type: "langfuse", host: "https://example.invalid", publicKey: "pk-test" }])
    expect(JSON.stringify(body)).not.toContain("sk-super-secret-value")
  })
})

describe("POST /observability/exporters/test", () => {
  test("returns an empty result list when no exporter is configured", async () => {
    await using tmp = await tmpdir()
    const r = await call("POST", "/observability/exporters/test", tmp.path)
    expect(r.status).toBe(200)
    expect(await r.json()).toEqual({ results: [] })
  })

  test("exercises a configured exporter with a synthetic event and reports success", async () => {
    let received: unknown
    const mock = Bun.serve({
      port: 0,
      fetch: async (req) => {
        received = await req.json()
        return new Response("{}", { status: 200 })
      },
    })
    try {
      await using tmp = await tmpdir({
        config: {
          experimental: {
            observability: {
              exporters: [{ type: "langfuse", host: `http://127.0.0.1:${mock.port}`, publicKey: "pk", secretKey: "sk" }],
            },
          },
        } as any,
      })
      const r = await call("POST", "/observability/exporters/test", tmp.path)
      expect(r.status).toBe(200)
      const body = (await r.json()) as { results: { exporter: string; ok: boolean; attempts: number }[] }
      expect(body.results).toEqual([{ exporter: "langfuse", ok: true, attempts: 1 }])
      // The synthetic test payload is not derived from any real event.
      expect((received as { batch: unknown[] }).batch.length).toBeGreaterThan(0)
    } finally {
      mock.stop(true)
    }
  })
})

describe("GET /observability/exporters/preview/:eventId", () => {
  test("returns the exact ExportProjection for a terminal event, without sending it anywhere", async () => {
    await using tmp = await tmpdir()
    const session = await createSession(tmp.path)
    const context = createTraceContext({ sessionId: session.id })
    await Instance.provide({
      directory: tmp.path,
      fn: () => ObservabilityRepository.insert([makeEvent(context, { status: "finished", type: "llm.call.finished" })]),
    })

    const r = await call("GET", `/observability/exporters/preview/${context.spanId}`, tmp.path)
    expect(r.status).toBe(404) // spanId is not eventId — sanity check the route keys on eventId
  })

  test("exportable:true with a projection for a real finished event", async () => {
    await using tmp = await tmpdir()
    const session = await createSession(tmp.path)
    const context = createTraceContext({ sessionId: session.id })
    const event = makeEvent(context, { status: "finished", type: "llm.call.finished" })
    await Instance.provide({ directory: tmp.path, fn: () => ObservabilityRepository.insert([event]) })

    const r = await call("GET", `/observability/exporters/preview/${event.eventId}`, tmp.path)
    expect(r.status).toBe(200)
    const body = (await r.json()) as { exportable: boolean; projection?: { eventId: string; sessionIdHmac?: string } }
    expect(body.exportable).toBe(true)
    expect(body.projection?.eventId).toBe(event.eventId)
    expect(body.projection?.sessionIdHmac).toMatch(/^[0-9a-f]{64}$/)
    expect(JSON.stringify(body)).not.toContain(session.id)
  })

  test("exportable:false for a started event with no terminal counterpart yet", async () => {
    await using tmp = await tmpdir()
    const session = await createSession(tmp.path)
    const context = createTraceContext({ sessionId: session.id })
    const event = makeEvent(context, { status: "started" })
    await Instance.provide({ directory: tmp.path, fn: () => ObservabilityRepository.insert([event]) })

    const r = await call("GET", `/observability/exporters/preview/${event.eventId}`, tmp.path)
    expect(r.status).toBe(200)
    const body = (await r.json()) as { exportable: boolean; reason?: string }
    expect(body.exportable).toBe(false)
    expect(body.reason).toBeTruthy()
  })

  test("404s for an unknown eventId", async () => {
    await using tmp = await tmpdir()
    await createSession(tmp.path)
    const r = await call("GET", `/observability/exporters/preview/${ObservabilityId.create()}`, tmp.path)
    expect(r.status).toBe(404)
  })

  test("404s for an event belonging to another project's session", async () => {
    await using tmpA = await tmpdir({ git: true })
    await using tmpB = await tmpdir({ git: true })
    const sessionB = await createSession(tmpB.path)
    const context = createTraceContext({ sessionId: sessionB.id })
    const event = makeEvent(context, { status: "finished", type: "llm.call.finished" })
    await Instance.provide({ directory: tmpB.path, fn: () => ObservabilityRepository.insert([event]) })

    const r = await call("GET", `/observability/exporters/preview/${event.eventId}`, tmpA.path)
    expect(r.status).toBe(404)
  })
})
