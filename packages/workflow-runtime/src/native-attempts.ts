/* SPDX-License-Identifier: MIT */
/* Copyright (c) 2026 Unifia contributors */

/**
 * NativeAttemptAuthority — production durable attempt/effect identity on
 * the ratified UNIFIA_NATIVE substrate (master plan directive 7, M3).
 *
 * Frozen semantics (owner directive 7):
 *   - NO GENERIC EXACTLY-ONCE CLAIM.
 *   - Retry = same LogicalInvocationId + same logical EffectKey -> NEW
 *     AttemptId (allocateAttempt always mints a fresh attempt).
 *   - Effect identity is DERIVED from the EffectKey (one durable row per
 *     (runId, effectKey)); idempotency = a terminal effect is never
 *     blindly overwritten (resolveEffect is a no-op on terminal states).
 *   - UNKNOWN_EXTERNAL_STATE is recorded as its own outcome; only the
 *     explicit reconciliation path (reconcileEffect) may move it to a
 *     terminal state, and the reconciliation is journalled.
 *
 * Durability: SQLite WAL + synchronous=FULL (FC-13-proven). Same
 * database file as NativeDurableHistoryAuthority (multi-connection WAL
 * is safe); every fact is a row — restart recovery is free.
 */
import type { Database } from "bun:sqlite"

export type AttemptOutcome = "SUCCEEDED" | "FAILED" | "UNKNOWN_EXTERNAL_STATE"
export type EffectStatus = AttemptOutcome | "PENDING"

export interface NativeAttemptAuthorityOptions {
  readonly databasePath: string
  readonly now?: () => number
}

export interface DurableAttempt {
  readonly runId: string
  readonly logicalInvocationId: string
  readonly attemptId: string
  readonly seq: number
  readonly effectKey: string
  readonly outcome: AttemptOutcome | null
  readonly resultJson: string | null
  readonly ackLost: boolean
  readonly createdAt: number
}

export interface DurableEffect {
  readonly runId: string
  readonly effectKey: string
  readonly effectId: string
  readonly status: EffectStatus
  readonly resultJson: string | null
  readonly reconciled: boolean
  readonly updatedAt: number
}

const SCHEMA_V1 = `
CREATE TABLE IF NOT EXISTS logical_invocations (
  run_id TEXT NOT NULL,
  li_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (run_id, li_id)
);
CREATE TABLE IF NOT EXISTS attempts (
  run_id TEXT NOT NULL,
  li_id TEXT NOT NULL,
  seq INTEGER NOT NULL,
  attempt_id TEXT NOT NULL,
  effect_key TEXT NOT NULL,
  outcome TEXT,
  result_json TEXT,
  ack_lost INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (run_id, li_id, seq)
);
CREATE TABLE IF NOT EXISTS effects (
  run_id TEXT NOT NULL,
  effect_key TEXT NOT NULL,
  effect_id TEXT NOT NULL,
  status TEXT NOT NULL,
  result_json TEXT,
  reconciled INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (run_id, effect_key)
);
CREATE TABLE IF NOT EXISTS effect_journal (
  run_id TEXT NOT NULL,
  seq INTEGER NOT NULL,
  effect_key TEXT NOT NULL,
  from_status TEXT,
  to_status TEXT NOT NULL,
  occurred_at INTEGER NOT NULL,
  PRIMARY KEY (run_id, seq)
);
`

export class NativeAttemptAuthority {
  private db: Database | null = null
  private readonly options: NativeAttemptAuthorityOptions

  constructor(options: NativeAttemptAuthorityOptions) {
    this.options = options
  }

  initialize(): void {
    const { Database } = require("bun:sqlite") as { Database: new (path: string) => Database }
    this.db = new Database(this.options.databasePath)
    this.db.exec("PRAGMA journal_mode = WAL")
    this.db.exec("PRAGMA synchronous = FULL")
    this.db.exec("PRAGMA foreign_keys = ON")
    this.db.exec(SCHEMA_V1)
  }

  close(): void {
    if (this.db) {
      // WHY: on Windows the WAL side files keep OS handles until an
      // explicit checkpoint; TRUNCATE releases them so the test/temp
      // cleanup can delete the directory after close().
      try {
        this.db.exec("PRAGMA wal_checkpoint(TRUNCATE)")
        this.db.exec("PRAGMA journal_mode = DELETE")
      } catch { /* best-effort release before close */ }
      this.db.close()
      this.db = null
    }
  }

  private requireDb(): Database {
    if (!this.db) throw new Error("attempt authority not initialized (call initialize())")
    return this.db
  }

  private now(): number { return this.options.now?.() ?? Date.now() }

  /** Effect identity: deterministic, derived from the EffectKey (ADR 20). */
  static effectId(runId: string, effectKey: string): string {
    return `eff:${runId}:${effectKey}`
  }

  /**
   * Mint a NEW attempt (retry semantics: every call is a new AttemptId,
   * per-(runId, liId) monotonic seq). The LogicalInvocation row is
   * registered on first allocation. PENDING effect row is created on
   * first sight of the EffectKey (no-op if it exists).
   */
  allocateAttempt(runId: string, liId: string, effectKey: string): DurableAttempt {
    const db = this.requireDb()
    if (!runId || !liId || !effectKey) throw new Error("allocateAttempt: runId, liId and effectKey are required")
    let created!: DurableAttempt
    db.transaction(() => {
      const now = this.now()
      db.query("INSERT OR IGNORE INTO logical_invocations (run_id, li_id, created_at) VALUES (?, ?, ?)").run(runId, liId, now)
      const seq = db.query("SELECT COALESCE(MAX(seq), 0) + 1 AS seq FROM attempts WHERE run_id = ? AND li_id = ?").get(runId, liId) as { seq: number }
      const attemptId = `att:${runId}:${liId}:${seq.seq}`
      db.query("INSERT INTO attempts (run_id, li_id, seq, attempt_id, effect_key, outcome, result_json, ack_lost, created_at, updated_at) VALUES (?, ?, ?, ?, ?, NULL, NULL, 0, ?, ?)")
        .run(runId, liId, seq.seq, attemptId, effectKey, now, now)
      db.query("INSERT OR IGNORE INTO effects (run_id, effect_key, effect_id, status, result_json, reconciled, created_at, updated_at) VALUES (?, ?, ?, ?, NULL, 0, ?, ?)")
        .run(runId, effectKey, NativeAttemptAuthority.effectId(runId, effectKey), "PENDING", now, now)
      created = { runId, logicalInvocationId: liId, attemptId, seq: seq.seq, effectKey, outcome: null, resultJson: null, ackLost: false, createdAt: now }
    })()
    return created
  }

  /**
   * Record the outcome of one attempt. UNKNOWN_EXTERNAL_STATE is a
   * first-class outcome (TM-W-03): the caller does not know whether the
   * external side effect happened; the effect row moves to the same
   * status and stays reconcilable.
   */
  recordAttemptOutcome(runId: string, liId: string, attemptId: string, outcome: AttemptOutcome, input: { result?: unknown; ackLost?: boolean } = {}): void {
    const db = this.requireDb()
    db.transaction(() => {
      const row = db.query("SELECT seq, effect_key, outcome FROM attempts WHERE run_id = ? AND li_id = ? AND attempt_id = ?").get(runId, liId, attemptId) as { seq: number; effect_key: string; outcome: string | null } | null
      if (!row) throw new Error(`attempt not found: ${attemptId}`)
      if (row.outcome !== null) throw new Error(`attempt already terminal: ${attemptId} (${row.outcome})`)
      const now = this.now()
      db.query("UPDATE attempts SET outcome = ?, result_json = ?, ack_lost = ?, updated_at = ? WHERE run_id = ? AND li_id = ? AND attempt_id = ?")
        .run(outcome, input.result === undefined ? null : JSON.stringify(input.result), input.ackLost ? 1 : 0, now, runId, liId, attemptId)
      this.transitionEffect(db, runId, row.effect_key, outcome, input.result === undefined ? null : JSON.stringify(input.result), now)
    })()
  }

  /**
   * Reconciliation: the ONLY path out of UNKNOWN_EXTERNAL_STATE for an
   * effect. Terminal effects are never overwritten (idempotency).
   */
  reconcileEffect(runId: string, effectKey: string, outcome: "SUCCEEDED" | "FAILED", result?: unknown): void {
    const db = this.requireDb()
    db.transaction(() => {
      const row = db.query("SELECT status, reconciled FROM effects WHERE run_id = ? AND effect_key = ?").get(runId, effectKey) as { status: EffectStatus; reconciled: number } | null
      if (!row) throw new Error(`effect not found: ${effectKey}`)
      if (row.status === "SUCCEEDED" || row.status === "FAILED") throw new Error(`effect already terminal: ${effectKey} (${row.status})`)
      const now = this.now()
      db.query("UPDATE effects SET status = ?, result_json = ?, reconciled = 1, updated_at = ? WHERE run_id = ? AND effect_key = ?")
        .run(outcome, result === undefined ? null : JSON.stringify(result), now, runId, effectKey)
      this.journal(db, runId, effectKey, row.status, outcome, now)
    })()
  }

  private transitionEffect(db: Database, runId: string, effectKey: string, outcome: AttemptOutcome, resultJson: string | null, now: number): void {
    const row = db.query("SELECT status FROM effects WHERE run_id = ? AND effect_key = ?").get(runId, effectKey) as { status: EffectStatus } | null
    if (!row) throw new Error(`effect not found: ${effectKey}`)
    // Terminal effects are never blindly overwritten (idempotency);
    // UNKNOWN_EXTERNAL_STATE stays until reconcileEffect.
    if (row.status === "SUCCEEDED" || row.status === "FAILED") return
    if (row.status === "UNKNOWN_EXTERNAL_STATE" && outcome !== "UNKNOWN_EXTERNAL_STATE") return
    db.query("UPDATE effects SET status = ?, result_json = ?, updated_at = ? WHERE run_id = ? AND effect_key = ?")
      .run(outcome, resultJson, now, runId, effectKey)
    this.journal(db, runId, effectKey, row.status, outcome, now)
  }

  private journal(db: Database, runId: string, effectKey: string, from: EffectStatus, to: EffectStatus, now: number): void {
    const seq = db.query("SELECT COALESCE(MAX(seq), 0) + 1 AS seq FROM effect_journal WHERE run_id = ?").get(runId) as { seq: number }
    db.query("INSERT INTO effect_journal (run_id, seq, effect_key, from_status, to_status, occurred_at) VALUES (?, ?, ?, ?, ?, ?)")
      .run(runId, seq.seq, effectKey, from, to, now)
  }

  inspectEffect(runId: string, effectKey: string): DurableEffect | null {
    const db = this.requireDb()
    const row = db.query("SELECT run_id, effect_key, effect_id, status, result_json, reconciled, updated_at FROM effects WHERE run_id = ? AND effect_key = ?").get(runId, effectKey) as { run_id: string; effect_key: string; effect_id: string; status: EffectStatus; result_json: string | null; reconciled: number; updated_at: number } | null
    if (!row) return null
    return { runId: row.run_id, effectKey: row.effect_key, effectId: row.effect_id, status: row.status, resultJson: row.result_json, reconciled: row.reconciled === 1, updatedAt: row.updated_at }
  }

  inspectAttempts(runId: string, liId: string): readonly DurableAttempt[] {
    const db = this.requireDb()
    const rows = db.query("SELECT run_id, li_id, seq, attempt_id, effect_key, outcome, result_json, ack_lost, created_at FROM attempts WHERE run_id = ? AND li_id = ? ORDER BY seq").all(runId, liId) as { run_id: string; li_id: string; seq: number; attempt_id: string; effect_key: string; outcome: string | null; result_json: string | null; ack_lost: number; created_at: number }[]
    return rows.map((row) => ({ runId: row.run_id, logicalInvocationId: row.li_id, attemptId: row.attempt_id, seq: row.seq, effectKey: row.effect_key, outcome: (row.outcome ?? null) as AttemptOutcome | null, resultJson: row.result_json, ackLost: row.ack_lost === 1, createdAt: row.created_at }))
  }
}
