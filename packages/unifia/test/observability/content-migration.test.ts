import { describe, expect, test } from "bun:test"
import { Database } from "bun:sqlite"
import path from "node:path"

const eventMigrationPath = path.resolve(import.meta.dir, "../../migration/20260710160000_observability_event/migration.sql")
const contentMigrationPath = path.resolve(import.meta.dir, "../../migration/20260712120000_observability_content/migration.sql")

async function applyMigration(db: Database, migrationPath: string) {
  const sql = await Bun.file(migrationPath).text()
  for (const statement of sql.split("--> statement-breakpoint")) {
    const trimmed = statement.trim()
    if (trimmed) db.exec(trimmed)
  }
}

describe("observability Phase 3 content migration", () => {
  test("adds content columns and the opt-in table additively on top of an existing Phase 1 DB", async () => {
    const db = new Database(":memory:")
    try {
      await applyMigration(db, eventMigrationPath)
      db.exec("INSERT INTO observability_event (event_id, trace_id, span_id, session_id, event_type, status, ts_ms, enqueue_seq, redaction_status, metadata_json, local_redacted_json) VALUES ('e1','t1','s1','sess-1','llm.call.started','started',1000,1,'metadata_only','{}','{}')")

      await applyMigration(db, contentMigrationPath)

      const columns = db.query("PRAGMA table_info(observability_event)").all() as { name: string }[]
      expect(columns.some((c) => c.name === "local_content_redacted_json")).toBe(true)
      expect(columns.some((c) => c.name === "local_full_json")).toBe(true)
      expect(columns.some((c) => c.name === "content_expires_at_ms")).toBe(true)

      // Pre-existing row survives the additive migration with the new
      // columns defaulting to NULL, not an error or a dropped row.
      const row = db.query("SELECT local_content_redacted_json, local_full_json, content_expires_at_ms FROM observability_event WHERE event_id = 'e1'").get() as Record<string, unknown>
      expect(row.local_content_redacted_json).toBeNull()
      expect(row.local_full_json).toBeNull()
      expect(row.content_expires_at_ms).toBeNull()

      const tables = db.query("SELECT name FROM sqlite_master WHERE type='table' AND name='observability_content_optin'").all()
      expect(tables.length).toBe(1)

      const optinColumns = db.query("PRAGMA table_info(observability_content_optin)").all() as { name: string }[]
      expect(optinColumns.map((c) => c.name).sort()).toEqual(["created_at_ms", "expires_at_ms", "id", "level", "scope", "scope_id", "ttl_days"].sort())

      db.exec("INSERT INTO observability_content_optin (scope, scope_id, level, ttl_days, created_at_ms, expires_at_ms) VALUES ('session','sess-1','local_full',7,1000,1000000)")
      expect(() =>
        db.exec("INSERT INTO observability_content_optin (scope, scope_id, level, ttl_days, created_at_ms, expires_at_ms) VALUES ('session','sess-1','local_content_redacted',3,2000,2000000)"),
      ).toThrow()
    } finally {
      db.close()
    }
  })

  test("content_expires_at_ms index is used by the priority-purge query shape", async () => {
    const db = new Database(":memory:")
    try {
      await applyMigration(db, eventMigrationPath)
      await applyMigration(db, contentMigrationPath)

      const plan = db
        .query("EXPLAIN QUERY PLAN UPDATE observability_event SET local_full_json = NULL WHERE content_expires_at_ms < 12345")
        .all() as { detail: string }[]
      expect(plan.some((item) => item.detail.includes("observability_event_content_expires_idx"))).toBe(true)
    } finally {
      db.close()
    }
  })
})
