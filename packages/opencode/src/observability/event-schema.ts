import z from "zod"
import { ObservabilityId } from "./id"
import { TraceContextSchema } from "./trace-context"

const OptionalNonNegativeInteger = z.number().int().nonnegative().optional()
const OptionalSmallString = z.string().min(1).max(128).optional()
const Hmac = z.string().regex(/^[0-9a-f]{64}$/)

export const EventTypeSchema = z.enum([
  "llm.call.started",
  "llm.call.finished",
  "llm.call.failed",
  "llm.call.aborted",
  "tool.call.started",
  "tool.call.finished",
  "tool.call.failed",
  "tool.call.aborted",
  "agent.call.started",
  "agent.call.finished",
  "agent.call.failed",
  "agent.call.aborted",
  "observability.write.dropped",
])

export const EventStatusSchema = z.enum(["started", "finished", "failed", "aborted", "dropped"])
export const RedactionStatusSchema = z.enum(["metadata_only", "redacted", "failed_closed"])

export const MetadataSchema = z.object({
  modelProvider: OptionalSmallString,
  modelId: OptionalSmallString,
  inputTokens: OptionalNonNegativeInteger,
  outputTokens: OptionalNonNegativeInteger,
  cacheReadTokens: OptionalNonNegativeInteger,
  cacheWriteTokens: OptionalNonNegativeInteger,
  errorKind: OptionalSmallString,
  errorCode: OptionalSmallString,
  errorTemplateId: OptionalSmallString,
  toolKind: OptionalSmallString,
  toolNameHmac: Hmac.optional(),
  skillHmac: Hmac.optional(),
  pathHmac: Hmac.optional(),
  mcpHmac: Hmac.optional(),
  outputFileKind: OptionalSmallString,
  outputMime: OptionalSmallString,
  agentName: OptionalSmallString,
}).strict()

export const RedactedClassSchema = z.enum(["secret", "path", "email", "username", "binary"])
export type RedactedClass = z.infer<typeof RedactedClassSchema>

const RedactedSchema = z.object({
  classes: z.array(RedactedClassSchema).max(16).default([]),
  contentFingerprintHmac: Hmac.optional(),
  errorMessageHmac: Hmac.optional(),
}).strict()

// Phase 3 opt-in content (ADR-1032) — bounded by sanitizer.ts's
// captureContent() (32 KiB) before ever reaching this schema. Both fields
// are absent unless a non-expired opt-in was active at capture time
// (capture-content.ts). Never set together: one event carries at most the
// single level its scope was opted into when captured.
const MAX_CONTENT_CHARS = 32 * 1024
const OptionalContent = z.string().max(MAX_CONTENT_CHARS).optional()

export const ObservabilityEventSchema = z.object({
  eventId: z.string().refine(ObservabilityId.isValid, "Expected eventId ULID").optional(),
  context: TraceContextSchema,
  type: EventTypeSchema,
  status: EventStatusSchema,
  tsMs: z.number().int().nonnegative(),
  durationMs: OptionalNonNegativeInteger,
  enqueueSeq: z.number().int().positive(),
  costNanoUsd: z.number().int().nonnegative().optional(),
  pricingVersion: OptionalSmallString,
  pricingSource: OptionalSmallString,
  costComputedAtMs: OptionalNonNegativeInteger,
  redactionStatus: RedactionStatusSchema.default("metadata_only"),
  originalSizeBytes: OptionalNonNegativeInteger,
  payloadTruncated: z.boolean().default(false),
  metadata: MetadataSchema.default({}),
  localRedacted: RedactedSchema.default({ classes: [] }),
  localContentRedacted: OptionalContent,
  localFull: OptionalContent,
  contentExpiresAtMs: OptionalNonNegativeInteger,
  schemaVersion: z.literal(1).default(1),
}).strict().superRefine((event, ctx) => {
  if (event.localContentRedacted !== undefined && event.localFull !== undefined) {
    ctx.addIssue({ code: "custom", message: "An event carries at most one content capture level", path: ["localFull"] })
  }
  if (event.status === "started" && event.type.endsWith(".started")) return
  if (event.status !== "started" && !event.type.endsWith("." + event.status)) {
    ctx.addIssue({ code: "custom", message: "Event type and status must agree", path: ["status"] })
  }
})

export type ObservabilityEvent = z.infer<typeof ObservabilityEventSchema>

// Pre-default shape: lets record() callers omit fields Zod fills in
// (redactionStatus, payloadTruncated, metadata, localRedacted, schemaVersion)
// instead of repeating Phase 1 defaults at every call site.
export type ObservabilityEventInput = z.input<typeof ObservabilityEventSchema>

export function parseObservabilityEvent(input: unknown) {
  return ObservabilityEventSchema.safeParse(input)
}
