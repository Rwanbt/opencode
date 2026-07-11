import { describe, expect, test } from "bun:test"
import { Database as BunSqliteDatabase } from "bun:sqlite"
import path from "node:path"
import os from "node:os"
import fs from "node:fs/promises"
import { ObservabilityService } from "../../src/observability/service"
import { createTraceContext } from "../../src/observability/trace-context"

// Standalone proof that SQLite really throws SQLITE_FULL when the database
// hits its page-count ceiling (PLAN-Native-Observability-V3, P0 test
// matrix — "DB full / disk-quota simulation", previously unverified).
// PRAGMA max_page_count caps the on-disk file size regardless of how much
// real free space the host disk actually has, which is what makes this
// deterministic and portable across Windows/Linux/macOS CI — an actual
// full-disk simulation would require OS-specific quota/loopback-device
// setup that's fragile and root-dependent, none of which this repo's test
// suite needs to depend on to prove the failure mode is real and handled.
// Decoupled from the shared process-wide `:memory:` Database singleton
// (storage/db.ts) for the same reason as sqlite-busy.test.ts: that
// singleton is booted once for the whole test binary and shared by every
// other test file.
describe("SQLite real full-database behavior (P0)", () => {
  test("an insert against a database at its page-count ceiling throws SQLITE_FULL", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-sqlite-full-"))
    const dbPath = path.join(dir, "test.db")
    const db = new BunSqliteDatabase(dbPath)
    try {
      db.exec("CREATE TABLE t (id INTEGER PRIMARY KEY, value TEXT)")
      db.exec("INSERT INTO t (value) VALUES ('seed')")
      const { page_count: pageCount } = db.query("PRAGMA page_count").get() as { page_count: number }
      db.exec(`PRAGMA max_page_count = ${pageCount}`)

      let thrown: unknown
      try {
        const big = "x".repeat(100_000)
        for (let i = 0; i < 50; i++) db.exec("INSERT INTO t (value) VALUES (?)", [big])
      } catch (e) {
        thrown = e
      }

      expect(thrown).toBeDefined()
      const message = String((thrown as { message?: unknown; code?: unknown })?.message ?? thrown)
      const code = (thrown as { code?: unknown })?.code
      expect(message.match(/SQLITE_FULL|database or disk is full/i) !== null || code === "SQLITE_FULL").toBe(true)

      // Sanity: the seed row survived — the ceiling rejected the write that
      // would have grown the file, it didn't corrupt what was already there.
      const rows = db.query("SELECT value FROM t").all() as { value: string }[]
      expect(rows.map((r) => r.value)).toEqual(["seed"])
    } finally {
      db.close()
      await fs.rm(dir, { recursive: true, force: true }).catch(() => {})
    }
  })
})

// Closes the loop the same way sqlite-busy.test.ts does for SQLITE_BUSY:
// the section above proves SQLite really produces SQLITE_FULL under a
// page-count ceiling; this proves ObservabilityService.flush() classifies
// that specific writer exception into eventsFailedFull (service.ts's
// classifyDbFailure) rather than the generic eventsFailedDb bucket —
// already exercised with a synthetic Error in service.test.ts, reproduced
// here against the real bun:sqlite exception shape instead of a hand-built one.
describe("ObservabilityService classifies a real SQLITE_FULL writer failure", () => {
  test("flush() buckets it under eventsFailedFull, not the generic db bucket", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-sqlite-full-service-"))
    const dbPath = path.join(dir, "test.db")
    const db = new BunSqliteDatabase(dbPath)
    try {
      db.exec("CREATE TABLE t (id INTEGER PRIMARY KEY, value TEXT)")
      const { page_count: pageCount } = db.query("PRAGMA page_count").get() as { page_count: number }
      db.exec(`PRAGMA max_page_count = ${pageCount}`)

      const service = new ObservabilityService({
        insert: async () => {
          const big = "x".repeat(100_000)
          db.exec("INSERT INTO t (value) VALUES (?)", [big])
        },
      })
      service.record(createTraceContext(), {
        type: "llm.call.started",
        status: "started",
        tsMs: Date.now(),
      })

      expect(await service.flush()).toBe(0)
      const stats = service.stats()
      expect(stats.eventsFailedFull).toBe(1)
      expect(stats.eventsFailedDb).toBe(0)
      expect(stats.circuitOpen).toBe(true)
      expect(stats.lastErrorKind).toBe("full")
    } finally {
      db.close()
      await fs.rm(dir, { recursive: true, force: true }).catch(() => {})
    }
  })
})
