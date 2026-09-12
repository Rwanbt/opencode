import { describe, expect, test } from "bun:test"
import { createTraceContext } from "../../src/observability/trace-context"
import { parseObservabilityEvent } from "../../src/observability/event-schema"

function validEvent() {
  return {
    context: createTraceContext({ sessionId: "session-1" }),
    type: "llm.call.started" as const,
    status: "started" as const,
    tsMs: Date.now(),
    enqueueSeq: 1,
  }
}

describe("observability event schema", () => {
  test("accepts metadata-only events", () => {
    expect(parseObservabilityEvent(validEvent()).success).toBe(true)
  })

  test("rejects a mismatched terminal type", () => {
    const event = { ...validEvent(), type: "llm.call.finished" as const, status: "failed" as const }
    expect(parseObservabilityEvent(event).success).toBe(false)
  })

  test("rejects unexpected raw content", () => {
    const event = { ...validEvent(), metadata: { prompt: "do not persist me" } }
    expect(parseObservabilityEvent(event).success).toBe(false)
  })
})
