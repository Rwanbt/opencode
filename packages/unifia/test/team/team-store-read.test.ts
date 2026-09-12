import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, test } from "bun:test"
import { TeamStore, TeamStoreCursorError, TEAM_STORE_MAX_PAGE_SIZE } from "../../src/team/team-store"

const roots: string[] = []
const stores: TeamStore[] = []

afterEach(async () => {
  for (const store of stores.splice(0)) store.close()
  await new Promise((resolve) => setTimeout(resolve, 25))
  for (const root of roots.splice(0)) {
    try {
      await rm(root, { recursive: true, force: true })
    } catch {
      /* Windows may release SQLite handles shortly after close. */
    }
  }
})

async function openStore() {
  const root = await mkdtemp(join(tmpdir(), "opencode-team-read-"))
  roots.push(root)
  const store = TeamStore.open(join(root, "team.db"))
  stores.push(store)
  return store
}

/** Drain every page and return the items in order, plus the page count. */
function drain<T>(fetch: (cursor: string | null) => { items: readonly T[]; nextCursor: string | null }) {
  const all: T[] = []
  let cursor: string | null = null
  let pages = 0
  for (;;) {
    const page = fetch(cursor)
    all.push(...page.items)
    pages++
    if (page.nextCursor === null) break
    cursor = page.nextCursor
    // A cursor that never terminates is the failure this guard catches; a
    // test that hangs teaches nothing.
    if (pages > 10_000) throw new Error("pagination did not terminate")
  }
  return { all, pages }
}

describe("TeamStore.listRuns — pagination", () => {
  test("walks every run exactly once across pages", async () => {
    const store = await openStore()
    for (let i = 0; i < 250; i++) {
      await store.createRun({ runId: `run-${String(i).padStart(4, "0")}`, planId: "plan" })
    }

    const { all, pages } = drain((cursor) => store.listRuns({ limit: 40, cursor }))

    expect(all).toHaveLength(250)
    expect(new Set(all.map((run) => run.runId)).size).toBe(250)
    expect(pages).toBe(Math.ceil(250 / 40))
  })

  test("returns a null cursor on the exact last page, not one that resolves to nothing", async () => {
    // Over-fetching by one is what makes this true; without it the last full
    // page hands back a cursor and the client makes a pointless extra request.
    const store = await openStore()
    for (let i = 0; i < 20; i++) await store.createRun({ runId: `run-${i}`, planId: "plan" })

    const page = store.listRuns({ limit: 20 })

    expect(page.items).toHaveLength(20)
    expect(page.nextCursor).toBeNull()
  })

  test("is ordered by (createdAt desc, runId desc) across a full drain", async () => {
    // created_at has millisecond resolution, so runs written in a tight loop
    // collide. Asserting the comparator holds over the whole drained sequence
    // pins both halves of the order — the timestamp and the id tiebreak —
    // without depending on how many collisions the machine happens to produce.
    const store = await openStore()
    for (let i = 0; i < 120; i++) await store.createRun({ runId: `run-${String(i).padStart(3, "0")}`, planId: "plan" })

    const { all } = drain((cursor) => store.listRuns({ limit: 25, cursor }))

    expect(all).toHaveLength(120)
    for (let i = 1; i < all.length; i++) {
      const previous = all[i - 1]!
      const current = all[i]!
      const ordered =
        previous.createdAt > current.createdAt ||
        (previous.createdAt === current.createdAt && previous.runId > current.runId)
      expect({ i, previous: previous.runId, current: current.runId, ordered }).toMatchObject({ ordered: true })
    }
  })

  test("rejects a cursor naming a run that no longer exists", async () => {
    // SQLite compares against NULL and returns nothing, which a client would
    // read as "you have reached the end" rather than "your cursor is stale".
    const store = await openStore()
    await store.createRun({ runId: "run-1", planId: "plan" })

    expect(() => store.listRuns({ cursor: "run-gone" })).toThrow(TeamStoreCursorError)
  })

  test("rejects an out-of-range limit rather than silently clamping", async () => {
    const store = await openStore()

    expect(() => store.listRuns({ limit: 0 })).toThrow(RangeError)
    expect(() => store.listRuns({ limit: TEAM_STORE_MAX_PAGE_SIZE + 1 })).toThrow(RangeError)
    expect(() => store.listRuns({ limit: 1.5 })).toThrow(RangeError)
  })
})

describe("TeamStore.listEvents — replay", () => {
  test("replays 5000 events in append order with no gap and no repeat", async () => {
    const store = await openStore()
    await store.createRun({ runId: "run-1", planId: "plan" })
    for (let i = 1; i <= 5_000; i++) {
      await store.appendEvent("run-1", `event-${i}`, "task.progress", { i })
    }

    const { all } = drain((cursor) => store.listEvents("run-1", { limit: 250, cursor }))

    expect(all).toHaveLength(5_000)
    expect(all.map((event) => event.sequence)).toEqual(Array.from({ length: 5_000 }, (_, i) => i + 1))
  })

  test("resumes exactly after the last sequence a client saw", async () => {
    const store = await openStore()
    await store.createRun({ runId: "run-1", planId: "plan" })
    for (let i = 1; i <= 10; i++) await store.appendEvent("run-1", `event-${i}`, "k", { i })

    const resumed = store.listEvents("run-1", { cursor: "4" })

    expect(resumed.items[0]!.sequence).toBe(5)
    expect(resumed.items).toHaveLength(6)
  })

  test("decodes the payload rather than handing back JSON text", async () => {
    const store = await openStore()
    await store.createRun({ runId: "run-1", planId: "plan" })
    await store.appendEvent("run-1", "event-1", "task.done", { taskId: "t1", nested: { ok: true } })

    expect(store.listEvents("run-1").items[0]!.payload).toEqual({ taskId: "t1", nested: { ok: true } })
  })

  test("rejects a cursor that is not a sequence", async () => {
    const store = await openStore()
    await store.createRun({ runId: "run-1", planId: "plan" })

    expect(() => store.listEvents("run-1", { cursor: "not-a-number" })).toThrow(TeamStoreCursorError)
    expect(() => store.listEvents("run-1", { cursor: "-1" })).toThrow(TeamStoreCursorError)
  })

  test("an unknown run reads as empty, which is why the route checks the run first", async () => {
    const store = await openStore()

    expect(store.listEvents("run-ghost").items).toEqual([])
  })
})

describe("TeamStore — rows and relations", () => {
  test("returns tasks with their dependencies and scope decoded", async () => {
    const store = await openStore()
    await store.createRun({ runId: "run-1", planId: "plan" })
    await store.createTask({ taskId: "t2", runId: "run-1", dependsOn: ["t1"], scope: { files: ["src/a.ts"] } })

    const task = store.listTasks("run-1")[0]!

    expect(task.dependsOn).toEqual(["t1"])
    expect(task.scope).toEqual({ files: ["src/a.ts"] })
    expect(task.status).toBe("pending")
  })

  test("scopes tasks and events to their own run", async () => {
    const store = await openStore()
    await store.createRun({ runId: "run-1", planId: "plan" })
    await store.createRun({ runId: "run-2", planId: "plan" })
    await store.createTask({ taskId: "t1", runId: "run-1", scope: {} })
    await store.createTask({ taskId: "t2", runId: "run-2", scope: {} })
    await store.appendEvent("run-1", "e1", "k", {})

    expect(store.listTasks("run-1").map((t) => t.taskId)).toEqual(["t1"])
    expect(store.listTasks("run-2").map((t) => t.taskId)).toEqual(["t2"])
    expect(store.listEvents("run-2").items).toEqual([])
  })

  test("getRun distinguishes a missing run from an empty one", async () => {
    const store = await openStore()
    await store.createRun({ runId: "run-1", planId: "plan-7", status: "running" })

    expect(store.getRun("run-1")).toMatchObject({ runId: "run-1", planId: "plan-7", status: "running" })
    expect(store.getRun("run-ghost")).toBeNull()
  })

  test("reads are not queued behind writes", async () => {
    // Reads bypass the writer queue deliberately. If they did not, a listing
    // would wait on whatever the runtime happened to be persisting.
    const store = await openStore()
    await store.createRun({ runId: "run-1", planId: "plan" })

    const pending = store.appendEvent("run-1", "e1", "k", {})
    expect(store.getRun("run-1")).not.toBeNull()
    await pending
  })
})
