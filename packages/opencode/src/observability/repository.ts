import { Database } from "../storage/db"
import { ObservabilityEventTable } from "./event.sql"
import type { ObservabilityEvent } from "./event-schema"
import type { ObservabilityWriter } from "./service"

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

export const ObservabilityRepository: ObservabilityWriter = {
  async insert(events) {
    if (!events.length) return
    Database.use((db) => db.insert(ObservabilityEventTable).values(events.map(row)).run())
  },
}
