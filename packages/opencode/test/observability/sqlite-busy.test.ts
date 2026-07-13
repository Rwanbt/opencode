import { describe, expect, test } from "bun:test"
import { Database as BunSqliteDatabase } from "bun:sqlite"
import path from "node:path"
import os from "node:os"
import fs from "node:fs/promises"

// Standalone proof that SQLite really throws SQLITE_BUSY under write
// contention with a low busy_timeout (PLAN-Native-Observability-V3, P0 test
// matrix). Deliberately decoupled from the app's shared process-wide
// `:memory:` Database singleton (storage/db.ts) — that singleton is booted
// once for the whole test binary (test/preload.ts) and every other test
// file writes through it; redirecting it to a real file mid-suite to force
// contention would risk destabilizing unrelated tests sharing the same
// connection. ObservabilityService.flush() (service.ts) already catches ANY
// writer exception uniformly regardless of SQLite error code — proven
// separately by service.test.ts's "opens circuit on database failure" test.
// Together, these two tests close the loop: SQLite really produces this
// failure mode under contention, and the service handles it (and any other
// writer failure) the same safe, non-blocking way.
describe("SQLite real busy-contention behavior (P0)", () => {
  test("a write against a file locked by another connection throws SQLITE_BUSY", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-sqlite-busy-"))
    const dbPath = path.join(dir, "test.db")
    const writer = new BunSqliteDatabase(dbPath)
    const contender = new BunSqliteDatabase(dbPath)
    try {
      writer.exec("CREATE TABLE t (id INTEGER PRIMARY KEY, value TEXT)")
      contender.exec("PRAGMA busy_timeout = 0")

      writer.exec("BEGIN EXCLUSIVE")
      writer.exec("INSERT INTO t (value) VALUES ('locked-by-writer')")

      let thrown: unknown
      try {
        contender.exec("INSERT INTO t (value) VALUES ('should-fail')")
      } catch (e) {
        thrown = e
      }
      writer.exec("COMMIT")

      expect(thrown).toBeDefined()
      const message = String((thrown as { message?: unknown; code?: unknown })?.message ?? thrown)
      const code = (thrown as { code?: unknown })?.code
      expect(message.match(/SQLITE_BUSY|database is locked/i) !== null || code === "SQLITE_BUSY").toBe(true)

      // Sanity: the writer's own transaction committed fine — contention
      // rejected the SECOND connection's write, not the first.
      const rows = writer.query("SELECT value FROM t").all() as { value: string }[]
      expect(rows.map((r) => r.value)).toEqual(["locked-by-writer"])
    } finally {
      writer.close()
      contender.close()
      await fs.rm(dir, { recursive: true, force: true }).catch(() => {})
    }
  })
})
