import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core"

// Phase 3 opt-in (ADR-1032, plan §12/§16). One row per (scope, scope_id):
// setting a new opt-in for the same entity overwrites the previous one
// (re-opt-in extends/changes level+TTL, it does not stack). Expiry is
// evaluated passively by capture-content.ts on every resolveCapturePolicy()
// call and swept actively by purge.ts on a timer — never cached past
// expires_at_ms (plan invariant 7: opt-in requires visible UI, TTL, revoke).
export const ObservabilityContentOptInTable = sqliteTable(
  "observability_content_optin",
  {
    id: integer().primaryKey({ autoIncrement: true }),
    scope: text().notNull(), // "workspace" | "project" | "session"
    scope_id: text().notNull(),
    level: text().notNull(), // "local_content_redacted" | "local_full"
    ttl_days: integer().notNull(),
    created_at_ms: integer().notNull(),
    expires_at_ms: integer().notNull(),
  },
  (table) => [
    uniqueIndex("observability_content_optin_scope_idx").on(table.scope, table.scope_id),
    index("observability_content_optin_expires_idx").on(table.expires_at_ms),
  ],
)
