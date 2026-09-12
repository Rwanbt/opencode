import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { TeamStore } from "../../src/team/team-store"

// Headless end-to-end coverage for `opencode team` (TEAM-L04).
//
// These spawn the real CLI as a subprocess rather than calling handlers
// directly, because what the card is about is what a script sees: the exit
// code, and whether stdout is machine-readable when nothing is attached to it.
// A handler-level test would pass with the process-exit plumbing broken.
//
// Running on Windows also exercises the "Windows shell" criterion: the child is
// spawned without a shell and every path is built with path.join, so nothing
// here depends on POSIX quoting.

const ENTRY = path.resolve(import.meta.dir, "../../src/index.ts")

let root: string
let dataHome: string
let runID: string
let attach: string
let controlStatus = "running"
let server: ReturnType<typeof Bun.serve>

interface CliResult {
  exitCode: number
  stdout: string
  stderr: string
}

async function team(...args: string[]): Promise<CliResult> {
  const proc = Bun.spawn(["bun", "run", "--conditions=browser", ENTRY, "team", ...args], {
    env: {
      ...process.env,
      // Redirects Global.Path.data in the child: xdg-basedir reads the
      // environment when the child imports it, so the CLI opens the seeded
      // store instead of the developer's real one.
      XDG_DATA_HOME: dataHome,
    },
    stdout: "pipe",
    stderr: "pipe",
  })
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ])
  return { exitCode, stdout, stderr }
}

function plan(taskCount: number) {
  return {
    schemaVersion: "1.0.0",
    tasks: Array.from({ length: taskCount }, (_, i) => ({
      id: `task-${i}`,
      title: `Task ${i}`,
      objective: `Do thing ${i}`,
      dependsOn: i === 0 ? [] : [`task-${i - 1}`],
      // Concrete files, not "src/": the graph validator's CANONICAL_PATH rule
      // rejects a directory-with-trailing-slash, and a fixture that trips it
      // would be testing the fixture rather than the command.
      readSet: [`src/file-${i}.ts`],
      writeSet: [`src/file-${i}.ts`],
      exclusiveResources: [],
      acceptanceCriteria: ["it works"],
      risks: [],
      gates: [],
    })),
    integrationStrategy: "cherry-pick into Team",
    rollback: "reset the card branch",
    globalRisks: [],
    globalGates: ["typecheck"],
  }
}

const MODELS = [
  {
    modelId: "test/model-a",
    family: "test",
    lifecycleStage: "general_eligible",
    costPerMillionInputTokens: 3,
    costPerMillionOutputTokens: 15,
    averageLatencyMs: 1200,
  },
]

beforeAll(async () => {
  root = await mkdtemp(path.join(tmpdir(), "unifia-team-cli-"))
  dataHome = path.join(root, "share")
  // Must match the directory Global.Path.data joins onto XDG_DATA_HOME — the
  // product's own name. Seeding "opencode" here left the store somewhere the
  // spawned CLI never looks, so every command reported an empty run.
  const productData = path.join(dataHome, "unifia")
  await mkdir(productData, { recursive: true })

  const store = TeamStore.open(path.join(productData, "team.db"))
  runID = "run-cli-1"
  await store.createRun({ runId: runID, planId: "plan-cli", status: "completed" })
  await store.createTask({ taskId: "t1", runId: runID, dependsOn: [], scope: { files: ["src/a.ts"] } })
  await store.createTask({ taskId: "t2", runId: runID, dependsOn: ["t1"], scope: { files: ["src/b.ts"] } })
  for (let i = 1; i <= 30; i++) await store.appendEvent(runID, `e${i}`, "task.progress", { i })
  store.close()

  await writeFile(path.join(root, "plan.json"), JSON.stringify(plan(3)), "utf8")
  await writeFile(path.join(root, "models.json"), JSON.stringify(MODELS), "utf8")
  await writeFile(path.join(root, "not-json.json"), "{ this is not json", "utf8")
  server = Bun.serve({
    port: 0,
    fetch(request) {
      const url = new URL(request.url)
      if (request.method === "POST" && url.pathname === "/team/runs") {
        return Response.json({ runId: "run-http-1", sessionId: "session-http-1" }, { status: 202 })
      }
      const match = url.pathname.match(/^\/team\/runs\/([^/]+)\/(pause|resume|cancel)$/)
      if (request.method === "POST" && match) {
        controlStatus = match[2] === "pause" ? "paused" : match[2] === "cancel" ? "cancelled" : "running"
        return Response.json({ runId: match[1], controlStatus })
      }
      return Response.json({ error: "not found" }, { status: 404 })
    },
  })
  attach = `http://127.0.0.1:${server.port}`
}, 60_000)

afterAll(async () => {
  server.stop(true)
  await new Promise((resolve) => setTimeout(resolve, 50))
  await rm(root, { recursive: true, force: true }).catch(() => {})
})

describe("opencode team — machine-readable by default", () => {
  test("emits JSON on stdout when stdout is not a TTY", async () => {
    // No --json passed. A piped caller should not have to know the flag exists.
    const result = await team("list")

    expect(result.exitCode).toBe(0)
    const body = JSON.parse(result.stdout)
    expect(body.schemaVersion).toBe("1.0.0")
    expect(body.items.map((run: { runId: string }) => run.runId)).toEqual([runID])
  }, 60_000)

  test("keeps stdout parseable by putting progress on stderr", async () => {
    // Anything printed for a human goes to stderr, so `| jq` never chokes.
    const result = await team("export", runID)

    expect(result.exitCode).toBe(0)
    expect(() => JSON.parse(result.stdout)).not.toThrow()
  }, 60_000)

  test("status reports the tasks and their states", async () => {
    const result = await team("status", runID)
    const body = JSON.parse(result.stdout)

    expect(result.exitCode).toBe(0)
    expect(body.run.runId).toBe(runID)
    expect(body.taskCount).toBe(2)
    expect(body.tasksByStatus).toEqual({ pending: 2 })
  }, 60_000)

  test("export drains every event rather than stopping at the first page", async () => {
    // A truncated export is worse than a failed one: nothing signals the loss.
    const out = path.join(root, "export.json")
    const result = await team("export", runID, "--out", out)

    expect(result.exitCode).toBe(0)
    const document = JSON.parse(await readFile(out, "utf8"))
    expect(document.events).toHaveLength(30)
    expect(document.events.map((event: { sequence: number }) => event.sequence)).toEqual(
      Array.from({ length: 30 }, (_, i) => i + 1),
    )
    expect(document.tasks).toHaveLength(2)
  }, 60_000)

  test("events resumes from a cursor", async () => {
    const result = await team("events", runID, "--cursor", "25")
    const body = JSON.parse(result.stdout)

    expect(result.exitCode).toBe(0)
    expect(body.items[0].sequence).toBe(26)
    expect(body.items).toHaveLength(5)
  }, 60_000)
})

describe("opencode team — exit codes a script can branch on", () => {
  test("a missing run is 66 (EX_NOINPUT), not a generic failure", async () => {
    const result = await team("status", "run-does-not-exist")

    expect(result.exitCode).toBe(66)
    expect(result.stderr).toContain("run-does-not-exist")
    expect(result.stdout).toBe("")
  }, 60_000)

  test("a bad option value is 64 (EX_USAGE)", async () => {
    const result = await team("events", runID, "--limit", "0")

    expect(result.exitCode).toBe(64)
  }, 60_000)

  test("an unreadable plan file is 66, and a malformed one is 64", async () => {
    // Distinguishing them matters: one is a wrong path, the other a wrong file.
    expect((await team("dry-run", "--plan", path.join(root, "nope.json"))).exitCode).toBe(66)
    expect((await team("dry-run", "--plan", path.join(root, "not-json.json"))).exitCode).toBe(64)
  }, 90_000)

  test("start, pause, resume and cancel use the shared server lifecycle", async () => {
    const started = await team("start", "--attach", attach, "--plan", path.join(root, "plan.json"))
    expect(started.exitCode).toBe(0)
    expect(JSON.parse(started.stdout).runId).toBe("run-http-1")

    for (const [operation, expected] of [["pause", "paused"], ["resume", "running"], ["cancel", "cancelled"]] as const) {
      const controlled = await team(operation, "run-http-1", "--attach", attach)
      expect(controlled.exitCode).toBe(0)
      expect(JSON.parse(controlled.stdout).controlStatus).toBe(expected)
      expect(controlStatus).toBe(expected)
    }
  }, 120_000)

  test("an unknown subcommand fails rather than doing nothing", async () => {
    const result = await team("teleport")

    expect(result.exitCode).not.toBe(0)
  }, 60_000)
})

describe("opencode team dry-run", () => {
  test("simulates a plan into waves and an estimate", async () => {
    const result = await team("dry-run", "--plan", path.join(root, "plan.json"), "--models", path.join(root, "models.json"))
    const body = JSON.parse(result.stdout)

    expect(result.exitCode).toBe(0)
    // The plan is a chain of three, so it cannot collapse into fewer waves.
    expect(body.waves).toHaveLength(3)
    expect(body.estimate.costUsd.max).toBeGreaterThan(body.estimate.costUsd.min)
    expect(body.graphValidation.valid).toBe(true)
  }, 60_000)

  test("reads no network and touches no remote", async () => {
    // "No publish" for this card: with an explicit --models file the command is
    // pure computation over two local files.
    const result = await team("dry-run", "--plan", path.join(root, "plan.json"), "--models", path.join(root, "models.json"))

    expect(result.stderr).not.toContain("model registry")
    expect(result.exitCode).toBe(0)
  }, 60_000)
})
