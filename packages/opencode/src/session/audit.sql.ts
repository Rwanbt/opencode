/**
 * Audit log table — append-only, security-sensitive actions.
 *
 * Fields:
 *   - id       : nanoid
 *   - ts       : epoch ms when the action happened (duplicate of time_created
 *                kept explicit so queries don't depend on Timestamps semantics)
 *   - actor    : free-form identifier of the principal (userID, "system",
 *                "agent:<name>", or undefined for anonymous)
 *   - action   : dotted string, e.g. "session.create", "auth.set",
 *                "permission.grant", "task.cancel", "config.write"
 *   - target   : optional entity the action operates on (sessionID, providerID,
 *                toolID, path, ...). Used as a filter key.
 *   - metadata : JSON blob, free-form context (diffs, reasons, payload hashes).
 *                **Must never contain secrets**. Callers are responsible for
 *                redaction before calling `AuditLog.record`.
 */
import { sqliteTable, text, integer, index } from "drizzle-orm/sqlite-core"
import { Timestamps } from "../storage/schema.sql"

export const AuditLogTable = sqliteTable(
  "audit_log",
  {
    id: text().primaryKey(),
    ts: integer().notNull(),
    actor: text(),
    action: text().notNull(),
    target: text(),
    metadata: text({ mode: "json" }).$type<Record<string, unknown>>(),
    ...Timestamps,
  },
  (table) => [
    index("audit_log_ts_idx").on(table.ts),
    index("audit_log_action_idx").on(table.action),
    index("audit_log_actor_idx").on(table.actor),
  ],
)
