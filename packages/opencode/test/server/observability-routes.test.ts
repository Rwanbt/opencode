import { describe, test, expect, beforeAll, afterAll } from "bun:test"
import { withInProcessServer, type InProcessServer } from "../lib/in-process-server"
import { tmpdir } from "../fixture/fixture"
import { Instance } from "../../src/project/instance"
import { Session } from "../../src/session"
import { ObservabilityRepository } from "../../src/observability/repository"
import { createTraceContext } from "../../src/observability/trace-context"
import { ObservabilityId } from "../../src/observability/id"
import { parseObservabilityEvent } from "../../src/observability/event-schema"

// HTTP-level coverage for the observability read routes (health/settings).
// Pins the route + middleware wiring (auth, WorkspaceRouterMiddleware
// directory scoping, describeRoute-driven JSON shape) — unit tests for the
// underlying logic (capture-policy.ts, service.ts) live in test/observability.

const PASSWORD = "observability-routes-test-pw"
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
  return server.fetch(url, {
    method,
    headers: { Authorization: AUTH, "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
}

describe("GET /observability/health", () => {
  test("reflects the current instance's capture policy and queue stats", async () => {
    await using tmp = await tmpdir({
      config: { experimental: { observability: { enabled: true, captureMode: "local_redacted" } } } as any,
    })

    const r = await call("GET", "/observability/health", tmp.path)
    expect(r.status).toBe(200)
    const body = (await r.json()) as {
      enabled: boolean
      captureMode: string
      circuitOpen: boolean
      eventsInserted: number
      eventsFailedDb: number
      queueSize: number
      queueBytes: number
    }
    expect(body.enabled).toBe(true)
    expect(body.captureMode).toBe("local_redacted")
    expect(body.circuitOpen).toBe(false)
    expect(typeof body.eventsInserted).toBe("number")
    expect(typeof body.eventsFailedDb).toBe("number")
    expect(typeof body.queueSize).toBe("number")
    expect(typeof body.queueBytes).toBe("number")
  })

  test("defaults to disabled/metadata-only when unconfigured", async () => {
    await using tmp = await tmpdir()

    const r = await call("GET", "/observability/health", tmp.path)
    expect(r.status).toBe(200)
    const body = (await r.json()) as { enabled: boolean; captureMode: string }
    expect(body.enabled).toBe(false)
    expect(body.captureMode).toBe("local_metadata")
  })
})

describe("GET /observability/settings", () => {
  test("discloses storage flags alongside the resolved policy", async () => {
    await using tmp = await tmpdir({
      config: { experimental: { observability: { enabled: true, captureMode: "local_redacted" } } } as any,
    })

    const r = await call("GET", "/observability/settings", tmp.path)
    expect(r.status).toBe(200)
    const body = (await r.json()) as {
      enabled: boolean
      captureMode: string
      policyVersion: number
      localFullAvailable: boolean
      maxOptInTtlDays: number
      storage: string
    }
    expect(body.enabled).toBe(true)
    expect(body.captureMode).toBe("local_redacted")
    expect(body.policyVersion).toBe(3)
    // Phase 3 (ADR-1032): local_full/local_content_redacted are reachable as
    // a capability — via a per-scope opt-in (GET/PUT /observability/privacy),
    // never on by default. This flag communicates the capability exists, not
    // that it's currently active for this project.
    expect(body.localFullAvailable).toBe(true)
    expect(body.maxOptInTtlDays).toBeGreaterThan(0)
    expect(body.storage).toBe("sqlite_unencrypted_local")
  })
})

describe("GET /observability/sessions", () => {
  test("defaults to sessions in the current project and allows an explicit all-projects scope", async () => {
    await using tmpA = await tmpdir({ git: true })
    await using tmpB = await tmpdir({ git: true })
    const sessionA = await Instance.provide({ directory: tmpA.path, fn: () => Session.create({}) })
    const sessionB = await Instance.provide({ directory: tmpB.path, fn: () => Session.create({}) })

    for (const session of [sessionA, sessionB]) {
      const parsed = parseObservabilityEvent({
        eventId: ObservabilityId.create(),
        context: createTraceContext({ sessionId: session.id, projectId: session.projectID }),
        type: "llm.call.started",
        status: "started",
        tsMs: Date.now(),
        enqueueSeq: 1,
      })
      if (!parsed.success) throw new Error("invalid session fixture event")
      await ObservabilityRepository.insert([parsed.data])
    }
    const projectScoped = await call("GET", "/observability/sessions", tmpA.path)
    expect(projectScoped.status).toBe(200)
    const projectSessions = (await projectScoped.json()) as Array<{ id: string }>
    expect(projectSessions.map((session) => session.id)).toContain(sessionA.id)
    expect(projectSessions.map((session) => session.id)).not.toContain(sessionB.id)

    const allScoped = await call("GET", "/observability/sessions?scope=all", tmpA.path)
    expect(allScoped.status).toBe(200)
    const allSessions = (await allScoped.json()) as Array<{ id: string }>
    expect(allSessions.map((session) => session.id)).toEqual(expect.arrayContaining([sessionA.id, sessionB.id]))
  })
})
