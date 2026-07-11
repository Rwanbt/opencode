import { describe, test, expect, beforeAll, afterAll } from "bun:test"
import { withInProcessServer, type InProcessServer } from "../lib/in-process-server"
import { tmpdir } from "../fixture/fixture"
import { Instance } from "../../src/project/instance"
import { Session } from "../../src/session"
import { ObservabilityRepository } from "../../src/observability/repository"
import { parseObservabilityEvent } from "../../src/observability/event-schema"
import { createTraceContext } from "../../src/observability/trace-context"
import { ObservabilityId } from "../../src/observability/id"

// HTTP-level coverage for GET /observability/summary — aggregation shape and
// the same real-ownership check as the events routes.

const PASSWORD = "observability-summary-test-pw"
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

function makeEvent(
  context: ReturnType<typeof createTraceContext>,
  overrides: { type: "llm.call.started" | "llm.call.finished"; status: "started" | "finished"; costNanoUsd?: number },
) {
  const parsed = parseObservabilityEvent({
    eventId: ObservabilityId.create(),
    context,
    type: overrides.type,
    status: overrides.status,
    tsMs: Date.now(),
    enqueueSeq: 1,
    costNanoUsd: overrides.costNanoUsd,
  })
  if (!parsed.success) throw new Error("invalid fixture event: " + JSON.stringify(parsed.error))
  return parsed.data
}

async function createSession(dir: string) {
  return Instance.provide({ directory: dir, fn: () => Session.create({}) })
}

describe("GET /observability/summary", () => {
  test("aggregates counts by type/status and total cost for a session", async () => {
    await using tmp = await tmpdir()
    const session = await createSession(tmp.path)

    await ObservabilityRepository.insert([
      makeEvent(createTraceContext({ sessionId: session.id }), { type: "llm.call.started", status: "started" }),
      makeEvent(createTraceContext({ sessionId: session.id }), {
        type: "llm.call.finished",
        status: "finished",
        costNanoUsd: 1_000,
      }),
      makeEvent(createTraceContext({ sessionId: session.id }), {
        type: "llm.call.finished",
        status: "finished",
        costNanoUsd: 2_500,
      }),
    ])

    const r = await call("GET", `/observability/summary?sessionId=${session.id}`, tmp.path)
    expect(r.status).toBe(200)
    const body = (await r.json()) as {
      sessionId: string
      totalEvents: number
      totalCostNanoUsd: number
      byType: Record<string, number>
      byStatus: Record<string, number>
    }
    expect(body.sessionId).toBe(session.id)
    expect(body.totalEvents).toBe(3)
    expect(body.totalCostNanoUsd).toBe(3_500)
    expect(body.byType["llm.call.started"]).toBe(1)
    expect(body.byType["llm.call.finished"]).toBe(2)
    expect(body.byStatus["started"]).toBe(1)
    expect(body.byStatus["finished"]).toBe(2)
  })

  test("returns zeroed aggregates for a session with no events", async () => {
    await using tmp = await tmpdir()
    const session = await createSession(tmp.path)

    const r = await call("GET", `/observability/summary?sessionId=${session.id}`, tmp.path)
    expect(r.status).toBe(200)
    const body = (await r.json()) as { totalEvents: number; totalCostNanoUsd: number }
    expect(body.totalEvents).toBe(0)
    expect(body.totalCostNanoUsd).toBe(0)
  })

  test("404s for a session belonging to another project", async () => {
    await using tmpA = await tmpdir({ git: true })
    await using tmpB = await tmpdir({ git: true })
    const sessionB = await createSession(tmpB.path)

    const r = await call("GET", `/observability/summary?sessionId=${sessionB.id}`, tmpA.path)
    expect(r.status).toBe(404)
  })
})
