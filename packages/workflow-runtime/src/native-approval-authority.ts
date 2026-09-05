/* SPDX-License-Identifier: MIT */
/* Copyright (c) 2026 Unifia contributors */

/**
 * NativeApprovalAuthority — the production UNIFIA_NATIVE ApprovalAuthority
 * for the D-02 V4 facade (ADR-000 ratified 2026-09-05, Outcome A).
 *
 * This is the first DURABLE implementation of the ApprovalAuthority
 * contract (approval-v4.ts). It closes the D-02 V4 production durable
 * gate that stayed open pending ADR-000 (D02-V4-AUDIT-MATRIX req.22).
 *
 * Fencing (FC-14/FC-25 semantics): every token (workflowRunId,
 * generation, authorityOwnerId) is validated against the persisted
 * authority row inside the same transaction as the mutation. A stale
 * generation or a deposed owner gets ApprovalV4Error("STALE_AUTHORITY")
 * — exactly one claim winner, stale writers rejected.
 *
 * Durability: SQLite WAL + synchronous=FULL (FC-13-proven); approvals,
 * history events and the authority generation row commit in ONE
 * transaction (atomic state + history, D-02 requirement 15/16).
 * eventSequence is a per-run monotonic counter — restart-safe.
 */
import type {
  ApprovalActor,
  ApprovalAuthority,
  ApprovalAuthorityState,
  ApprovalHistoryEvent,
  ApprovalHistoryEventKind,
  ApprovalRecord,
  AuthorityToken,
} from "./approval-v4.ts"
import { ApprovalV4Error } from "./approval-v4.ts"
import type { Database } from "bun:sqlite"

export interface NativeApprovalAuthorityOptions {
  readonly databasePath: string
  /** System actors trusted for CANCELLED-by-system (id allowlist). */
  readonly trustedSystemActorIds?: readonly string[]
  /** Injectable clock (tests). Defaults to Date.now. */
  readonly now?: () => number
}

const SCHEMA_V1 = `
CREATE TABLE IF NOT EXISTS approval_authority (
  run_id TEXT PRIMARY KEY,
  generation INTEGER NOT NULL,
  owner_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS approvals (
  run_id TEXT NOT NULL,
  approval_id TEXT NOT NULL,
  record_json TEXT NOT NULL,
  PRIMARY KEY (run_id, approval_id)
);
CREATE TABLE IF NOT EXISTS approval_history (
  run_id TEXT NOT NULL,
  event_sequence INTEGER NOT NULL,
  event_id TEXT NOT NULL,
  approval_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  previous_state TEXT,
  actor_id TEXT NOT NULL,
  occurred_at INTEGER NOT NULL,
  PRIMARY KEY (run_id, event_sequence)
);
`

interface AuthorityRow { run_id: string; generation: number; owner_id: string; created_at: number; updated_at: number }
interface HistoryRow { event_sequence: number; event_id: string; approval_id: string; kind: string; previous_state: string | null; actor_id: string; occurred_at: number }

export class NativeApprovalAuthority implements ApprovalAuthority {
  private db: Database | null = null
  private readonly trustedIds: ReadonlySet<string>
  private readonly options: NativeApprovalAuthorityOptions

  constructor(options: NativeApprovalAuthorityOptions) {
    this.options = options
    this.trustedIds = new Set(options.trustedSystemActorIds ?? ["authority-system"])
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
    this.db?.close()
    this.db = null
  }

  private requireDb(): Database {
    if (!this.db) throw new ApprovalV4Error("AUTHORITY_NOT_INITIALIZED")
    return this.db
  }

  now(): number { return this.options.now?.() ?? Date.now() }

  /**
   * Claim the authority for a run (initial generation 1). Idempotent
   * for the same owner; a re-claim by a different owner is rejected
   * (use takeover).
   */
  claim(runId: string, ownerId: string): void {
    const db = this.requireDb()
    const now = this.now()
    db.transaction(() => {
      const existing = db.query("SELECT run_id, generation, owner_id FROM approval_authority WHERE run_id = ?").get(runId) as AuthorityRow | null
      if (existing) {
        if (existing.owner_id !== ownerId) throw new ApprovalV4Error("AUTHORITY_OWNED_BY_OTHER")
        return
      }
      db.query("INSERT INTO approval_authority (run_id, generation, owner_id, created_at, updated_at) VALUES (?, 1, ?, ?, ?)")
        .run(runId, ownerId, now, now)
    })()
  }

  /** Authority takeover (FC-25): bumps generation, deposes the previous owner. */
  takeover(runId: string, newOwnerId: string): void {
    const db = this.requireDb()
    const now = this.now()
    db.transaction(() => {
      const existing = db.query("SELECT run_id, generation, owner_id FROM approval_authority WHERE run_id = ?").get(runId) as AuthorityRow | null
      if (!existing) throw new ApprovalV4Error("AUTHORITY_NOT_CLAIMED")
      if (existing.owner_id === newOwnerId) throw new ApprovalV4Error("TAKEOVER_SAME_OWNER")
      db.query("UPDATE approval_authority SET generation = generation + 1, owner_id = ?, updated_at = ? WHERE run_id = ?")
        .run(newOwnerId, now, runId)
    })()
  }

  inspectAuthority(runId: string): { generation: number; ownerId: string } | null {
    const db = this.requireDb()
    const row = db.query("SELECT generation, owner_id FROM approval_authority WHERE run_id = ?").get(runId) as AuthorityRow | null
    return row ? { generation: row.generation, ownerId: row.owner_id } : null
  }

  isTrustedSystemActor(actor: ApprovalActor, token: AuthorityToken): boolean {
    if (actor.kind !== "system" || !this.trustedIds.has(actor.id)) return false
    const db = this.requireDb()
    const row = db.query("SELECT owner_id FROM approval_authority WHERE run_id = ?").get(token.workflowRunId) as { owner_id: string } | null
    return row !== null && row.owner_id === token.authorityOwnerId
  }

  /**
   * Compute-then-commit: the facade mutation is a pure state transform,
   * so it runs against the persisted snapshot OUTSIDE the write
   * transaction; the commit transaction then re-fences (generation +
   * owner unchanged) and rejects concurrent history drift before
   * persisting approvals + journal events in ONE atomic write.
   */
  async transact<T>(token: AuthorityToken, mutation: (state: ApprovalAuthorityState) => Promise<{ state: ApprovalAuthorityState; result: T }>): Promise<T> {
    const db = this.requireDb()
    const auth = this.authorityRow(token.workflowRunId)
    this.assertFence(auth, token)
    const snapshot = this.loadState(token.workflowRunId)
    const next = await mutation(snapshot)
    let result!: T
    db.transaction(() => {
      const authNow = this.authorityRow(token.workflowRunId)
      this.assertFence(authNow, token)
      const currentMax = db.query("SELECT COALESCE(MAX(event_sequence), 0) AS m FROM approval_history WHERE run_id = ?").get(token.workflowRunId) as { m: number }
      if (currentMax.m !== snapshot.history.length) throw new ApprovalV4Error("CONCURRENT_STATE_CHANGE")
      const upsert = db.query("INSERT INTO approvals (run_id, approval_id, record_json) VALUES (?, ?, ?) ON CONFLICT (run_id, approval_id) DO UPDATE SET record_json = excluded.record_json")
      for (const record of Object.values(next.state.approvals)) {
        if (record.workflowRunId !== token.workflowRunId) throw new ApprovalV4Error("AUTHORITY_RUN_MISMATCH")
        upsert.run(token.workflowRunId, record.approvalId, JSON.stringify(record))
      }
      for (const event of next.state.history.slice(snapshot.history.length)) {
        db.query("INSERT INTO approval_history (run_id, event_sequence, event_id, approval_id, kind, previous_state, actor_id, occurred_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
          .run(token.workflowRunId, event.eventSequence, event.eventId, event.approvalId, event.kind, event.previousState, event.actorId, event.occurredAt)
      }
      db.query("UPDATE approval_authority SET updated_at = ? WHERE run_id = ?").run(this.now(), token.workflowRunId)
      result = next.result
    })()
    return result
  }

  private authorityRow(runId: string): AuthorityRow {
    const db = this.requireDb()
    const row = db.query("SELECT run_id, generation, owner_id, created_at, updated_at FROM approval_authority WHERE run_id = ?").get(runId) as AuthorityRow | null
    if (!row) throw new ApprovalV4Error("AUTHORITY_NOT_CLAIMED")
    return row
  }

  private assertFence(auth: AuthorityRow, token: AuthorityToken): void {
    if (token.workflowRunId !== auth.run_id) throw new ApprovalV4Error("AUTHORITY_RUN_MISMATCH")
    if (token.generation !== auth.generation || token.authorityOwnerId !== auth.owner_id) throw new ApprovalV4Error("STALE_AUTHORITY")
  }

  private loadState(runId: string): ApprovalAuthorityState {
    const db = this.requireDb()
    const approvals: Record<string, ApprovalRecord> = {}
    for (const row of db.query("SELECT approval_id, record_json FROM approvals WHERE run_id = ?").all(runId) as { approval_id: string; record_json: string }[]) {
      approvals[row.approval_id] = JSON.parse(row.record_json) as ApprovalRecord
    }
    return { history: this.readHistoryRows(runId), ...{ generation: this.authorityRow(runId).generation, ownerId: this.authorityRow(runId).owner_id }, approvals }
  }

  async read(token: AuthorityToken, id: string): Promise<ApprovalRecord | undefined> {
    this.fenceRead(token)
    const db = this.requireDb()
    const row = db.query("SELECT record_json FROM approvals WHERE run_id = ? AND approval_id = ?").get(token.workflowRunId, id) as { record_json: string } | null
    return row ? (JSON.parse(row.record_json) as ApprovalRecord) : undefined
  }

  async readHistory(token: AuthorityToken, approvalId: string): Promise<readonly ApprovalHistoryEvent[]> {
    this.fenceRead(token)
    return this.readHistoryRows(token.workflowRunId).filter((event) => event.approvalId === approvalId)
  }

  private fenceRead(token: AuthorityToken): void {
    const db = this.requireDb()
    const auth = db.query("SELECT run_id, generation, owner_id FROM approval_authority WHERE run_id = ?").get(token.workflowRunId) as AuthorityRow | null
    if (!auth) throw new ApprovalV4Error("AUTHORITY_NOT_CLAIMED")
    if (token.generation !== auth.generation || token.authorityOwnerId !== auth.owner_id) throw new ApprovalV4Error("STALE_AUTHORITY")
  }

  private readHistoryRows(runId: string): ApprovalHistoryEvent[] {
    const db = this.requireDb()
    const rows = db.query("SELECT event_sequence, event_id, approval_id, kind, previous_state, actor_id, occurred_at FROM approval_history WHERE run_id = ? ORDER BY event_sequence").all(runId) as HistoryRow[]
    return rows.map((row) => ({
      eventSequence: row.event_sequence,
      eventId: row.event_id,
      approvalId: row.approval_id,
      kind: row.kind as ApprovalHistoryEventKind,
      previousState: (row.previous_state ?? null) as ApprovalHistoryEvent["previousState"],
      actorId: row.actor_id,
      occurredAt: row.occurred_at,
    }))
  }
}
