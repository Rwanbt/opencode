// FC-13-CTRL - deliberately NON-durable writer + post-cut inspector
// (negative durability control, frozen ADR-000 FC-13-CTRL).
// WRITE mode: sqlite journal_mode=OFF + synchronous=OFF. The commit
// returns (acknowledged at application level) but nothing forces the
// write to the disk. If the row SURVIVES the hard power cut, the
// methodology is NOT_VALID. READY is signaled on stdout (serial
// console -> host channel, plan section 9), never through the store.
import { Database } from "bun:sqlite"

const storePath = (process.env.FC13_STORE_PATH ?? "/mnt/store") + "/store.db"
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
    const message = String(error)
    // An absent database file IS the loss signal for the negative control:
    // the acknowledged write was never durably created.
    if (message.includes("unable to open database file")) result = "ABSENT"
    else result = "CORRUPT:" + message.slice(0, 60)
  }
  console.log(`FC13-RESULT ctrl iter=${iteration} ${result}`)
  process.exit(0)
}

const db = new Database(storePath)
db.exec("PRAGMA journal_mode = OFF;")
db.exec("PRAGMA synchronous = OFF;")
db.exec("CREATE TABLE IF NOT EXISTS fc13_ctrl (iteration TEXT PRIMARY KEY, written_at INTEGER, marker TEXT);")
db.run("INSERT INTO fc13_ctrl (iteration, written_at, marker) VALUES (?, ?, ?) ON CONFLICT(iteration) DO UPDATE SET written_at = excluded.written_at, marker = excluded.marker", [iteration, Date.now(), `ctrl-write-${iteration}`])
db.close()
console.log(`FC13-READY ctrl iter=${iteration}`)
await new Promise(() => {})
