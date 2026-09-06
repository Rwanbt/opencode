/* SPDX-License-Identifier: MIT */
/* Copyright (c) 2026 Unifia contributors */

/**
 * NativeDurableHistoryAuthority — the production UNIFIA_NATIVE
 * DurableHistoryAuthority (ADR-000 ratified 2026-09-05, Outcome A).
 *
 * SQLite (bun:sqlite) with the FC-13-proven durable configuration:
 * journal_mode=WAL + synchronous=FULL — the acknowledged durable
 * transition survives a hard power cut (20/20 real QEMU power-loss
 * iterations, docs/automation-v2/m0/FC13-METHODOLOGY.md).
 *
 * Semantics mirror InMemoryDurableHistoryAuthority (M1-09): ADR-022
 * 4 transition matrix, atomic status+effect-slot transition (single
 * transaction = single WAL commit), command queue, timers with
 * overlap policy, derived materialized projection. Restart recovery
 * is free: every fact is a row — a reopened instance continues from
 * the persisted state with no replay ambiguity.
 */
import type {
  AtomicTransitionBoundary,
  DurableAuthorityKind,
  MaterializedRunProjection,
  OverlapPolicy,
  WorkflowRun,
  WorkflowRunStatus,
} from "@unifia/contracts"
import {
  AtomicTransitionBoundarySchema,
  WorkflowRunSchema,
} from "@unifia/contracts"
import { CURRENT_DURABLE_SCHEMA_VERSION, ensureSchemaVersion, RETENTION_SCHEMA } from "./retention.ts"
import type { Database } from "bun:sqlite"
import type { DurableHistoryAuthority } from "./adapter.ts"
import {
  HistoryAuthorityError,
  IllegalTransitionError,
  RunNotFoundError,
  isLegalTransition,
} from "./in-memory.ts"
import { assertAuthorityForRun, claimAuthority, type AuthorityToken, WORKFLOW_AUTHORITY_SCHEMA } from "./authority.ts"

export interface NativeHistoryAuthorityOptions {
  /** SQLite database file path. Created on initialize if absent. */
  readonly databasePath: string
  /** Authority kind recorded on registered runs. */
  readonly authorityKind?: DurableAuthorityKind
  /** Injectable clock (tests). Defaults to Date.now. */
  readonly now?: () => number
}

const SCHEMA_V1 = `${WORKFLOW_AUTHORITY_SCHEMA}
CREATE TABLE IF NOT EXISTS runs (
  run_id TEXT PRIMARY KEY,
  run_json TEXT NOT NULL,
  status TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS run_transitions (
  run_id TEXT NOT NULL,
  seq INTEGER NOT NULL,
  from_status TEXT NOT NULL,
  to_status TEXT NOT NULL,
  effect_slot_id TEXT NOT NULL,
  occurred_at INTEGER NOT NULL,
  is_compensating INTEGER NOT NULL,
  PRIMARY KEY (run_id, seq)
);
CREATE TABLE IF NOT EXISTS commands (
  run_id TEXT NOT NULL,
  seq INTEGER NOT NULL,
  kind TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  enqueued_at INTEGER NOT NULL,
  PRIMARY KEY (run_id, seq)
);
CREATE TABLE IF NOT EXISTS timers_fired (
  run_id TEXT NOT NULL,
  timer_id TEXT NOT NULL,
  fired_at INTEGER NOT NULL,
  PRIMARY KEY (run_id, timer_id)
);
CREATE TABLE IF NOT EXISTS timers (
  run_id TEXT NOT NULL,
  timer_id TEXT NOT NULL,
  fire_at INTEGER NOT NULL,
  overlap_policy TEXT NOT NULL,
  scheduled_at INTEGER NOT NULL,
  PRIMARY KEY (run_id, timer_id)
);
`

interface RunRow { run_id: string; run_json: string; status: string; created_at: number; updated_at: number }
interface TransitionRow { seq: number; from_status: string; to_status: string; effect_slot_id: string; occurred_at: number; is_compensating: number }
interface CommandRow { seq: number; kind: string; payload_json: string; enqueued_at: number }
interface TimerRow { timer_id: string; fire_at: number; overlap_policy: string; scheduled_at: number }

export class NativeDurableHistoryAuthority implements DurableHistoryAuthority {
  private db: Database | null = null
  private readonly options: Required<Pick<NativeHistoryAuthorityOptions, "authorityKind">> & NativeHistoryAuthorityOptions

  constructor(options: NativeHistoryAuthorityOptions) {
    this.options = { authorityKind: options.authorityKind ?? "native", ...options }
  }

  initialize(): void {
    const { Database } = require("bun:sqlite") as { Database: new (path: string) => Database }
    this.db = new Database(this.options.databasePath)
    // FC-13-proven durable configuration: WAL + synchronous=FULL.
    this.db.exec("PRAGMA journal_mode = WAL")
    this.db.exec("PRAGMA synchronous = FULL")
    this.db.exec("PRAGMA foreign_keys = ON")
    this.db.exec(SCHEMA_V1)
    this.db.exec(RETENTION_SCHEMA)
    // ADR-018: fail closed on an incompatible durable store version.
    ensureSchemaVersion(this.db, "history_schema_version", CURRENT_DURABLE_SCHEMA_VERSION)
  }

  close(): void {
    this.db?.close()
    this.db = null
  }

  private requireDb(): Database {
    if (!this.db) throw new HistoryAuthorityError("authority not initialized (call initialize())")
    return this.db
  }

  private now(): number { return this.options.now?.() ?? Date.now() }

  /** Register a run (setup method, same role as the in-memory impl). */
  register(run: WorkflowRun): void {
    const db = this.requireDb()
    const parsed = WorkflowRunSchema.parse({ ...run, durableAuthorityKind: this.options.authorityKind })
    db.transaction(() => {
      db.query("INSERT INTO runs (run_id, run_json, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?)")
        .run(parsed.runId, JSON.stringify(parsed), parsed.status, parsed.createdAt, parsed.updatedAt)
    })()
  }

  claim(runId: string, ownerId: string): AuthorityToken {
    return claimAuthority(this.requireDb(), runId, ownerId, this.now())
  }

  async getRun(runId: string): Promise<WorkflowRun | null> {
    const db = this.requireDb()
    const row = db.query("SELECT run_id, run_json, status, created_at, updated_at FROM runs WHERE run_id = ?").get(runId) as RunRow | null
    if (!row) return null
    return deepCopy(JSON.parse(row.run_json) as WorkflowRun)
  }

  async transition(token: AuthorityToken, runId: string, event: AtomicTransitionBoundary): Promise<void> {
    const db = this.requireDb()
    const parsed = AtomicTransitionBoundarySchema.parse(event)
    if (parsed.occurredAt > this.now()) throw new HistoryAuthorityError(`transition.occurredAt is in the future: ${parsed.occurredAt}`)
    db.transaction(() => {
      assertAuthorityForRun(db, token, runId)
      const row = db.query("SELECT run_id, run_json, status, created_at, updated_at FROM runs WHERE run_id = ?").get(runId) as RunRow | null
      if (!row) throw new RunNotFoundError(runId)
      const current = row.status as WorkflowRunStatus
      if (parsed.from !== current) {
        throw new HistoryAuthorityError(`transition.from (${parsed.from}) does not match current status (${current})`)
      }
      if (!isLegalTransition(parsed.from, parsed.to)) {
        throw new IllegalTransitionError(parsed.from, parsed.to)
      }
      const seq = db.query("SELECT COALESCE(MAX(seq), 0) + 1 AS seq FROM run_transitions WHERE run_id = ?").get(runId) as { seq: number }
      db.query("INSERT INTO run_transitions (run_id, seq, from_status, to_status, effect_slot_id, occurred_at, is_compensating) VALUES (?, ?, ?, ?, ?, ?, ?)")
        .run(runId, seq.seq, parsed.from, parsed.to, parsed.effectSlotId, parsed.occurredAt, parsed.isCompensating ? 1 : 0)
      const run = JSON.parse(row.run_json) as WorkflowRun
      const updated: WorkflowRun = { ...run, status: parsed.to, updatedAt: parsed.occurredAt }
      db.query("UPDATE runs SET run_json = ?, status = ?, updated_at = ? WHERE run_id = ?")
        .run(JSON.stringify(updated), parsed.to, parsed.occurredAt, runId)
    })()
  }

  async enqueueCommand(token: AuthorityToken, runId: string, command: { kind: string; payload: unknown }): Promise<void> {
    const db = this.requireDb()
    if (!command.kind) throw new HistoryAuthorityError("command.kind is required")
    db.transaction(() => {
      assertAuthorityForRun(db, token, runId)
      const exists = db.query("SELECT run_id FROM runs WHERE run_id = ?").get(runId)
      if (!exists) throw new RunNotFoundError(runId)
      const seq = db.query("SELECT COALESCE(MAX(seq), 0) + 1 AS seq FROM commands WHERE run_id = ?").get(runId) as { seq: number }
      db.query("INSERT INTO commands (run_id, seq, kind, payload_json, enqueued_at) VALUES (?, ?, ?, ?, ?)")
        .run(runId, seq.seq, command.kind, JSON.stringify(command.payload ?? null), this.now())
    })()
  }

  async scheduleTimer(token: AuthorityToken, timerId: string, runId: string, fireAt: number, overlapPolicy: OverlapPolicy): Promise<void> {
    const db = this.requireDb()
    db.transaction(() => {
      assertAuthorityForRun(db, token, runId)
      const exists = db.query("SELECT run_id FROM runs WHERE run_id = ?").get(runId)
      if (!exists) throw new RunNotFoundError(runId)
      const existing = db.query("SELECT timer_id FROM timers WHERE run_id = ? AND timer_id = ?").get(runId, timerId)
      // Documented overlap semantics (adapter.ts): forbid on a still
      // scheduled timer is a no-op; replace cancels (overwrites) the
      // previous timer; allow/queue append (the timerId stays unique).
      if (existing) {
        if (overlapPolicy === "forbid") return
        if (overlapPolicy === "replace") {
          db.query("UPDATE timers SET fire_at = ?, overlap_policy = ?, scheduled_at = ? WHERE run_id = ? AND timer_id = ?")
            .run(fireAt, overlapPolicy, this.now(), runId, timerId)
          return
        }
        return
      }
      db.query("INSERT INTO timers (run_id, timer_id, fire_at, overlap_policy, scheduled_at) VALUES (?, ?, ?, ?, ?)")
        .run(runId, timerId, fireAt, overlapPolicy, this.now())
    })()
  }

  async getMaterializedProjection(runId: string): Promise<MaterializedRunProjection> {
    const db = this.requireDb()
    const run = await this.getRun(runId)
    if (!run) throw new RunNotFoundError(runId)
    const transitions = db.query("SELECT seq, from_status, to_status, effect_slot_id, occurred_at, is_compensating FROM run_transitions WHERE run_id = ? ORDER BY seq").all(runId) as TransitionRow[]
    const commands = db.query("SELECT seq, kind, payload_json, enqueued_at FROM commands WHERE run_id = ? ORDER BY seq").all(runId) as CommandRow[]
    const timers = db.query("SELECT timer_id, fire_at, overlap_policy, scheduled_at FROM timers WHERE run_id = ? ORDER BY fire_at").all(runId) as TimerRow[]
    const last = transitions.length > 0 ? transitions[transitions.length - 1]! : null
    return {
      runId,
      status: run.status,
      pendingEffects: commands.map((c) => `${c.kind}:${runId}`),
      pendingTimers: timers.map((t) => ({ timerId: t.timer_id, fireAt: t.fire_at })),
      lastTransitionAt: last?.occurred_at,
    }
  }

  /** Inspection (tests + substrate proof; not on the interface). */
  inspectTransitions(runId: string): readonly AtomicTransitionBoundary[] {
    const db = this.requireDb()
    const rows = db.query("SELECT seq, from_status, to_status, effect_slot_id, occurred_at, is_compensating FROM run_transitions WHERE run_id = ? ORDER BY seq").all(runId) as TransitionRow[]
    return rows.map((row) => ({
      from: row.from_status as WorkflowRunStatus,
      to: row.to_status as WorkflowRunStatus,
      effectSlotId: row.effect_slot_id,
      occurredAt: row.occurred_at,
      isCompensating: row.is_compensating === 1,
    }))
  }

  inspectCommands(runId: string): readonly { kind: string; payload: unknown; enqueuedAt: number }[] {
    const db = this.requireDb()
    const rows = db.query("SELECT seq, kind, payload_json, enqueued_at FROM commands WHERE run_id = ? ORDER BY seq").all(runId) as CommandRow[]
    return rows.map((row) => ({ kind: row.kind, payload: JSON.parse(row.payload_json), enqueuedAt: row.enqueued_at }))
  }

  inspectTimers(runId: string): readonly { timerId: string; fireAt: number; overlapPolicy: OverlapPolicy; scheduledAt: number }[] {
    const db = this.requireDb()
    const rows = db.query("SELECT timer_id, fire_at, overlap_policy, scheduled_at FROM timers WHERE run_id = ? ORDER BY fire_at").all(runId) as TimerRow[]
    return rows.map((row) => ({ timerId: row.timer_id, fireAt: row.fire_at, overlapPolicy: row.overlap_policy as OverlapPolicy, scheduledAt: row.scheduled_at }))
  }

  /**
   * Directive 17: durable timer firing. dueTimers lists timers whose
   * fireAt is at-or-before nowMs (no early fire); markTimerFired moves
   * the timer to timers_fired in ONE transaction (at-most-once per
   * timerId — no duplicate logical fire). Facts are rows: a restart
   * fires missed timers exactly per this same catch-up path.
   */
  dueTimers(nowMs: number): readonly { runId: string; timerId: string; fireAt: number }[] {
    const db = this.requireDb()
    const rows = db.query("SELECT t.run_id AS run_id, t.timer_id AS timer_id, t.fire_at AS fire_at FROM timers t WHERE t.fire_at <= ? AND NOT EXISTS (SELECT 1 FROM timers_fired f WHERE f.run_id = t.run_id AND f.timer_id = t.timer_id) ORDER BY t.fire_at").all(nowMs) as { run_id: string; timer_id: string; fire_at: number }[]
    return rows.map((row) => ({ runId: row.run_id, timerId: row.timer_id, fireAt: row.fire_at }))
  }

  markTimerFired(token: AuthorityToken, runId: string, timerId: string, nowMs: number): void {
    const db = this.requireDb()
    db.transaction(() => {
      assertAuthorityForRun(db, token, runId)
      const existing = db.query("SELECT timer_id FROM timers_fired WHERE run_id = ? AND timer_id = ?").get(runId, timerId)
      if (existing) throw new HistoryAuthorityError(`timer already fired: ${timerId}`)
      db.query("INSERT INTO timers_fired (run_id, timer_id, fired_at) VALUES (?, ?, ?)").run(runId, timerId, nowMs)
      db.query("DELETE FROM timers WHERE run_id = ? AND timer_id = ?").run(runId, timerId)
    })()
  }

  firedTimers(runId?: string): readonly { runId: string; timerId: string; firedAt: number }[] {
    const db = this.requireDb()
    const rows = (runId
      ? db.query("SELECT run_id, timer_id, fired_at FROM timers_fired WHERE run_id = ? ORDER BY fired_at").all(runId)
      : db.query("SELECT run_id, timer_id, fired_at FROM timers_fired ORDER BY fired_at").all()) as { run_id: string; timer_id: string; fired_at: number }[]
    return rows.map((row) => ({ runId: row.run_id, timerId: row.timer_id, firedAt: row.fired_at }))
  }
}

function deepCopy<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}
