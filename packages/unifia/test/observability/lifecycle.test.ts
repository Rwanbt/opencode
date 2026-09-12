import { expect, test } from "bun:test"
import { finishLlm, finishTool, startLlm, startTool } from "../../src/observability/lifecycle"
import { ObservabilityId } from "../../src/observability/id"

test("LLM lifecycle reuses span ID", () => {
  const started = startLlm({ traceId: ObservabilityId.create(), sessionId: "session-1" }, 10)
  const terminal = finishLlm(started.trace, "finished", 10, 25)
  expect(terminal.context.spanId).toBe(started.trace.spanId)
  expect(terminal.event.durationMs).toBe(15)
  expect(started.event.type).toBe("llm.call.started")
  expect(terminal.event.type).toBe("llm.call.finished")
})

test("tool lifecycle reuses span ID and stays within its own event namespace", () => {
  const traceId = ObservabilityId.create()
  const started = startTool({ traceId, sessionId: "session-1" }, 10)
  const terminal = finishTool(started.trace, "failed", 10, 40)
  expect(terminal.context.spanId).toBe(started.trace.spanId)
  expect(terminal.context.traceId).toBe(traceId)
  expect(terminal.event.durationMs).toBe(30)
  expect(started.event.type).toBe("tool.call.started")
  expect(terminal.event.type).toBe("tool.call.failed")
})
