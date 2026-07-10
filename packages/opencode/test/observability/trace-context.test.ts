import { describe, expect, test } from "bun:test"
import { ObservabilityId } from "../../src/observability/id"
import { createTraceContext, parseTraceContext } from "../../src/observability/trace-context"

describe("observability trace context", () => {
  test("creates valid independent ULIDs", () => {
    const context = createTraceContext({ sessionId: "session-1" })
    expect(ObservabilityId.isValid(context.traceId)).toBe(true)
    expect(ObservabilityId.isValid(context.spanId)).toBe(true)
    expect(context.traceId).not.toBe(context.spanId)
  })

  test("rejects invalid context without throwing", () => {
    const result = parseTraceContext({ traceId: "bad", spanId: "bad" })
    expect(result.success).toBe(false)
  })
})
