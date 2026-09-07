/* SPDX-License-Identifier: MIT */
/**
 * Lifecycle audit log (P4.4).
 *
 * Per ADR-KNOW-0009: "toutes les transitions destructives
 * exigent une intention autorisée et produisent un audit."
 *
 * V1 ships an in-memory append-only audit log. The log is the
 * canonical record of every accepted transition; the persisted
 * Class C control state is the durable extension of this log.
 *
 * The log is:
 *  - append-only (no entry can be edited or removed);
 *  - ordered by `seq` (monotonically increasing);
 *  - queryable by id, by source, by transition kind, and by
 *    time range.
 */

import type { KnowledgeId, KnowledgeLifecycleState } from "@unifia/contracts/knowledge"

export interface AuditEntry {
  /** Monotonically increasing sequence number. */
  seq: number
  /** Target note id. */
  id: KnowledgeId
  /** Previous lifecycle. */
  from: KnowledgeLifecycleState
  /** New lifecycle. */
  to: KnowledgeLifecycleState
  /** Audit id (UUID-like, opaque). */
  auditId: string
  /** Reason given for the transition. */
  reason: string
  /** Source (agent, user, "mcp", ...). */
  source: string
  /** ISO 8601 timestamp. */
  timestamp: string
}

export interface AuditLogInput {
  id: KnowledgeId
  from: KnowledgeLifecycleState
  to: KnowledgeLifecycleState
  auditId: string
  reason: string
  source: string
  timestamp?: string
}

export class LifecycleAuditLog {
  private entries: AuditEntry[] = []
  private nextSeq = 1

  append(input: AuditLogInput): AuditEntry {
    if (input.auditId.length === 0) {
      throw new Error("auditId must be non-empty")
    }
    if (input.from === input.to) {
      throw new Error(`refusing to log no-op transition ${input.from} -> ${input.to}`)
    }
    const e: AuditEntry = {
      seq: this.nextSeq,
      id: input.id,
      from: input.from,
      to: input.to,
      auditId: input.auditId,
      reason: input.reason,
      source: input.source,
      timestamp: input.timestamp ?? new Date().toISOString(),
    }
    this.entries.push(e)
    this.nextSeq += 1
    return e
  }

  /** Return all entries, ordered by seq. */
  all(): readonly AuditEntry[] {
    return [...this.entries]
  }

  /** Filter by target id. */
  byId(id: KnowledgeId): AuditEntry[] {
    return this.entries.filter((e) => e.id === id)
  }

  /** Filter by source. */
  bySource(source: string): AuditEntry[] {
    return this.entries.filter((e) => e.source === source)
  }

  /** Filter by transition kind (e.g. "superseded" entries). */
  byTransition(to: KnowledgeLifecycleState): AuditEntry[] {
    return this.entries.filter((e) => e.to === to)
  }

  /** Filter by time range (ISO 8601 inclusive on both ends). */
  byTimeRange(fromIso: string, toIso: string): AuditEntry[] {
    const fromMs = Date.parse(fromIso)
    const toMs = Date.parse(toIso)
    return this.entries.filter((e) => {
      const t = Date.parse(e.timestamp)
      return Number.isFinite(t) && t >= fromMs && t <= toMs
    })
  }

  /** Total entries. */
  size(): number {
    return this.entries.length
  }

  /** Drop everything. Intended for tests only. */
  reset(): void {
    this.entries = []
    this.nextSeq = 1
  }
}
