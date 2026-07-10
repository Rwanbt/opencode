import { ObservabilityId } from "./id"
import type { TraceContext } from "./trace-context"

export function startLlm(context: Omit<TraceContext, "spanId">, tsMs = Date.now()) {
  const spanId = ObservabilityId.create()
  const trace = { ...context, spanId }
  return { trace, event: { type: "llm.call.started" as const, status: "started" as const, tsMs } }
}

export function finishLlm(trace: TraceContext, status: "finished" | "failed" | "aborted", startedAtMs: number, tsMs = Date.now()) {
  return { context: trace, event: { type: `llm.call.${status}` as const, status, tsMs, durationMs: Math.max(0, tsMs - startedAtMs) } }
}
