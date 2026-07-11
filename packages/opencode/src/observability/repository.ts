import { Database, and, desc, eq, gt, lt, or, sql } from "../storage/db"
import { ObservabilityEventTable } from "./event.sql"
import type { ObservabilityEvent } from "./event-schema"

type EventRow = typeof ObservabilityEventTable.$inferSelect

type PageCursor = { tsMs: number; id: number }

// Opaque base64url cursor, same shape/pattern as MessageV2.cursor
// (session/message-v2.ts) — kept local since it encodes ObservabilityEventTable's
// own keyset columns (ts_ms, id), not the message table's.
export const cursor = {
  encode(input: PageCursor) {
    return Buffer.from(JSON.stringify(input)).toString("base64url")
  },
  decode(input: string): PageCursor {
    const parsed = JSON.parse(Buffer.from(input, "base64url").toString("utf8"))
    if (typeof parsed?.tsMs !== "number" || typeof parsed?.id !== "number") throw new Error("Invalid cursor")
    return parsed
  },
}

const older = (row: PageCursor) =>
  or(
    lt(ObservabilityEventTable.ts_ms, row.tsMs),
    and(eq(ObservabilityEventTable.ts_ms, row.tsMs), lt(ObservabilityEventTable.id, row.id)),
  )

function row(event: ObservabilityEvent) {
  return {
    event_id: event.eventId!, trace_id: event.context.traceId, span_id: event.context.spanId,
    parent_span_id: event.context.parentSpanId, session_id: event.context.sessionId,
    project_id: event.context.projectId, workspace_id: event.context.workspaceId,
    message_id: event.context.messageId, turn_id: event.context.turnId, step_index: event.context.stepIndex,
    event_type: event.type, status: event.status, ts_ms: event.tsMs, duration_ms: event.durationMs,
    enqueue_seq: event.enqueueSeq, model_provider: event.metadata.modelProvider, model_id: event.metadata.modelId,
    input_tokens: event.metadata.inputTokens, output_tokens: event.metadata.outputTokens,
    cache_read_tokens: event.metadata.cacheReadTokens, cache_write_tokens: event.metadata.cacheWriteTokens,
    cost_nano_usd: event.costNanoUsd, pricing_version: event.pricingVersion, pricing_source: event.pricingSource,
    cost_computed_at_ms: event.costComputedAtMs, redaction_status: event.redactionStatus,
    original_size_bytes: event.originalSizeBytes, payload_truncated: event.payloadTruncated,
    metadata_json: event.metadata, local_redacted_json: event.localRedacted, schema_version: event.schemaVersion,
  }
}

export const ObservabilityRepository = {
  async insert(events: ObservabilityEvent[]) {
    if (!events.length) return
    Database.use((db) => db.insert(ObservabilityEventTable).values(events.map(row)).run())
  },

  // Keyset page over a single session's events, newest first — same pattern
  // as MessageV2.page (session/message-v2.ts:822-857). Callers are
  // responsible for verifying the session belongs to the requesting scope
  // BEFORE calling this (ADR-1028: ownership via the real session→project
  // relation, not a raw scope value) — this function trusts sessionId as-is.
  page(input: { sessionId: string; limit: number; before?: string }): { items: EventRow[]; more: boolean; cursor?: string } {
    const before = input.before ? cursor.decode(input.before) : undefined
    const where = before
      ? and(eq(ObservabilityEventTable.session_id, input.sessionId), older(before))
      : eq(ObservabilityEventTable.session_id, input.sessionId)
    const rows = Database.use((db) =>
      db
        .select()
        .from(ObservabilityEventTable)
        .where(where)
        .orderBy(desc(ObservabilityEventTable.ts_ms), desc(ObservabilityEventTable.id))
        .limit(input.limit + 1)
        .all(),
    )
    const more = rows.length > input.limit
    const items = more ? rows.slice(0, input.limit) : rows
    const tail = items.at(-1)
    return {
      items,
      more,
      cursor: more && tail ? cursor.encode({ tsMs: tail.ts_ms, id: tail.id }) : undefined,
    }
  },

  getByEventId(eventId: string): EventRow | undefined {
    return Database.use((db) =>
      db.select().from(ObservabilityEventTable).where(eq(ObservabilityEventTable.event_id, eventId)).get(),
    )
  },

  // In-process aggregation over one session's rows rather than a SQL
  // GROUP BY — a single session's observability events are bounded by
  // conversation length, so this stays cheap without depending on an
  // unverified count()/sum() Drizzle call shape (none existed elsewhere in
  // this codebase to copy from).
  summary(sessionId: string): {
    totalEvents: number
    totalCostNanoUsd: number
    byType: Record<string, number>
    byStatus: Record<string, number>
    firstEventTsMs?: number
    lastEventTsMs?: number
  } {
    const rows = Database.use((db) =>
      db
        .select({
          eventType: ObservabilityEventTable.event_type,
          status: ObservabilityEventTable.status,
          tsMs: ObservabilityEventTable.ts_ms,
          costNanoUsd: ObservabilityEventTable.cost_nano_usd,
        })
        .from(ObservabilityEventTable)
        .where(eq(ObservabilityEventTable.session_id, sessionId))
        .all(),
    )

    const byType: Record<string, number> = {}
    const byStatus: Record<string, number> = {}
    let totalCostNanoUsd = 0
    let firstEventTsMs: number | undefined
    let lastEventTsMs: number | undefined
    for (const r of rows) {
      byType[r.eventType] = (byType[r.eventType] ?? 0) + 1
      byStatus[r.status] = (byStatus[r.status] ?? 0) + 1
      if (r.costNanoUsd) totalCostNanoUsd += r.costNanoUsd
      if (firstEventTsMs === undefined || r.tsMs < firstEventTsMs) firstEventTsMs = r.tsMs
      if (lastEventTsMs === undefined || r.tsMs > lastEventTsMs) lastEventTsMs = r.tsMs
    }

    return { totalEvents: rows.length, totalCostNanoUsd, byType, byStatus, firstEventTsMs, lastEventTsMs }
  },

  /**
   * Cohort comparison for Phase 2 UI.
   * Groups by (model_provider, model_id, skillHmac) and computes:
   * - p50/p95 latency (from llm.call.finished/failed/aborted duration_ms)
   * - cost per turn (sum of cost_nano_usd for llm events / count of distinct trace_id)
   * - failure rate (failed events / total events for the cohort)
   */
  compareCohorts(params: {
    workspaceId?: string
    projectId?: string
    sinceMs?: number
    untilMs?: number
  } = {}): CohortComparisonResult[] {
    const { workspaceId, projectId, sinceMs, untilMs } = params

    // First, get all finished LLM events with their metadata
    const whereConditions = [
      eq(ObservabilityEventTable.event_type, "llm.call.finished"),
      eq(ObservabilityEventTable.status, "finished"),
    ]
    if (workspaceId) whereConditions.push(eq(ObservabilityEventTable.workspace_id, workspaceId))
    if (projectId) whereConditions.push(eq(ObservabilityEventTable.project_id, projectId))
    if (sinceMs) whereConditions.push(gt(ObservabilityEventTable.ts_ms, sinceMs))
    if (untilMs) whereConditions.push(lt(ObservabilityEventTable.ts_ms, untilMs))

    const rows = Database.use((db) =>
      db
        .select({
          modelProvider: ObservabilityEventTable.model_provider,
          modelId: ObservabilityEventTable.model_id,
          durationMs: ObservabilityEventTable.duration_ms,
          costNanoUsd: ObservabilityEventTable.cost_nano_usd,
          traceId: ObservabilityEventTable.trace_id,
          metadataJson: ObservabilityEventTable.metadata_json,
        })
        .from(ObservabilityEventTable)
        .where(and(...whereConditions))
        .all(),
    )

    // Group by cohort: (modelProvider, modelId, skillHmac)
    const cohorts = new Map<string, {
      modelProvider: string | null
      modelId: string | null
      skillHmac: string | null
      durations: number[]
      costs: number[]
      traceIds: Set<string>
      totalEvents: number
      failedEvents: number
    }>()

    // Also need failed/aborted events for failure rate
    const failedWhere = [
      or(
        eq(ObservabilityEventTable.event_type, "llm.call.failed"),
        eq(ObservabilityEventTable.event_type, "llm.call.aborted"),
      ),
      eq(ObservabilityEventTable.status, "failed"),
    ]
    if (workspaceId) failedWhere.push(eq(ObservabilityEventTable.workspace_id, workspaceId))
    if (projectId) failedWhere.push(eq(ObservabilityEventTable.project_id, projectId))
    if (sinceMs) failedWhere.push(gt(ObservabilityEventTable.ts_ms, sinceMs))
    if (untilMs) failedWhere.push(lt(ObservabilityEventTable.ts_ms, untilMs))

    const failedRows = Database.use((db) =>
      db
        .select({
          modelProvider: ObservabilityEventTable.model_provider,
          modelId: ObservabilityEventTable.model_id,
          metadataJson: ObservabilityEventTable.metadata_json,
        })
        .from(ObservabilityEventTable)
        .where(and(...failedWhere))
        .all(),
    )

    for (const r of rows) {
      const meta = r.metadataJson as Record<string, unknown> | null
      const skillHmac = (meta?.skillHmac as string) ?? null
      const key = `${r.modelProvider ?? "unknown"}|${r.modelId ?? "unknown"}|${skillHmac ?? "none"}`

      let cohort = cohorts.get(key)
      if (!cohort) {
        cohort = {
          modelProvider: r.modelProvider,
          modelId: r.modelId,
          skillHmac,
          durations: [],
          costs: [],
          traceIds: new Set(),
          totalEvents: 0,
          failedEvents: 0,
        }
        cohorts.set(key, cohort)
      }
      if (r.durationMs !== null && r.durationMs !== undefined) cohort.durations.push(r.durationMs)
      if (r.costNanoUsd !== null && r.costNanoUsd !== undefined) cohort.costs.push(r.costNanoUsd)
      if (r.traceId) cohort.traceIds.add(r.traceId)
      cohort.totalEvents++
    }

    for (const r of failedRows) {
      const meta = r.metadataJson as Record<string, unknown> | null
      const skillHmac = (meta?.skillHmac as string) ?? null
      const key = `${r.modelProvider ?? "unknown"}|${r.modelId ?? "unknown"}|${skillHmac ?? "none"}`

      let cohort = cohorts.get(key)
      if (!cohort) {
        cohort = {
          modelProvider: r.modelProvider,
          modelId: r.modelId,
          skillHmac,
          durations: [],
          costs: [],
          traceIds: new Set(),
          totalEvents: 0,
          failedEvents: 0,
        }
        cohorts.set(key, cohort)
      }
      cohort.totalEvents++
      cohort.failedEvents++
    }

    // Compute percentiles and aggregates
    const results: CohortComparisonResult[] = []
    for (const [, cohort] of cohorts) {
      const sortedDurations = cohort.durations.sort((a, b) => a - b)
      const p50 = percentile(sortedDurations, 50)
      const p95 = percentile(sortedDurations, 95)
      const totalCost = cohort.costs.reduce((a, b) => a + b, 0)
      const costPerTurn = cohort.traceIds.size > 0 ? totalCost / cohort.traceIds.size : 0
      const failureRate = cohort.totalEvents > 0 ? (cohort.failedEvents / cohort.totalEvents) * 100 : 0

      results.push({
        modelProvider: cohort.modelProvider,
        modelId: cohort.modelId,
        skillHmac: cohort.skillHmac,
        latencyP50Ms: p50,
        latencyP95Ms: p95,
        costPerTurnNanoUsd: costPerTurn,
        failureRatePct: failureRate,
        totalEvents: cohort.totalEvents,
        traceCount: cohort.traceIds.size,
      })
    }

    // Sort by total events descending (most used first)
    results.sort((a, b) => b.totalEvents - a.totalEvents)
    return results
  },
}

function percentile(sorted: number[], p: number): number {
  if (!sorted.length) return 0
  const index = Math.ceil(p / 100 * sorted.length) - 1
  return sorted[Math.max(0, index)]
}

export interface CohortComparisonResult {
  modelProvider: string | null
  modelId: string | null
  skillHmac: string | null
  latencyP50Ms: number
  latencyP95Ms: number
  costPerTurnNanoUsd: number
  failureRatePct: number
  totalEvents: number
  traceCount: number
}

/**
 * Export events as NDJSON (newline-delimited JSON) for local backup/analysis.
 * Streams all events matching the criteria, ordered by ts_ms ASC.
 */
export async function* exportEvents(params: {
  sessionId?: string
  projectId?: string
  workspaceId?: string
  sinceMs?: number
  untilMs?: number
  limit?: number
}): AsyncGenerator<string> {
  const { sessionId, projectId, workspaceId, sinceMs, untilMs, limit } = params

  const whereConditions = []
  if (sessionId) whereConditions.push(eq(ObservabilityEventTable.session_id, sessionId))
  if (projectId) whereConditions.push(eq(ObservabilityEventTable.project_id, projectId))
  if (workspaceId) whereConditions.push(eq(ObservabilityEventTable.workspace_id, workspaceId))
  if (sinceMs) whereConditions.push(gt(ObservabilityEventTable.ts_ms, sinceMs))
  if (untilMs) whereConditions.push(lt(ObservabilityEventTable.ts_ms, untilMs))

  const where = whereConditions.length > 0 ? and(...whereConditions) : undefined

  let count = 0
  const batchSize = 1000
  let cursor: { tsMs: number; id: number } | undefined

  while (true) {
    const rows = Database.use((db) =>
      db
        .select()
        .from(ObservabilityEventTable)
        .where(
          where
            ? and(where, cursor ? or(gt(ObservabilityEventTable.ts_ms, cursor.tsMs), and(eq(ObservabilityEventTable.ts_ms, cursor.tsMs), gt(ObservabilityEventTable.id, cursor.id))) : undefined)
            : cursor ? or(gt(ObservabilityEventTable.ts_ms, cursor.tsMs), and(eq(ObservabilityEventTable.ts_ms, cursor.tsMs), gt(ObservabilityEventTable.id, cursor.id))) : undefined,
        )
        .orderBy(ObservabilityEventTable.ts_ms, ObservabilityEventTable.id)
        .limit(batchSize)
        .all(),
    )

    if (!rows.length) break

    for (const row of rows) {
      if (limit && count >= limit) return
      count++
      yield JSON.stringify(toDto(row)) + "\n"
    }

    const last = rows[rows.length - 1]
    cursor = { tsMs: last.ts_ms, id: last.id }
  }
}

// snake_case DB row -> camelCase public DTO, field names matched to
// ObservabilityEvent (event-schema.ts) so the API vocabulary stays
// consistent with the rest of the module. Safe to expose as-is: the schema
// forbids readable content at the DB level (Phase 1), so nothing here needs
// further redaction on the way out.
export function toDto(row: EventRow) {
  return {
    eventId: row.event_id,
    traceId: row.trace_id,
    spanId: row.span_id,
    parentSpanId: row.parent_span_id ?? undefined,
    sessionId: row.session_id ?? undefined,
    projectId: row.project_id ?? undefined,
    workspaceId: row.workspace_id ?? undefined,
    messageId: row.message_id ?? undefined,
    turnId: row.turn_id ?? undefined,
    stepIndex: row.step_index ?? undefined,
    type: row.event_type,
    status: row.status,
    tsMs: row.ts_ms,
    durationMs: row.duration_ms ?? undefined,
    costNanoUsd: row.cost_nano_usd ?? undefined,
    pricingVersion: row.pricing_version ?? undefined,
    pricingSource: row.pricing_source ?? undefined,
    costComputedAtMs: row.cost_computed_at_ms ?? undefined,
    redactionStatus: row.redaction_status,
    originalSizeBytes: row.original_size_bytes ?? undefined,
    payloadTruncated: row.payload_truncated,
    metadata: row.metadata_json,
    localRedacted: row.local_redacted_json,
    schemaVersion: row.schema_version,
  }
}

/**
 * Aggregate summary across sessions/projects/workspaces.
 * Returns total events, cost, and breakdown by type/status.
 */
export function summaryAll(params: {
  workspaceId?: string
  projectId?: string
  sessionId?: string
  sinceMs?: number
  untilMs?: number
} = {}): {
  totalEvents: number
  totalCostNanoUsd: number
  byType: Record<string, number>
  byStatus: Record<string, number>
  firstEventTsMs?: number
  lastEventTsMs?: number
} {
  const { workspaceId, projectId, sessionId, sinceMs, untilMs } = params

  const whereConditions = []
  if (sessionId) whereConditions.push(eq(ObservabilityEventTable.session_id, sessionId))
  if (projectId) whereConditions.push(eq(ObservabilityEventTable.project_id, projectId))
  if (workspaceId) whereConditions.push(eq(ObservabilityEventTable.workspace_id, workspaceId))
  if (sinceMs) whereConditions.push(gt(ObservabilityEventTable.ts_ms, sinceMs))
  if (untilMs) whereConditions.push(lt(ObservabilityEventTable.ts_ms, untilMs))

  const where = whereConditions.length > 0 ? and(...whereConditions) : undefined

  const rows = Database.use((db) =>
    db
      .select({
        eventType: ObservabilityEventTable.event_type,
        status: ObservabilityEventTable.status,
        tsMs: ObservabilityEventTable.ts_ms,
        costNanoUsd: ObservabilityEventTable.cost_nano_usd,
      })
      .from(ObservabilityEventTable)
      .where(where)
      .all(),
  )

  const byType: Record<string, number> = {}
  const byStatus: Record<string, number> = {}
  let totalCostNanoUsd = 0
  let firstEventTsMs: number | undefined
  let lastEventTsMs: number | undefined

  for (const r of rows) {
    byType[r.eventType] = (byType[r.eventType] ?? 0) + 1
    byStatus[r.status] = (byStatus[r.status] ?? 0) + 1
    if (r.costNanoUsd) totalCostNanoUsd += r.costNanoUsd
    if (firstEventTsMs === undefined || r.tsMs < firstEventTsMs) firstEventTsMs = r.tsMs
    if (lastEventTsMs === undefined || r.tsMs > lastEventTsMs) lastEventTsMs = r.tsMs
  }

  return { totalEvents: rows.length, totalCostNanoUsd, byType, byStatus, firstEventTsMs, lastEventTsMs }
}
