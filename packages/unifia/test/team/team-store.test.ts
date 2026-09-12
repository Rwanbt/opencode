
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, test } from "bun:test"
import { TeamStore, TeamStoreQueueFullError } from "../../src/team/team-store"

const roots: string[] = []
const stores: TeamStore[] = []

afterEach(async () => {
  for (const store of stores.splice(0)) store.close()
  await new Promise((resolve) => setTimeout(resolve, 25))
  for (const root of roots.splice(0)) {
    try { await rm(root, { recursive: true, force: true }) } catch { /* Windows may release SQLite handles shortly after close. */ }
  }
})

async function openStore(options?: { queueLimit?: number }) {
  const root = await mkdtemp(join(tmpdir(), "opencode-team-store-"))
  roots.push(root)
  const store = TeamStore.open(join(root, "team.db"), options)
  stores.push(store)
  return store
}

async function seededStore(options?: { queueLimit?: number }) {
  const store = await openStore(options)
  await store.createRun({ runId: "run-1", planId: "plan-1" })
  await store.createTask({ taskId: "task-1", runId: "run-1", scope: { files: ["src/team"] } })
  return store
}

describe("TeamStore SQLite durability", () => {
  test("enables WAL, busy timeout, foreign keys, and idempotent migration", async () => {
    const store = await seededStore()
    expect(store.journalMode).toBe("wal")
    expect(store.busyTimeoutMs).toBe(5000)
    expect(store.integrityCheck()).toEqual({ ok: true, foreignKeys: [], quickCheck: "ok" })
  })

  test("serializes writes and assigns monotonic event/checkpoint sequences", async () => {
    const store = await seededStore()
    const events = await Promise.all(
      Array.from({ length: 12 }, (_, index) => store.appendEvent("run-1", `event-${index}`, "progress", { index })),
    )
    expect([...events].sort((a, b) => a - b)).toEqual(Array.from({ length: 12 }, (_, index) => index + 1))
    expect(await store.saveCheckpoint("run-1", "checkpoint-1", { state: "first" })).toBe(1)
    expect(await store.saveCheckpoint("run-1", "checkpoint-2", { state: "second" })).toBe(2)
  })

  test("bounds JSON payloads before they reach SQLite", async () => {
    const store = await seededStore()
    expect(() => store.appendEvent("run-1", "large", "progress", "x".repeat(16 * 1024))).toThrow(
      "event payload exceeds",
    )
    expect(() => store.createTask({ taskId: "large-task", runId: "run-1", scope: "x".repeat(64 * 1024) }),
    ).toThrow("scope exceeds")
  })

  test("uses a bounded writer queue and fails closed when saturated", async () => {
    const store = await seededStore({ queueLimit: 1 })
    const first = store.write(() => new Promise((resolve) => setTimeout(resolve, 20)))
    expect(() => store.write(() => undefined)).toThrow(TeamStoreQueueFullError)
    await first
  })

  test("rolls back a failed transaction without leaving partial state", async () => {
    const store = await seededStore()
    await expect(
      store.transaction((db) => {
        db.prepare("INSERT INTO team_events(event_id, run_id, sequence, kind, payload_json, occurred_at) VALUES (?, ?, ?, ?, ?, ?)").run(
          "rollback-event",
          "run-1",
          1,
          "test",
          "{}",
          new Date().toISOString(),
        )
        throw new Error("interrupt migration")
      }),
    ).rejects.toThrow("interrupt migration")
    expect(await store.appendEvent("run-1", "after-rollback", "test", {})).toBe(1)
  })

  test("compacts old events and records audited deletion", async () => {
    const store = await seededStore()
    for (let index = 1; index <= 5; index++) await store.appendEvent("run-1", `event-${index}`, "progress", { index })
    expect(await store.compactEvents("run-1", 2)).toBe(3)
    expect(store.count("team_events")).toBe(2)
    await store.deleteRunAudited("run-1", "retention policy")
    expect(store.count("team_runs")).toBe(0)
    expect(store.count("team_audit")).toBe(1)
  })

  test("does not store artifact bytes, only bounded metadata and a digest", async () => {
    const store = await seededStore()
    await store.recordArtifact({
      artifactId: "artifact-1",
      runId: "run-1",
      taskId: "task-1",
      relativePath: "reports/run-1.json",
      sha256: "a".repeat(64),
      byteLength: 42,
      metadata: { contentType: "application/json" },
    })
    expect(store.integrityCheck().ok).toBe(true)
  })

  test("persists lifecycle transitions, attempts, and review gates", async () => {
    const store = await seededStore()
    await store.updateRunStatus("run-1", "running")
    await store.updateTaskStatus("task-1", "running")
    await store.createAttempt({ attemptId: "attempt-1", taskId: "task-1", workerId: "worker-1" })
    await store.finishAttempt("attempt-1", "success", {
      commitSha: "abc123",
      report: { tests: ["bun test"] },
    })
    await store.recordGate({
      gateId: "gate-1",
      runId: "run-1",
      taskId: "task-1",
      verdict: "APPROVED",
      findings: { reviewer: "model-review" },
    })
    await store.updateTaskStatus("task-1", "completed")
    await store.updateRunStatus("run-1", "completed")

    expect(store.getRun("run-1")?.status).toBe("completed")
    expect(store.listTasks("run-1")[0]?.status).toBe("completed")
    expect(store.listGates("run-1")).toHaveLength(1)
    expect(store.count("team_attempts")).toBe(1)
  })

  test("refuses lifecycle transitions for unknown records", async () => {
    const store = await seededStore()
    await expect(store.updateRunStatus("missing", "failed")).rejects.toThrow("does not exist")
    await expect(store.updateTaskStatus("missing", "blocked")).rejects.toThrow("does not exist")
    await expect(store.finishAttempt("missing", "failure")).rejects.toThrow("does not exist")
  })
})