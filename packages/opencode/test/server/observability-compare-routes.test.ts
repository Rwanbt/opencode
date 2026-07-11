import { describe, test, expect, beforeAll, afterAll } from "bun:test"
import { withInProcessServer, type InProcessServer } from "../lib/in-process-server"
import { tmpdir } from "../fixture/fixture"
import { Instance } from "../../src/project/instance"
import { Session } from "../../src/session"
import { ObservabilityRepository } from "../../src/observability/repository"
import { parseObservabilityEvent } from "../../src/observability/event-schema"
import { createTraceContext } from "../../src/observability/trace-context"
import { ObservabilityId } from "../../src/observability/id"

// HTTP-level coverage for GET /observability/compare — this route's handler
// previously returned the bare CohortComparisonResult[] from
// ObservabilityRepository.compareCohorts() via c.json(result), while both
// the documented CompareSchema and the UI (settings-observability.tsx's
// `comparison()?.cohorts`) expect it wrapped in { cohorts: [...] }. Nothing
// caught this at the type level because the OpenAPI response schema was
// declared correctly even though the handler didn't honor it — only an
// actual HTTP response body assertion (not just a 200 status check) would.

const PASSWORD = "observability-compare-test-pw"
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
  overrides: {
    type: "llm.call.finished" | "llm.call.failed"
    status: "finished" | "failed"
    modelProvider?: string
    modelId?: string
    durationMs?: number
    costNanoUsd?: number
  },
) {
  const parsed = parseObservabilityEvent({
    eventId: ObservabilityId.create(),
    context,
    type: overrides.type,
    status: overrides.status,
    tsMs: Date.now(),
    durationMs: overrides.durationMs,
    enqueueSeq: 1,
    costNanoUsd: overrides.costNanoUsd,
    metadata: { modelProvider: overrides.modelProvider, modelId: overrides.modelId },
  })
  if (!parsed.success) throw new Error("invalid fixture event: " + JSON.stringify(parsed.error))
  return parsed.data
}

async function createSession(dir: string) {
  return Instance.provide({ directory: dir, fn: () => Session.create({}) })
}

describe("GET /observability/compare", () => {
  test("response body is an object with a cohorts array, not a bare array", async () => {
    // {git: true} — a non-git tmpdir resolves to the shared ProjectID.global
    // (project.ts's fromDirectory fallback), which would leak this event
    // into the "no data" test below instead of proving per-project scoping.
    await using tmp = await tmpdir({ git: true })
    const session = await createSession(tmp.path)
    const projectId = await Instance.provide({ directory: tmp.path, fn: () => Instance.project.id })

    await ObservabilityRepository.insert([
      makeEvent(createTraceContext({ sessionId: session.id, projectId }), {
        type: "llm.call.finished",
        status: "finished",
        modelProvider: "anthropic",
        modelId: "claude-sonnet-5",
        durationMs: 1000,
        costNanoUsd: 1_000_000,
      }),
    ])

    const r = await call("GET", "/observability/compare", tmp.path)
    expect(r.status).toBe(200)
    const body = await r.json()
    expect(Array.isArray(body)).toBe(false)
    expect(Array.isArray(body.cohorts)).toBe(true)
    expect(body.cohorts).toHaveLength(1)
    expect(body.cohorts[0]).toMatchObject({ modelProvider: "anthropic", modelId: "claude-sonnet-5" })
  })

  test("returns an empty cohorts array, not a 404 or a bare [], when no data exists", async () => {
    await using tmp = await tmpdir({ git: true })

    const r = await call("GET", "/observability/compare", tmp.path)
    expect(r.status).toBe(200)
    const body = await r.json()
    expect(body).toEqual({ cohorts: [] })
  })
})
