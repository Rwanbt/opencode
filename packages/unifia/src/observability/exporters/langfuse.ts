// Optional Phase 4 exporter (ADR-1026). This is the ONE file in the
// observability module allowed to call fetch() — deliberately isolated in
// this subdirectory (see exporter.ts's header comment for why the existing
// no-network test doesn't need to change to account for it). Never
// constructed unless `experimental.observability.exporters` explicitly lists
// a `langfuse` entry (empty by default).
//
// Targets Langfuse's public Ingestion API (POST /api/public/ingestion,
// Basic auth: public key as username, secret key as password). Langfuse's
// docs mark this endpoint "legacy" in favor of an OpenTelemetry ingestion
// endpoint, but it remains supported and requires no extra SDK dependency,
// which keeps this exporter self-contained.
//
// VERIFIED (2026-07-12) against the raw OpenAPI spec fetched directly from
// https://cloud.langfuse.com/generated/api/openapi.yml (component schemas
// IngestionEvent/BaseEvent/TraceBody/CreateSpanBody/CreateGenerationBody/
// Usage/ObservationLevel) — every field name and the batch envelope shape
// below (id/type/timestamp/body) matches that spec exactly, including the
// deprecated-but-still-accepted flat Usage{input,output,unit} shape and the
// ObservationLevel enum (DEBUG/DEFAULT/WARNING/ERROR).
// STILL UNVERIFIED: never exercised against a live Langfuse instance (no
// credentials available in this environment) — auth acceptance and any
// server-side validation beyond the documented schema remain unconfirmed.
import z from "zod"
import type { Exporter } from "../exporter"
import type { ExportProjection } from "../export-projection"

export const LangfuseExporterConfigSchema = z
  .object({
    type: z.literal("langfuse"),
    host: z.string().url().describe("Langfuse instance base URL, e.g. https://cloud.langfuse.com"),
    publicKey: z.string().min(1),
    secretKey: z.string().min(1),
  })
  .strict()

export type LangfuseExporterConfig = z.infer<typeof LangfuseExporterConfigSchema>

const EXPORT_TIMEOUT_MS = 10_000

function toIso(tsMs: number): string {
  return new Date(tsMs).toISOString()
}

function level(status: ExportProjection["status"]): "DEFAULT" | "WARNING" | "ERROR" {
  if (status === "failed") return "ERROR"
  if (status === "aborted") return "WARNING"
  return "DEFAULT"
}

// Fields exported here are exactly the ExportProjection fields (HMACs,
// enums, counts) — no free text. metadata carries the HMACs Langfuse has no
// dedicated field for; nothing here is reversible to the original value.
function observationMetadata(projection: ExportProjection): Record<string, unknown> {
  return {
    redactionStatus: projection.redactionStatus,
    redactedClasses: projection.redactedClasses,
    sessionIdHmac: projection.sessionIdHmac,
    projectIdHmac: projection.projectIdHmac,
    workspaceIdHmac: projection.workspaceIdHmac,
    toolKind: projection.toolKind,
    toolNameHmac: projection.toolNameHmac,
    skillHmac: projection.skillHmac,
    pathHmac: projection.pathHmac,
    mcpHmac: projection.mcpHmac,
    agentName: projection.agentName,
    errorKind: projection.errorKind,
    errorCode: projection.errorCode,
    errorMessageHmac: projection.errorMessageHmac,
    pricingVersion: projection.pricingVersion,
    pricingSource: projection.pricingSource,
  }
}

function toBatchEvents(projection: ExportProjection): unknown[] {
  const startTime = toIso(projection.tsMs - (projection.durationMs ?? 0))
  const endTime = toIso(projection.tsMs)
  const isLlmSpan = projection.type.startsWith("llm.")

  const traceEvent = {
    id: `trace-${projection.traceId}`,
    type: "trace-create",
    timestamp: endTime,
    body: {
      id: projection.traceId,
      name: "opencode.trace",
      timestamp: startTime,
    },
  }

  const observationBody: Record<string, unknown> = {
    id: projection.eventId,
    traceId: projection.traceId,
    parentObservationId: projection.parentSpanId,
    name: projection.type,
    startTime,
    endTime,
    level: level(projection.status),
    statusMessage: projection.errorKind,
    metadata: observationMetadata(projection),
  }

  if (isLlmSpan) {
    observationBody.model = projection.modelId
    observationBody.usage = {
      input: projection.inputTokens,
      output: projection.outputTokens,
      unit: "TOKENS",
    }
    if (projection.costNanoUsd !== undefined) {
      observationBody.costDetails = { total: projection.costNanoUsd / 1_000_000_000 }
    }
  }

  const observationEvent = {
    id: `${isLlmSpan ? "generation" : "span"}-${projection.eventId}`,
    type: isLlmSpan ? "generation-create" : "span-create",
    timestamp: endTime,
    body: observationBody,
  }

  return [traceEvent, observationEvent]
}

export class LangfuseExporter implements Exporter {
  readonly name = "langfuse"

  constructor(private readonly config: LangfuseExporterConfig) {}

  async export(batch: ExportProjection[]): Promise<void> {
    if (!batch.length) return
    const seenTraces = new Set<string>()
    const events: unknown[] = []
    for (const projection of batch) {
      const [traceEvent, observationEvent] = toBatchEvents(projection)
      if (!seenTraces.has(projection.traceId)) {
        seenTraces.add(projection.traceId)
        events.push(traceEvent)
      }
      events.push(observationEvent)
    }

    const auth = Buffer.from(`${this.config.publicKey}:${this.config.secretKey}`).toString("base64")
    const response = await fetch(new URL("/api/public/ingestion", this.config.host), {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Basic ${auth}`,
      },
      body: JSON.stringify({ batch: events, metadata: null }),
      signal: AbortSignal.timeout(EXPORT_TIMEOUT_MS),
    })
    if (!response.ok) {
      throw new Error(`langfuse ingestion failed: HTTP ${response.status}`)
    }
  }
}
