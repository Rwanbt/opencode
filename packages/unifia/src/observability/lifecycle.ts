import { ObservabilityId } from "./id"
import type { TraceContext } from "./trace-context"

type SpanKind = "llm" | "tool" | "agent"
type TerminalStatus = "finished" | "failed" | "aborted"

function startSpan<K extends SpanKind>(kind: K, context: Omit<TraceContext, "spanId">, tsMs: number) {
  const spanId = ObservabilityId.create()
  const trace = { ...context, spanId }
  return { trace, event: { type: `${kind}.call.started` as const, status: "started" as const, tsMs } }
}

function finishSpan<K extends SpanKind>(
  kind: K,
  trace: TraceContext,
  status: TerminalStatus,
  startedAtMs: number,
  tsMs: number,
) {
  return {
    context: trace,
    event: { type: `${kind}.call.${status}` as const, status, tsMs, durationMs: Math.max(0, tsMs - startedAtMs) },
  }
}

export function startLlm(context: Omit<TraceContext, "spanId">, tsMs = Date.now()) {
  return startSpan("llm", context, tsMs)
}

export function finishLlm(trace: TraceContext, status: TerminalStatus, startedAtMs: number, tsMs = Date.now()) {
  return finishSpan("llm", trace, status, startedAtMs, tsMs)
}

export function startTool(context: Omit<TraceContext, "spanId">, tsMs = Date.now()) {
  return startSpan("tool", context, tsMs)
}

export function finishTool(trace: TraceContext, status: TerminalStatus, startedAtMs: number, tsMs = Date.now()) {
  return finishSpan("tool", trace, status, startedAtMs, tsMs)
}

export function startAgent(context: Omit<TraceContext, "spanId">, tsMs = Date.now()) {
  return startSpan("agent", context, tsMs)
}

export function finishAgent(trace: TraceContext, status: TerminalStatus, startedAtMs: number, tsMs = Date.now()) {
  return finishSpan("agent", trace, status, startedAtMs, tsMs)
}
