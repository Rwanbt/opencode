import { describe, expect, test } from "bun:test"
import { Database } from "bun:sqlite"
import path from "node:path"

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
})
