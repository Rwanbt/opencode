import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import path from "node:path"
import { withInProcessServer, type InProcessServer } from "../lib/in-process-server"
import { Global } from "../../src/global"
import { TeamStore } from "../../src/team/team-store"
import { TEAM_STORE_SCHEMA_VERSION } from "../../src/team/team-store.sql"
import { closeTeamStore, teamRunRegistry } from "../../src/server/routes/team"

// HTTP contract coverage for the Team routes (TEAM-L02). These hit the real
// server through the real router, so what is pinned here is the contract a
// client actually sees — status codes, envelope shape, cursor behaviour and
// redaction — not the store functions underneath.

const PASSWORD = "team-routes-test-pw"
const AUTH = "Basic " + Buffer.from("opencode:" + PASSWORD).toString("base64")

const GITHUB_TOKEN = "ghp_" + "a".repeat(36)
const AWS_KEY = "AKIA" + "B".repeat(16)

let server: InProcessServer

beforeAll(async () => {
  // Seeded before the server answers its first request: the route opens this
  // same file lazily, so the rows must exist by the time it does. The seeding
  // connection is closed immediately — the preload's own afterAll removes the
  // temp directory, and it runs before this file's, so a handle held here
  // fails teardown with EACCES on Windows.
  const store = TeamStore.open(path.join(Global.Path.data, "team.db"))
  await store.createRun({ runId: "run-alpha", planId: "plan-1", status: "completed" })
  await store.createRun({ runId: "run-beta", planId: "plan-2", status: "running" })
  await store.createTask({
    taskId: "task-1",
    runId: "run-alpha",
    dependsOn: [],
    scope: { files: ["src/a.ts"], note: `token=${GITHUB_TOKEN}` },
  })
  for (let i = 1; i <= 120; i++) {
    await store.appendEvent("run-alpha", `event-${i}`, "task.progress", { i })
  }
  await store.appendEvent("run-beta", "event-secret", "worker.env", { env: `AWS_ACCESS_KEY_ID=${AWS_KEY}` })
  store.close()

  server = await withInProcessServer({ password: PASSWORD })
})

afterAll(async () => {
  await server.close()
  // The route's store is a module-level connection with process lifetime.
  // Left open it keeps the temp data directory locked and teardown fails.
  closeTeamStore()
})

function get(route: string) {
  const sep = route.includes("?") ? "&" : "?"
  return server.fetch(`${route}${sep}directory=${encodeURIComponent(process.cwd())}`, {
    headers: { Authorization: AUTH },
  })
}

function post(route: string) {
  return server.fetch(`${route}?directory=${encodeURIComponent(process.cwd())}`, {
    method: "POST",
    headers: { Authorization: AUTH },
  })
}

describe("POST /team/runs/:id lifecycle controls", () => {
  test("pause, resume and cancel control the active in-process run", async () => {
    const runID = "run-http-control"
    teamRunRegistry.register(runID)
    try {
      const paused = await post(`/team/runs/${runID}/pause`)
      expect(paused.status).toBe(200)
      expect((await paused.json()).controlStatus).toBe("paused")

      const resumed = await post(`/team/runs/${runID}/resume`)
      expect(resumed.status).toBe(200)
      expect((await resumed.json()).controlStatus).toBe("running")

      const cancelled = await post(`/team/runs/${runID}/cancel`)
      expect(cancelled.status).toBe(200)
      expect((await cancelled.json()).controlStatus).toBe("cancelled")
    } finally {
      teamRunRegistry.finish(runID)
    }
  })

  test("returns 409 for a run not owned by this process", async () => {
    const response = await post("/team/runs/run-not-active/pause")
    expect(response.status).toBe(409)
  })
})
describe("GET /team/runs — success and versioning", () => {
  test("returns the seeded runs in a versioned envelope", async () => {
    const response = await get("/team/runs")
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.schemaVersion).toBe(TEAM_STORE_SCHEMA_VERSION)
    expect(body.items.map((run: { runId: string }) => run.runId).sort()).toEqual(["run-alpha", "run-beta"])
    expect(body.nextCursor).toBeNull()
  })

  test("each row carries the schema version it was written under", async () => {
    // Not the server's version: a client holding a row needs to know which
    // schema produced it, which is not the same question as when it fetched it.
    const body = await (await get("/team/runs")).json()

    for (const run of body.items) expect(run.schemaVersion).toBe(TEAM_STORE_SCHEMA_VERSION)
  })

  test("fetches a single run", async () => {
    const response = await get("/team/runs/run-alpha")
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body).toMatchObject({ runId: "run-alpha", planId: "plan-1", status: "completed" })
  })
})

describe("GET /team/runs — errors", () => {
  // Authentication is NOT covered here, and deliberately so. It is applied
  // app-wide by JwtAuth.middleware() in server.ts, so these routes carry no
  // auth code of their own — and the in-process harness cannot exercise it
  // anyway: Flag reads process.env at module import, which happens when
  // in-process-server.ts is imported, before withInProcessServer() sets the
  // password. Measured: process.env holds the password, Flag holds undefined,
  // so the Basic-auth branch takes `if (!password) return next()`. Asserting
  // 401 here would only pin the harness's blind spot. See R-TESTHARNESS-001.

  test("an unknown run is 404, not an empty 200", async () => {
    const response = await get("/team/runs/run-ghost")

    expect(response.status).toBe(404)
    expect((await response.json()).error).toContain("run-ghost")
  })

  test("an unknown run's tasks and events are 404, not empty lists", async () => {
    // An empty list would be indistinguishable from a real run that has no
    // tasks yet, and a client would render "no work" instead of "wrong id".
    expect((await get("/team/runs/run-ghost/tasks")).status).toBe(404)
    expect((await get("/team/runs/run-ghost/events")).status).toBe(404)
    expect((await get("/team/runs/run-ghost/gates")).status).toBe(404)
  })

  test("a stale cursor is 400, not an empty page", async () => {
    const response = await get("/team/runs?cursor=run-that-was-deleted")

    expect(response.status).toBe(400)
    expect((await response.json()).error).toContain("cursor")
  })

  test("an out-of-range limit is 400 rather than silently clamped", async () => {
    for (const limit of ["0", "-1", "1.5", "100000", "abc"]) {
      expect((await get(`/team/runs?limit=${limit}`)).status).toBe(400)
    }
  })

  test("an unknown query parameter is rejected, not ignored", async () => {
    // Ignoring `?statuss=running` returns every run and the caller reads it as
    // "they are all running".
    const response = await get("/team/runs?statuss=running")

    expect(response.status).toBe(400)
    expect((await response.json()).error).toContain("statuss")
  })
})

describe("GET /team/runs/:id/events — replay under load", () => {
  test("drains 120 events across pages with no gap and no repeat", async () => {
    const seen: number[] = []
    let cursor: string | null = null
    let pages = 0

    for (;;) {
      const route: string =
        cursor === null ? "/team/runs/run-alpha/events?limit=25" : `/team/runs/run-alpha/events?limit=25&cursor=${cursor}`
      const body: { items: { sequence: number }[]; nextCursor: string | null } = await (await get(route)).json()
      seen.push(...body.items.map((event: { sequence: number }) => event.sequence))
      pages++
      if (body.nextCursor === null) break
      cursor = body.nextCursor
      if (pages > 100) throw new Error("pagination did not terminate")
    }

    expect(seen).toEqual(Array.from({ length: 120 }, (_, i) => i + 1))
    expect(pages).toBe(Math.ceil(120 / 25))
  })

  test("resumes from a cursor rather than restarting", async () => {
    const body = await (await get("/team/runs/run-alpha/events?cursor=100")).json()

    expect(body.items[0].sequence).toBe(101)
    expect(body.items).toHaveLength(20)
  })

  test("a cursor that is not a sequence is 400", async () => {
    expect((await get("/team/runs/run-alpha/events?cursor=nonsense")).status).toBe(400)
  })
})

describe("Team routes — no raw secret crosses the boundary", () => {
  test("redacts a credential in an event payload", async () => {
    const raw = await (await get("/team/runs/run-beta/events")).text()

    expect(raw).not.toContain(AWS_KEY)
    expect(raw).toContain("REDACTED")
  })

  test("redacts a credential in a task scope", async () => {
    const raw = await (await get("/team/runs/run-alpha/tasks")).text()

    expect(raw).not.toContain(GITHUB_TOKEN)
    expect(raw).toContain("REDACTED")
  })

  test("leaves a clean payload untouched", async () => {
    // Redaction that mangles ordinary data is its own failure: a client that
    // cannot trust the payload stops reading it.
    const body = await (await get("/team/runs/run-alpha/events?limit=1")).json()

    expect(body.items[0].payload).toEqual({ i: 1 })
  })
})
