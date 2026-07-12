// Phase 4 exporter boundary (ADR-1026, plan §17). This is the ONLY shape an
// Exporter (observability/exporter.ts) is ever allowed to receive — never a
// raw EventRow/ObservabilityEvent. No content field exists here at all: even
// Phase 3 opt-in content (local_content_redacted/local_full, ADR-1032) never
// crosses this boundary, since that opt-in only covers local storage, not
// network export to a third party.
import z from "zod"
import { hmacSha256 } from "./hmac"

const Hmac = z.string().regex(/^[0-9a-f]{64}$/)
const OptionalHmac = Hmac.optional()
const OptionalSmallString = z.string().min(1).max(128).optional()
const OptionalNonNegativeInteger = z.number().int().nonnegative().optional()

export const ExportProjectionSchema = z
  .object({
    eventId: z.string(),
    traceId: z.string(),
    spanId: z.string(),
    parentSpanId: z.string().optional(),
    sessionIdHmac: OptionalHmac,
    projectIdHmac: OptionalHmac,
    workspaceIdHmac: OptionalHmac,
    type: z.string(),
    status: z.enum(["started", "finished", "failed", "aborted", "dropped"]),
    tsMs: z.number().int().nonnegative(),
    durationMs: OptionalNonNegativeInteger,
    modelProvider: OptionalSmallString,
    modelId: OptionalSmallString,
    inputTokens: OptionalNonNegativeInteger,
    outputTokens: OptionalNonNegativeInteger,
    cacheReadTokens: OptionalNonNegativeInteger,
    cacheWriteTokens: OptionalNonNegativeInteger,
    costNanoUsd: OptionalNonNegativeInteger,
    pricingVersion: OptionalSmallString,
    pricingSource: OptionalSmallString,
    redactionStatus: z.enum(["metadata_only", "redacted", "failed_closed"]),
    errorKind: OptionalSmallString,
    errorCode: OptionalSmallString,
    errorMessageHmac: OptionalHmac,
    toolKind: OptionalSmallString,
    toolNameHmac: OptionalHmac,
    skillHmac: OptionalHmac,
    pathHmac: OptionalHmac,
    mcpHmac: OptionalHmac,
    agentName: OptionalSmallString,
    redactedClasses: z.array(z.string()).max(16).default([]),
  })
  .strict()

export type ExportProjection = z.infer<typeof ExportProjectionSchema>

// Minimal shape this module needs from a repository row — kept structural
// (not `typeof ObservabilityEventTable.$inferSelect`) so this file has no
// import-time dependency on the Drizzle table definition, only on the field
// names it actually reads.
export interface ExportableEventRow {
  event_id: string
  trace_id: string
  span_id: string
  parent_span_id: string | null
  session_id: string | null
  project_id: string | null
  workspace_id: string | null
  event_type: string
  status: string
  ts_ms: number
  duration_ms: number | null
  model_provider: string | null
  model_id: string | null
  input_tokens: number | null
  output_tokens: number | null
  cache_read_tokens: number | null
  cache_write_tokens: number | null
  cost_nano_usd: number | null
  pricing_version: string | null
  pricing_source: string | null
  redaction_status: string
  metadata_json: unknown
  local_redacted_json: unknown
}

// A "started" event with no terminal counterpart yet is not a complete span
// (no duration, no cost, no outcome) — exporting it would show an
// incomplete/misleading entry in an external dashboard, so it waits for its
// terminal event. "dropped" is an internal bookkeeping signal
// (observability.write.dropped), never a real operation, and never exported.
export function shouldExportSpan(row: Pick<ExportableEventRow, "status">): boolean {
  return row.status !== "started" && row.status !== "dropped"
}

function nullToUndefined<T>(value: T | null): T | undefined {
  return value === null ? undefined : value
}

// The only function allowed to construct an ExportProjection. Internal
// correlation ids (session/project/workspace) are HMACed here — even though
// the local DB stores them in clear for authenticated local reads (ADR-1028)
// — because a third-party network exporter must never receive an id reusable
// to correlate with other local data (ADR-1026).
export function toExportProjection(row: ExportableEventRow, secret: Uint8Array): ExportProjection {
  const metadata = (row.metadata_json ?? {}) as Record<string, unknown>
  const redacted = (row.local_redacted_json ?? {}) as { classes?: string[]; errorMessageHmac?: string }
  return ExportProjectionSchema.parse({
    eventId: row.event_id,
    traceId: row.trace_id,
    spanId: row.span_id,
    parentSpanId: nullToUndefined(row.parent_span_id),
    sessionIdHmac: row.session_id ? hmacSha256(secret, row.session_id) : undefined,
    projectIdHmac: row.project_id ? hmacSha256(secret, row.project_id) : undefined,
    workspaceIdHmac: row.workspace_id ? hmacSha256(secret, row.workspace_id) : undefined,
    type: row.event_type,
    status: row.status,
    tsMs: row.ts_ms,
    durationMs: nullToUndefined(row.duration_ms),
    modelProvider: nullToUndefined(row.model_provider),
    modelId: nullToUndefined(row.model_id),
    inputTokens: nullToUndefined(row.input_tokens),
    outputTokens: nullToUndefined(row.output_tokens),
    cacheReadTokens: nullToUndefined(row.cache_read_tokens),
    cacheWriteTokens: nullToUndefined(row.cache_write_tokens),
    costNanoUsd: nullToUndefined(row.cost_nano_usd),
    pricingVersion: nullToUndefined(row.pricing_version),
    pricingSource: nullToUndefined(row.pricing_source),
    redactionStatus: row.redaction_status,
    errorKind: typeof metadata.errorKind === "string" ? metadata.errorKind : undefined,
    errorCode: typeof metadata.errorCode === "string" ? metadata.errorCode : undefined,
    errorMessageHmac: redacted.errorMessageHmac,
    toolKind: typeof metadata.toolKind === "string" ? metadata.toolKind : undefined,
    toolNameHmac: typeof metadata.toolNameHmac === "string" ? metadata.toolNameHmac : undefined,
    skillHmac: typeof metadata.skillHmac === "string" ? metadata.skillHmac : undefined,
    pathHmac: typeof metadata.pathHmac === "string" ? metadata.pathHmac : undefined,
    mcpHmac: typeof metadata.mcpHmac === "string" ? metadata.mcpHmac : undefined,
    agentName: typeof metadata.agentName === "string" ? metadata.agentName : undefined,
    redactedClasses: Array.isArray(redacted.classes) ? redacted.classes : [],
  })
}
