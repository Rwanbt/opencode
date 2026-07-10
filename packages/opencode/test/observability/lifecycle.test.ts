import { expect, test } from "bun:test"
import { finishLlm, startLlm } from "../../src/observability/lifecycle"
import { ObservabilityId } from "../../src/observability/id"

test("LLM lifecycle reuses span ID", () => {
  const started = startLlm({ traceId: ObservabilityId.create(), sessionId: "session-1" }, 10)
  const terminal = finishLlm(started.trace, "finished", 10, 25)
  expect(terminal.context.spanId).toBe(started.trace.spanId)
  expect(terminal.event.durationMs).toBe(15)
})
