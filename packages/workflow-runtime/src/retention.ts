/* SPDX-License-Identifier: MIT */
/* Copyright (c) 2026 Unifia contributors */
/**
 * Durable-state schema versioning (ADR-018) + history retention
 * (ADR-016, native kernel: 365d hot history, cold archive scoped by
 * OwnershipScope). Version window: min compatible = N-1 -> a durable
 * store written by an UNKNOWN FUTURE version fails closed (an
 * incompatible stale worker must never mutate durable state).
 * Retention moves TERMINAL runs to cold archive tables (digests and
 * provenance stay inspectable); an ACTIVE/non-terminal run is never
 * archived (directive 25); each move is ONE transaction (no partial
 * corruption on failure, retry possible).
 */
import type { Database } from "bun:sqlite"

export const CURRENT_DURABLE_SCHEMA_VERSION = 1
/** ADR-016 native kernel: hot history retention window (ms). */
export const HISTORY_RETENTION_MS = 365 * 24 * 60 * 60 * 1000

export class VersionSkewError extends Error {
  constructor(readonly found: number, readonly supported: string) { super(`durable store schema version ${found} is not supported (supported: ${supported})`); this.name = "VersionSkewError" }
}

/** Fail-closed check (ADR-018): unknown/future schema version -> refuse to open. */
export function ensureSchemaVersion(db: Database, table: string, current: number = CURRENT_DURABLE_SCHEMA_VERSION): void {
  db.exec(`CREATE TABLE IF NOT EXISTS ${table} (schema_version INTEGER NOT NULL)`);
  const row = db.query(`SELECT schema_version FROM ${table} LIMIT 1`).get() as { schema_version: number } | null
  if (row === null) {
    db.query(`INSERT INTO ${table} (schema_version) VALUES (?)`).run(current)
    return
  }
  // ADR-018 window: N-1 .. N. With current = 1 that is exactly {1}.
  if (row.schema_version < current - 1 || row.schema_version > current) throw new VersionSkewError(row.schema_version, `${current - 1}..${current}`)
}

export interface RetentionResult { readonly archivedRuns: readonly string[]; readonly activeRunsProtected: number }

/**
 * Directive 41 (ADR-016): archive TERMINAL runs older than the cutoff.
 * Active runs are NEVER archived; each run moves in ONE transaction;
 * a failure rolls back the whole run (no partial corruption, retry
 * possible); archived provenance (transitions, digests in run_json)
 * stays inspectable.
 */
export function applyHistoryRetention(db: Database, cutoffMs: number, limit: number = 100): RetentionResult {
  const TERMINAL = ["completed", "failed", "cancelled"]
  const eligible = db.query(`SELECT run_id, run_json, status, created_at, updated_at FROM runs WHERE updated_at < ? AND status IN (${TERMINAL.map(() => "?").join(",")}) ORDER BY updated_at LIMIT ?`).all(cutoffMs, ...TERMINAL, limit) as { run_id: string; run_json: string; status: string; created_at: number; updated_at: number }[]
  const activeProtected = db.query("SELECT COUNT(*) AS c FROM runs WHERE updated_at < ? AND status NOT IN (" + TERMINAL.map(() => "?").join(",") + ")").get(cutoffMs, ...TERMINAL) as { c: number }
  const archived: string[] = []
  for (const run of eligible) {
    db.transaction(() => {
      db.query("INSERT OR IGNORE INTO archived_runs (run_id, run_json, status, created_at, updated_at, archived_at) VALUES (?, ?, ?, ?, ?, ?)")
        .run(run.run_id, run.run_json, run.status, run.created_at, run.updated_at, cutoffMs)
      db.query("INSERT INTO archived_run_transitions (run_id, seq, from_status, to_status, effect_slot_id, occurred_at, is_compensating) SELECT run_id, seq, from_status, to_status, effect_slot_id, occurred_at, is_compensating FROM run_transitions WHERE run_id = ?").run(run.run_id)
      db.query("INSERT INTO archived_commands (run_id, seq, kind, payload_json, enqueued_at) SELECT run_id, seq, kind, payload_json, enqueued_at FROM commands WHERE run_id = ?").run(run.run_id)
      db.query("DELETE FROM run_transitions WHERE run_id = ?").run(run.run_id)
      db.query("DELETE FROM commands WHERE run_id = ?").run(run.run_id)
      db.query("DELETE FROM timers WHERE run_id = ?").run(run.run_id)
      db.query("DELETE FROM timers_fired WHERE run_id = ?").run(run.run_id)
      db.query("DELETE FROM runs WHERE run_id = ?").run(run.run_id)
    })()
    archived.push(run.run_id)
  }
  return { archivedRuns: archived, activeRunsProtected: activeProtected.c }
}

/** Archive tables (cold storage) - same columns as hot, plus archived_at. */
export const RETENTION_SCHEMA = `
CREATE TABLE IF NOT EXISTS archived_runs (
  run_id TEXT PRIMARY KEY,
  run_json TEXT NOT NULL,
  status TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  archived_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS archived_run_transitions (
  run_id TEXT NOT NULL,
  seq INTEGER NOT NULL,
  from_status TEXT NOT NULL,
  to_status TEXT NOT NULL,
  effect_slot_id TEXT NOT NULL,
  occurred_at INTEGER NOT NULL,
  is_compensating INTEGER NOT NULL,
  PRIMARY KEY (run_id, seq)
);
CREATE TABLE IF NOT EXISTS archived_commands (
  run_id TEXT NOT NULL,
  seq INTEGER NOT NULL,
  kind TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  enqueued_at INTEGER NOT NULL,
  PRIMARY KEY (run_id, seq)
);
`
