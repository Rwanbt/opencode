import { describe, expect, test } from "bun:test"
import { Database } from "bun:sqlite"
import path from "node:path"
import { mkdtemp } from "node:fs/promises"
import os from "node:os"

const migrationPath = path.resolve(import.meta.dir, "../../migration/20260710160000_observability_event/migration.sql")

async function applyMigration(db: Database) {
  const sql = await Bun.file(migrationPath).text()
  for (const statement of sql.split("--> statement-breakpoint")) {
    const trimmed = statement.trim()
    if (trimmed) db.exec(trimmed)
  }
}

describe("observability migration", () => {
  test("upgrades an existing database additively and uses the keyset index", async () => {
    const db = new Database(":memory:")
    try {
      db.exec("CREATE TABLE existing_session (id text PRIMARY KEY NOT NULL)")
      await applyMigration(db)

      const columns = db.query("PRAGMA table_info(observability_event)").all() as { name: string }[]
      expect(columns.some((column) => column.name === "local_content_redacted_json")).toBe(false)
      expect(columns.some((column) => column.name === "local_full_json")).toBe(false)
      expect(columns.some((column) => column.name === "cost_nano_usd")).toBe(true)

      const plan = db
        .query("EXPLAIN QUERY PLAN SELECT * FROM observability_event WHERE session_id = ? ORDER BY ts_ms DESC, id DESC LIMIT 100")
        .all("session-1") as { detail: string }[]
      expect(plan.some((item) => item.detail.includes("observability_event_session_ts_id_idx"))).toBe(true)
    } finally {
      db.close()
    }
  })

  test("rollback on a copied database preserves pre-existing application tables", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "opencode-observability-migration-"))
    const dbPath = path.join(root, "observability.sqlite")
    const backupPath = path.join(root, "observability.backup.sqlite")
    const db = new Database(dbPath)
    try {
      db.exec("CREATE TABLE existing_session (id text PRIMARY KEY NOT NULL)")
      db.exec("INSERT INTO existing_session (id) VALUES ('session-before-observability')")
      await applyMigration(db)
      db.close()
      await Bun.write(backupPath, await Bun.file(dbPath).arrayBuffer())

      const rollbackDb = new Database(backupPath)
      try {
        rollbackDb.exec("DROP TABLE IF EXISTS observability_event")
        expect(rollbackDb.query("SELECT id FROM existing_session").all()).toEqual([{ id: "session-before-observability" }])
        expect(rollbackDb.query("SELECT name FROM sqlite_master WHERE name LIKE 'observability_event%'").all()).toEqual([])
      } finally {
        rollbackDb.close()
      }
    } finally {
      try { db.close() } catch {}
    }
  })
  test("rollback drops observability_event table and indexes cleanly", async () => {
    const db = new Database(":memory:")
    try {
      await applyMigration(db)

      // Verify table exists
      let tables = db.query("SELECT name FROM sqlite_master WHERE type='table' AND name='observability_event'").all()
      expect(tables.length).toBe(1)

      // Verify indexes exist
      let indexes = db.query("SELECT name FROM sqlite_master WHERE type='index' AND name LIKE 'observability_event%'").all()
      expect(indexes.length).toBeGreaterThan(0)

      // Rollback: drop table (CASCADE drops indexes)
      db.exec("DROP TABLE IF EXISTS observability_event")

      // Verify table is gone
      tables = db.query("SELECT name FROM sqlite_master WHERE type='table' AND name='observability_event'").all()
      expect(tables.length).toBe(0)

      // Verify indexes are gone
      indexes = db.query("SELECT name FROM sqlite_master WHERE type='index' AND name LIKE 'observability_event%'").all()
      expect(indexes.length).toBe(0)
    } finally {
      db.close()
    }
  })
})
