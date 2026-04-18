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
import { and, desc, eq, gte, lt, lte, SQL } from "drizzle-orm"
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

  /**
   * Delete audit rows older than `now - retention_days * 86400_000`.
   *
   * Returns the number of deleted rows. No-op when audit is disabled or the
   * retention config is missing / invalid. Silently swallows DB errors (audit
   * purge is best-effort — a failing purge must not crash the server).
   */
  export async function purgeExpired(): Promise<number> {
    try {
      const cfg = await Config.get()
      const audit = (cfg as any)?.experimental?.audit
      if (!audit?.enabled) return 0
      const days = typeof audit.retention_days === "number" && audit.retention_days > 0 ? audit.retention_days : 90
      const cutoff = Date.now() - days * 86_400_000
      const res = Database.use((db) => db.delete(AuditLogTable).where(lt(AuditLogTable.ts, cutoff)).run())
      // better-sqlite3 returns { changes } on `.run()`. Tolerate undefined.
      const n = (res as any)?.changes ?? 0
      if (n > 0) log.info("purged audit rows", { removed: n, retentionDays: days })
      return n
    } catch (e) {
      log.warn("audit purge failed", { e: String(e) })
      return 0
    }
  }

  /** Interval handle returned by `startRetentionTimer`. */
  let _retentionTimer: ReturnType<typeof setInterval> | undefined

  /**
   * Kick off the retention purger: run once now (fire-and-forget) and then
   * every 24h. Uses `unref()` so the timer does not keep the event loop alive.
   * Safe to call multiple times — subsequent calls are no-ops.
   */
  export function startRetentionTimer(): void {
    if (_retentionTimer) return
    // Initial run — swallow errors, best-effort.
    void purgeExpired().catch(() => {})
    _retentionTimer = setInterval(
      () => {
        void purgeExpired().catch(() => {})
      },
      24 * 60 * 60 * 1000,
    )
    _retentionTimer.unref?.()
  }

  /** Stop the retention timer. Test-only. */
  export function stopRetentionTimer(): void {
    if (_retentionTimer) {
      clearInterval(_retentionTimer)
      _retentionTimer = undefined
    }
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
