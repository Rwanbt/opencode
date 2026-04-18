/**
 * Audit log recording helper.
 *
 * Usage:
 *   AuditLog.record({ action: "session.create", target: sessionID })
 *   AuditLog.record({ action: "auth.set", target: providerID, actor: userID })
 *
 * Policy:
 *   - All writes are best-effort; a failing audit insert MUST NOT break the
 *     originating action. Errors are logged and swallowed.
 *   - If `experimental.audit.enabled` is false (default), records are silently
 *     discarded to avoid DB churn for users who didn't opt in.
 *   - `metadata` must never contain plaintext secrets. Callers should hash /
 *     redact before passing.
 */
import { randomBytes } from "crypto"
import { Database } from "../storage/db"
import { AuditLogTable } from "./audit.sql"
import { and, desc, eq, gte, lte, SQL } from "drizzle-orm"
import { Log } from "../util/log"
import { Config } from "../config/config"

const log = Log.create({ service: "audit" })

export namespace AuditLog {
  export interface Entry {
    id: string
    ts: number
    actor?: string
    action: string
    target?: string
    metadata?: Record<string, unknown>
  }

  export interface RecordInput {
    action: string
    target?: string
    actor?: string
    metadata?: Record<string, unknown>
    /** Skip the enabled-config gate (used by GDPR export/delete which must
     *  always be logged for compliance). */
    force?: boolean
  }

  function makeId(): string {
    // 16 random bytes hex — enough for audit log primary key uniqueness.
    return "aud_" + randomBytes(12).toString("hex")
  }

  async function isEnabled(): Promise<boolean> {
    try {
      const cfg = await Config.get()
      return Boolean((cfg as any)?.experimental?.audit?.enabled)
    } catch {
      return false
    }
  }

  /** Record an audit entry. Fire-and-forget; never throws. */
  export async function record(input: RecordInput): Promise<void> {
    if (!input.force && !(await isEnabled())) return
    try {
      const now = Date.now()
      Database.use((db) =>
        db
          .insert(AuditLogTable)
          .values({
            id: makeId(),
            ts: now,
            actor: input.actor,
            action: input.action,
            target: input.target,
            metadata: input.metadata,
            time_created: now,
            time_updated: now,
          } as any)
          .run(),
      )
    } catch (e) {
      log.warn("audit record failed", { action: input.action, e: String(e) })
    }
  }

  /** Fire-and-forget sync-ish wrapper for call sites that can't await. */
  export function recordAsync(input: RecordInput): void {
    void record(input).catch(() => {})
  }

  export interface ListInput {
    from?: number
    to?: number
    limit?: number
    action?: string
    actor?: string
  }

  export function list(input: ListInput = {}): Entry[] {
    const limit = Math.min(Math.max(input.limit ?? 100, 1), 1000)
    const conditions: SQL[] = []
    if (input.from !== undefined) conditions.push(gte(AuditLogTable.ts, input.from))
    if (input.to !== undefined) conditions.push(lte(AuditLogTable.ts, input.to))
    if (input.action) conditions.push(eq(AuditLogTable.action, input.action))
    if (input.actor) conditions.push(eq(AuditLogTable.actor, input.actor))

    return Database.use((db) => {
      const q = conditions.length
        ? db.select().from(AuditLogTable).where(and(...conditions))
        : db.select().from(AuditLogTable)
      return q.orderBy(desc(AuditLogTable.ts)).limit(limit).all()
    }).map((r: any) => ({
      id: r.id,
      ts: r.ts,
      actor: r.actor ?? undefined,
      action: r.action,
      target: r.target ?? undefined,
      metadata: r.metadata ?? undefined,
    }))
  }
}
