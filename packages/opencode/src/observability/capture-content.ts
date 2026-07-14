// Phase 3 opt-in content capture (ADR-1032, plan §12/§16/§18 Phase 3).
//
// This module ONLY resolves whether content capture is currently allowed for
// a given scope, and manages the opt-in rows themselves. It never touches
// event content — that stays in sanitizer.ts (captureContent()), which is
// the sole place raw prompt/response/tool text is bounded/redacted before
// being written. Kept as two files on purpose: this one is a plain CRUD +
// expiry read, sanitizer.ts is the only place with content-shaping logic.
import z from "zod"
import { Database, eq, and, lt } from "../storage/db"
import { ObservabilityContentOptInTable } from "./content-optin.sql"
import { captureContent } from "./sanitizer"

export const ContentCaptureLevelSchema = z.enum(["local_content_redacted", "local_full"])
export type ContentCaptureLevel = z.infer<typeof ContentCaptureLevelSchema>

export const OptInScopeSchema = z.enum(["workspace", "project", "session", "all"])
export type OptInScope = z.infer<typeof OptInScopeSchema>

// Stable local identifier for the explicit all-projects opt-in. It is not a
// project identifier and is never resolved against a remote or current project.
export const ALL_PROJECTS_SCOPE_ID = "local"

const DAY_MS = 86_400_000
export const MAX_TTL_DAYS = 30

export interface ContentOptIn {
  scope: OptInScope
  scopeId: string
  level: ContentCaptureLevel
  ttlDays: number
  createdAtMs: number
  expiresAtMs: number
}

type OptInRow = typeof ObservabilityContentOptInTable.$inferSelect

function toOptIn(row: OptInRow): ContentOptIn {
  return {
    scope: row.scope as OptInScope,
    scopeId: row.scope_id,
    level: row.level as ContentCaptureLevel,
    ttlDays: row.ttl_days,
    createdAtMs: row.created_at_ms,
    expiresAtMs: row.expires_at_ms,
  }
}

// Sets (or overwrites) the opt-in for one scope entity. Re-opting-in always
// replaces the previous level/TTL rather than stacking — there is exactly
// one active opt-in per (scope, scopeId) by unique index.
export function setOptIn(input: { scope: OptInScope; scopeId: string; level: ContentCaptureLevel; ttlDays: number }, now = Date.now()): ContentOptIn {
  const ttlDays = Math.min(Math.max(1, Math.trunc(input.ttlDays)), MAX_TTL_DAYS)
  const row = {
    scope: input.scope,
    scope_id: input.scopeId,
    level: input.level,
    ttl_days: ttlDays,
    created_at_ms: now,
    expires_at_ms: now + ttlDays * DAY_MS,
  }
  Database.use((db) =>
    db
      .insert(ObservabilityContentOptInTable)
      .values(row)
      .onConflictDoUpdate({
        target: [ObservabilityContentOptInTable.scope, ObservabilityContentOptInTable.scope_id],
        set: { level: row.level, ttl_days: row.ttl_days, created_at_ms: row.created_at_ms, expires_at_ms: row.expires_at_ms },
      })
      .run(),
  )
  return toOptIn(row as unknown as OptInRow)
}

// Immediate revoke: deletes the opt-in row so resolveContentCaptureLevel()
// stops granting capture on the very next call (no cache, no grace period).
// Callers are responsible for also purging already-captured content
// (purge.ts's purgeContentForScope) — this function only stops future writes.
export function revokeOptIn(scope: OptInScope, scopeId: string): void {
  Database.use((db) =>
    db.delete(ObservabilityContentOptInTable).where(and(eq(ObservabilityContentOptInTable.scope, scope), eq(ObservabilityContentOptInTable.scope_id, scopeId))).run(),
  )
}

export function getOptIn(scope: OptInScope, scopeId: string, now = Date.now()): ContentOptIn | undefined {
  const row = Database.use((db) =>
    db.select().from(ObservabilityContentOptInTable).where(and(eq(ObservabilityContentOptInTable.scope, scope), eq(ObservabilityContentOptInTable.scope_id, scopeId))).get(),
  )
  if (!row || row.expires_at_ms <= now) return undefined
  return toOptIn(row)
}

// Resolves the effective capture level for an event's trace context.
// Checked session -> project -> workspace, most specific wins, so opting in
// a single session doesn't silently widen to the whole project. Expiry is
// evaluated on every call (plan invariant 7: "aucun cache ne peut prolonger
// local_full après expires_at") — never memoized across calls.
export function resolveContentCaptureLevel(
  scopeIds: { sessionId?: string; projectId?: string; workspaceId?: string },
  now = Date.now(),
): ContentOptIn | undefined {
  if (scopeIds.sessionId) {
    const found = getOptIn("session", scopeIds.sessionId, now)
    if (found) return found
  }
  if (scopeIds.projectId) {
    const found = getOptIn("project", scopeIds.projectId, now)
    if (found) return found
  }
  if (scopeIds.workspaceId) {
    const found = getOptIn("workspace", scopeIds.workspaceId, now)
    if (found) return found
  }
  const allProjects = getOptIn("all", ALL_PROJECTS_SCOPE_ID, now)
  if (allProjects) return allProjects
  return undefined
}

// Attaches localContentRedacted/localFull to an observability record() patch
// when a non-expired opt-in covers the event's scope. No-op (returns the
// patch unchanged) when optIn is undefined or text is empty — the normal,
// opted-out path, which every started/finished/failed event goes through
// regardless of whether Phase 3 opt-in is configured anywhere.
export function withContentCapture<T extends { metadata?: Record<string, unknown> }>(
  patch: T,
  optIn: ContentOptIn | undefined,
  text: string,
): T & { localContentRedacted?: string; localFull?: string; contentExpiresAtMs?: number } {
  if (!optIn || !text) return patch
  const result = captureContent({ text, level: optIn.level })
  if (result.content === undefined) return patch
  return {
    ...patch,
    localContentRedacted: optIn.level === "local_content_redacted" ? result.content : undefined,
    localFull: optIn.level === "local_full" ? result.content : undefined,
    contentExpiresAtMs: optIn.expiresAtMs,
  }
}

function changeCount(result: unknown): number {
  if (typeof result !== "object" || result === null || !("changes" in result)) return 0
  const changes = result.changes
  return typeof changes === "number" ? changes : 0
}

// Deletes every opt-in row past expiry. Run on a timer (runtime.ts) and once
// at boot — expired rows are otherwise inert (getOptIn already filters them)
// but left forever would grow the table unboundedly.
export function purgeExpiredOptIns(now = Date.now()): number {
  const result = Database.use((db) => db.delete(ObservabilityContentOptInTable).where(lt(ObservabilityContentOptInTable.expires_at_ms, now)).run())
  return changeCount(result)
}
