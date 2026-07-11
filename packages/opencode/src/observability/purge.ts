import { asc, count, Database, eq, inArray, lt } from "../storage/db"
import { ObservabilityEventTable } from "./event.sql"

export type DeleteScope =
  | { scope: "all" }
  | { scope: "workspace"; id: string }
  | { scope: "project"; id: string }
  | { scope: "session"; id: string }

export interface DeleteResult {
  deletedCount: number
}

export interface RetentionConfig {
  retentionDays?: number
  maxEvents?: number
}

export interface RetentionResult {
  deletedCount: number
  deletedExpired: number
  deletedOverLimit: number
}

export const DEFAULT_MAX_EVENTS = 100_000
export const RETENTION_BATCH_SIZE = 1_000
const DAY_MS = 86_400_000

const SCOPE_COLUMN = {
  workspace: ObservabilityEventTable.workspace_id,
  project: ObservabilityEventTable.project_id,
  session: ObservabilityEventTable.session_id,
} as const

export function resolveRetentionConfig(config?: RetentionConfig): Required<Pick<RetentionConfig, "maxEvents">> & Pick<RetentionConfig, "retentionDays"> {
  return {
    retentionDays: config?.retentionDays && config.retentionDays > 0 ? config.retentionDays : undefined,
    maxEvents: config?.maxEvents && config.maxEvents > 0 ? config.maxEvents : DEFAULT_MAX_EVENTS,
  }
}

function changeCount(result: unknown): number {
  if (typeof result !== "object" || result === null || !("changes" in result)) return 0
  const changes = result.changes
  return typeof changes === "number" ? changes : 0
}

function deleteOldest(where: ReturnType<typeof lt> | undefined, limit: number): number {
  const ids = Database.use((db) => {
    const query = db
      .select({ id: ObservabilityEventTable.id })
      .from(ObservabilityEventTable)
      .orderBy(asc(ObservabilityEventTable.ts_ms), asc(ObservabilityEventTable.id))
      .limit(limit)
    return where ? query.where(where).all().map((row) => row.id) : query.all().map((row) => row.id)
  })
  if (!ids.length) return 0
  const result = Database.use((db) => db.delete(ObservabilityEventTable).where(inArray(ObservabilityEventTable.id, ids)).run())
  return changeCount(result)
}

/**
 * Removes at most one bounded batch for each retention rule. Calling this on
 * an interval prevents a large historical cleanup from monopolizing SQLite.
 */
export function purgeByRetention(config?: RetentionConfig, now = Date.now()): RetentionResult {
  const policy = resolveRetentionConfig(config)
  const expiredCutoff = policy.retentionDays === undefined ? undefined : now - policy.retentionDays * DAY_MS
  const deletedExpired = expiredCutoff === undefined ? 0 : deleteOldest(lt(ObservabilityEventTable.ts_ms, expiredCutoff), RETENTION_BATCH_SIZE)
  const total = Database.use((db) => db.select({ value: count() }).from(ObservabilityEventTable).get()?.value ?? 0)
  const deletedOverLimit = total > policy.maxEvents ? deleteOldest(undefined, Math.min(total - policy.maxEvents, RETENTION_BATCH_SIZE)) : 0
  return { deletedCount: deletedExpired + deletedOverLimit, deletedExpired, deletedOverLimit }
}

// Manual/API-triggered deletion (DELETE /observability/data, ADR-1030). The
// automatic session-delete cascade lives in session/projectors.ts instead —
// it runs inside the same transaction as the SessionTable delete, since
// there is no DB foreign key tying observability_event to session (events
// without a sessionId must stay purgeable by project/workspace/retention).
export async function deleteByScope(scope: DeleteScope): Promise<DeleteResult> {
  const result = Database.use((db) => {
    if (scope.scope === "all") return db.delete(ObservabilityEventTable).run()
    return db.delete(ObservabilityEventTable).where(eq(SCOPE_COLUMN[scope.scope], scope.id)).run()
  })
  return { deletedCount: changeCount(result) }
}
