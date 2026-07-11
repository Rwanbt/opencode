import { describe, test, expect, beforeAll, afterAll } from "bun:test"
import { withInProcessServer, type InProcessServer } from "../lib/in-process-server"
import { tmpdir } from "../fixture/fixture"

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
  test("discloses Phase 1 storage flags alongside the resolved policy", async () => {
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
      storage: string
    }
    expect(body.enabled).toBe(true)
    expect(body.captureMode).toBe("local_redacted")
    expect(body.policyVersion).toBe(3)
    expect(body.localFullAvailable).toBe(false)
    expect(body.storage).toBe("sqlite_unencrypted_local")
  })
})
