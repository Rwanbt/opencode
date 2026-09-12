import z from "zod"
import { ObservabilityId } from "./id"

const Ulid = z.string().refine(ObservabilityId.isValid, "Expected a ULID")

export const TraceContextSchema = z
  .object({
    traceId: Ulid,
    spanId: Ulid,
    parentSpanId: Ulid.optional(),
    sessionId: z.string().min(1).optional(),
    projectId: z.string().min(1).optional(),
    workspaceId: z.string().min(1).optional(),
    messageId: z.string().min(1).optional(),
    turnId: z.string().min(1).optional(),
    stepIndex: z.number().int().nonnegative().optional(),
    userIdHmac: z.string().regex(/^[0-9a-f]{64}$/).optional(),
  })
  .strict()

export type TraceContext = z.infer<typeof TraceContextSchema>

export function parseTraceContext(input: unknown) {
  return TraceContextSchema.safeParse(input)
}

export function createTraceContext(input: Omit<TraceContext, "traceId" | "spanId"> = {}) {
  return TraceContextSchema.parse({ ...input, traceId: ObservabilityId.create(), spanId: ObservabilityId.create() })
}
