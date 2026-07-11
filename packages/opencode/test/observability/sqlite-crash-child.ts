// Helper process for sqlite-crash-recovery.test.ts — deliberately its own
// file (not inlined via `bun -e`) so it runs as a real separate OS process
// that the parent test can SIGKILL. Opens the DB the parent already
// migrated, starts an uncommitted INSERT into the real observability_event
// table, signals readiness via a marker file, then blocks forever. Never
// reached by `bun test`'s own file glob since its name doesn't contain
// ".test.".
import { Database } from "bun:sqlite"
import fs from "node:fs"

const [, , dbPath, markerPath, eventId] = process.argv
const db = new Database(dbPath)
db.exec("PRAGMA journal_mode = WAL")
db.exec("BEGIN")
db.exec(
  `INSERT INTO observability_event
    (event_id, trace_id, span_id, event_type, status, ts_ms, enqueue_seq, redaction_status, payload_truncated, metadata_json, local_redacted_json, schema_version)
   VALUES (?, 'trace-crash-test', 'span-crash-test', 'llm.call.started', 'started', ?, 1, 'metadata_only', 0, '{}', '{"classes":[]}', 1)`,
  [eventId, Date.now()],
)
fs.writeFileSync(markerPath, "ready")

while (true) {
  await Bun.sleep(60_000)
}
