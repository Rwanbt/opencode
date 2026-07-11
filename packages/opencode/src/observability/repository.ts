import { Database, and, desc, eq, lt, or } from "../storage/db"
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
