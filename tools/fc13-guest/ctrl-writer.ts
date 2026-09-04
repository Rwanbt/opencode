// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Unifia contributors

// FC-13-CTRL - deliberately NON-durable writer (negative durability
// control, frozen ADR-000 FC-13-CTRL). sqlite journal_mode=OFF +
// synchronous=OFF: the commit returns (acknowledged at application
// level) but nothing forces the write to the virtual disk. If this
// row SURVIVES the hard power cut, the fault methodology is NOT_VALID.
import { Database } from "bun:sqlite"

const storePath = process.env.FC13_STORE_PATH ?? "/mnt/store/store.db"
const readyUrl = process.env.FC13_READY_URL ?? "http://10.0.2.2:8099/ready"
const iteration = process.env.FC13_ITERATION ?? "0"

const db = new Database(storePath)
db.exec("PRAGMA journal_mode = OFF;")
db.exec("PRAGMA synchronous = OFF;")
db.exec("CREATE TABLE IF NOT EXISTS fc13_ctrl (iteration TEXT PRIMARY KEY, written_at INTEGER, marker TEXT);")
db.run("INSERT INTO fc13_ctrl (iteration, written_at, marker) VALUES (?, ?, ?) ON CONFLICT(iteration) DO UPDATE SET written_at = excluded.written_at, marker = excluded.marker", [iteration, Date.now(), `ctrl-write-${iteration}`])
// The commit returned: at application level the write is acknowledged.
// NO fsync, NO WAL, journal_mode OFF - intentionally insufficient.
db.close()

// Separate coordination channel (master plan 10): the READY marker
// travels over the host-only HTTP channel, never through the store.
const ready = await fetch(`${readyUrl}?iter=${iteration}&who=ctrl`, { signal: AbortSignal.timeout(10_000) }).catch(() => null)
if (!ready) console.log("READY-SIGNAL-FAILED")
// Hold the process open: the harness hard-kills the VM after READY.
await new Promise(() => {})
