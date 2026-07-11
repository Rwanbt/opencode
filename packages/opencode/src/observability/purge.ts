import { Database, eq } from "../storage/db"
import { ObservabilityEventTable } from "./event.sql"

export type DeleteScope =
  | { scope: "all" }
  | { scope: "workspace"; id: string }
  | { scope: "project"; id: string }
  | { scope: "session"; id: string }

export interface DeleteResult {
  deletedCount: number
}

const SCOPE_COLUMN = {
  workspace: ObservabilityEventTable.workspace_id,
  project: ObservabilityEventTable.project_id,
  session: ObservabilityEventTable.session_id,
} as const

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
  // better-sqlite3/bun:sqlite return { changes } on `.run()`. Tolerate undefined.
  return { deletedCount: (result as any)?.changes ?? 0 }
}
