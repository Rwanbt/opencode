// FC-13-CTRL - deliberately NON-durable writer + post-cut inspector
// (negative durability control, frozen ADR-000 FC-13-CTRL).
//
// WRITE mode: sqlite journal_mode=OFF + synchronous=OFF. The commit
// returns (acknowledged at application level) but nothing forces the
// write to the virtual disk. If the row SURVIVES the hard power cut,
// the fault methodology is NOT_VALID.
//
// INSPECT mode: after the hard cut, read ONLY durable state and emit
// the oracle verdict on the console (guest -> host channel).
import { Database } from "bun:sqlite"

const storePath = process.env.FC13_STORE_PATH ?? "/mnt/store/store.db"
const iteration = process.env.FC13_ITERATION ?? "0"
const mode = process.env.FC13_MODE ?? "write"

if (mode === "inspect") {
  let result = "ABSENT"
  try {
    const db = new Database(storePath, { readonly: true })
    const rows = db.query("SELECT marker FROM fc13_ctrl WHERE iteration = ?").all(iteration) as { marker: string }[]
    result = rows.length > 0 ? `PRESENT:${rows[0].marker}` : "ABSENT"
    db.close()
  } catch (error) {
    result = `CORRUPT:${String(error).slice(0, 80)}`
  }
  console.log(`FC13-RESULT ctrl iter=${iteration} ${result}`)
  process.exit(0)
}

// WRITE mode (default).
const db = new Database(storePath)
db.exec("PRAGMA journal_mode = OFF;")
db.exec("PRAGMA synchronous = OFF;")
db.exec("CREATE TABLE IF NOT EXISTS fc13_ctrl (iteration TEXT PRIMARY KEY, written_at INTEGER, marker TEXT);")
db.run("INSERT INTO fc13_ctrl (iteration, written_at, marker) VALUES (?, ?, ?) ON CONFLICT(iteration) DO UPDATE SET written_at = excluded.written_at, marker = excluded.marker", [iteration, Date.now(), `ctrl-write-${iteration}`])
// The commit returned: at application level the write is acknowledged.
// NO fsync, NO WAL, journal_mode OFF - intentionally insufficient.
db.close()

// READY barrier on the console channel (guest -> host; never through
// the tested store). The host hard-kills the VM upon observing it.
console.log(`FC13-READY ctrl iter=${iteration}`)
await new Promise(() => {})
