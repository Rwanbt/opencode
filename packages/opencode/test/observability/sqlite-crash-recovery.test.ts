import { describe, expect, test } from "bun:test"
import { Database as BunSqliteDatabase } from "bun:sqlite"
import path from "node:path"
import os from "node:os"
import fs from "node:fs/promises"
import fsSync from "node:fs"

// Standalone proof that a hard kill mid-write (SIGKILL, no chance to run any
// cleanup/rollback code) never leaves the observability DB with a partially
// committed row or a corrupted file (PLAN-Native-Observability-V3, P0 test
// matrix — "crash recovery", previously unverified). This is a real crash,
// not a simulated one: a genuine child process is spawned, starts a real
// uncommitted transaction against a real file-backed DB, and is killed by
// the OS from the outside while that transaction is still open.
//
// journal_mode=WAL (storage/db.ts) is exactly the mode that makes this
// safe: an uncommitted transaction's writes only ever land in the WAL file,
// which the next connection to open the DB discards on recovery. Decoupled
// from the shared process-wide `:memory:` Database singleton for the same
// reason as sqlite-busy.test.ts/sqlite-full.test.ts — this needs a real
// file-backed DB and a real second process, neither of which the shared
// in-memory test singleton can provide.
const migrationPath = path.resolve(
  import.meta.dir,
  "../../migration/20260710160000_observability_event/migration.sql",
)

async function applyMigration(db: BunSqliteDatabase) {
  const sql = await Bun.file(migrationPath).text()
  for (const statement of sql.split("--> statement-breakpoint")) {
    const trimmed = statement.trim()
    if (trimmed) db.exec(trimmed)
  }
}

describe("SQLite real crash-recovery behavior (P0)", () => {
  test("SIGKILL during an uncommitted transaction leaves no partial row and an intact database", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-sqlite-crash-"))
    const dbPath = path.join(dir, "test.db")
    const markerPath = path.join(dir, "ready.marker")
    const eventId = "crash-test-event-01HXXXXXXXXXXXXXXXXXXXXXXX"

    try {
      const setup = new BunSqliteDatabase(dbPath)
      setup.exec("PRAGMA journal_mode = WAL")
      await applyMigration(setup)
      setup.close()

      const child = Bun.spawn(
        ["bun", "run", path.join(import.meta.dir, "sqlite-crash-child.ts"), dbPath, markerPath, eventId],
        { stdout: "ignore", stderr: "inherit" },
      )

      try {
        const deadline = Date.now() + 10_000
        while (!fsSync.existsSync(markerPath) && Date.now() < deadline) await Bun.sleep(20)
        expect(fsSync.existsSync(markerPath)).toBe(true)
      } finally {
        // Unconditional — don't leak a hung child process if an assertion
        // above throws before the transaction is confirmed ready. Killing
        // an already-exited process is a safe no-op in Bun.
        child.kill("SIGKILL")
        await child.exited
      }

      const db = new BunSqliteDatabase(dbPath)
      try {
        const rows = db
          .query("SELECT event_id FROM observability_event WHERE event_id = ?")
          .all(eventId) as { event_id: string }[]
        expect(rows).toHaveLength(0)

        const integrity = db.query("PRAGMA integrity_check").all() as { integrity_check: string }[]
        expect(integrity).toEqual([{ integrity_check: "ok" }])

        // The table itself must still be fully usable after recovery, not
        // just structurally present.
        db.exec(
          `INSERT INTO observability_event
            (event_id, trace_id, span_id, event_type, status, ts_ms, enqueue_seq, redaction_status, payload_truncated, metadata_json, local_redacted_json, schema_version)
           VALUES ('post-crash-event', 'trace-post-crash', 'span-post-crash', 'llm.call.started', 'started', ?, 1, 'metadata_only', 0, '{}', '{"classes":[]}', 1)`,
          [Date.now()],
        )
        const postCrash = db
          .query("SELECT event_id FROM observability_event WHERE event_id = 'post-crash-event'")
          .all() as { event_id: string }[]
        expect(postCrash).toHaveLength(1)
      } finally {
        db.close()
      }
    } finally {
      await fs.rm(dir, { recursive: true, force: true }).catch(() => {})
    }
  }, 20_000)
})
