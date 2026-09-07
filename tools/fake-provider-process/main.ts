/* SPDX-License-Identifier: MIT */
/* Copyright (c) 2026 Unifia contributors */

/**
 * FakeExternalEffectProviderProcess — the FC-04 external world.
 *
 * Per master plan §28-§30: a SEPARATE OS process with its own durable
 * SQLite journal and a real HTTP transport. It is substrate-neutral:
 * both finalists (UNIFIA_NATIVE and DBOS_GO_SQLITE) dispatch against
 * the same endpoints.
 *
 * Real ACK loss (master plan §29): on POST /effect?mode=drop the
 * provider durably commits the effect to its journal (WAL, synchronous
 * FULL) and then resets the TCP connection WITHOUT sending an HTTP
 * response. The caller observes a genuine transport failure
 * (ECONNRESET / socket close / EOF) — there is no `ackLost: true`
 * truth flag anywhere in the protocol.
 *
 * Independent inspection (master plan §30): GET /journal/:effectKey
 * reads the provider's own journal, never the candidate's state.
 */

import { Database } from "bun:sqlite"
import { mkdirSync, existsSync } from "node:fs"
import { createServer, type IncomingMessage, type ServerResponse } from "node:http"
import { join } from "node:path"

const journalDir = process.env.FAKE_PROVIDER_JOURNAL_DIR ?? "./fake-provider-journal"
if (!existsSync(journalDir)) mkdirSync(journalDir, { recursive: true })

const db = new Database(join(journalDir, "provider.sqlite"), { create: true })
db.exec("PRAGMA journal_mode = WAL;")
db.exec("PRAGMA synchronous = FULL;")
db.exec(`
CREATE TABLE IF NOT EXISTS provider_journal (
  effect_key TEXT PRIMARY KEY,
  canonical_input_json TEXT NOT NULL,
  canonical_result_json TEXT NOT NULL,
  committed_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS provider_calls (
  call_seq INTEGER PRIMARY KEY,
  effect_key TEXT NOT NULL,
  transport_outcome TEXT NOT NULL,
  at INTEGER NOT NULL
);
`)

function journalCall(effectKey: string, transportOutcome: string): void {
  const seq = ((db.query(`SELECT COALESCE(MAX(call_seq), 0) + 1 AS n FROM provider_calls`).get() as { n: number } | undefined)?.n) ?? 1
  db.run(`INSERT INTO provider_calls (call_seq, effect_key, transport_outcome, at) VALUES (?, ?, ?, ?)`, [seq, effectKey, transportOutcome, Date.now()])
}

const CANONICAL_RESULT = { reconciled: true, providerObserved: "committed" } as const

function handleEffect(request: IncomingMessage, response: ServerResponse): void {
  const drop = (new URL(request.url ?? "/", "http://x").searchParams.get("mode") ?? "").startsWith("drop")
  let raw = ""
  request.on("data", (chunk) => { raw += chunk.toString("utf8") })
  request.on("end", () => {
    let effectKey = ""
    let canonicalInput: unknown = null
    try {
      const parsed = JSON.parse(raw) as { effectKey?: string; canonicalInput?: unknown }
      if (!parsed.effectKey) {
        response.statusCode = 400
        response.end("effectKey required")
        return
      }
      effectKey = parsed.effectKey
      canonicalInput = parsed.canonicalInput ?? null
    } catch {
      response.statusCode = 400
      response.end("bad json")
      return
    }
    // Durably commit BEFORE any transport decision — this is the point of
    // FC-04: the external world has the effect, the ACK does not survive.
    db.run(
      `INSERT INTO provider_journal (effect_key, canonical_input_json, canonical_result_json, committed_at) VALUES (?, ?, ?, ?)
       ON CONFLICT(effect_key) DO NOTHING`,
      [effectKey, JSON.stringify(canonicalInput ?? null), JSON.stringify(CANONICAL_RESULT), Date.now()],
    )
    if (drop) {
      journalCall(effectKey, "committed-ack-reset")
      // Real transport ACK loss: reset the TCP connection with no bytes of
      // HTTP response. The caller's client surfaces ECONNRESET / socket hang up.
      request.socket.resetAndDestroy?.() ?? request.socket.destroy()
      return
    }
    journalCall(effectKey, "acked")
    response.statusCode = 200
    response.setHeader("Content-Type", "application/json")
    response.end(JSON.stringify({ effectKey, canonicalResult: CANONICAL_RESULT, providerCommittedAtEpochMs: Date.now() }))
  })
}

const server = createServer((request, response) => {
  const url = new URL(request.url ?? "/", "http://x")
  if (request.method === "GET" && url.pathname === "/healthz") {
    response.end("ok")
    return
  }
  if (request.method === "POST" && url.pathname === "/effect") {
    handleEffect(request, response)
    return
  }
  if (request.method === "GET" && url.pathname.startsWith("/journal/")) {
    const effectKey = decodeURIComponent(url.pathname.slice("/journal/".length))
    const row = db.query(`SELECT effect_key, canonical_input_json, canonical_result_json, committed_at FROM provider_journal WHERE effect_key = ?`).get(effectKey) as
      | { effect_key: string; canonical_input_json: string; canonical_result_json: string; committed_at: number }
      | null
    if (!row) {
      response.statusCode = 404
      response.end("not found")
      return
    }
    response.setHeader("Content-Type", "application/json")
    response.end(JSON.stringify({ effectKey: row.effect_key, canonicalInput: JSON.parse(row.canonical_input_json), canonicalResult: JSON.parse(row.canonical_result_json), committedAt: row.committed_at }))
    return
  }
  response.statusCode = 404
  response.end("not found")
})

server.listen(0, "127.0.0.1", () => {
  const address = server.address()
  if (address && typeof address === "object") {
    console.log(`http://127.0.0.1:${address.port}`)
    return
  }
  console.error("no address")
  process.exit(1)
})