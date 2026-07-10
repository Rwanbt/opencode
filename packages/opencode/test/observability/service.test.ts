import { describe, expect, test } from "bun:test"
import { ObservabilityService } from "../../src/observability/service"
import { createTraceContext } from "../../src/observability/trace-context"

const event = () => ({ type: "llm.call.started" as const, status: "started" as const, tsMs: Date.now(), redactionStatus: "metadata_only" as const, payloadTruncated: false, schemaVersion: 1 as const, metadata: {}, localRedacted: { classes: [] } })

describe("observability service", () => {
  test("queues and flushes without leaking product errors", async () => {
    const rows: unknown[] = []
    const service = new ObservabilityService({ insert: async (events) => void rows.push(...events) })
    expect(service.record(createTraceContext(), event())).toMatchObject({ ok: true, enqueueSeq: 1 })
    expect(await service.flush()).toBe(1)
    expect(rows).toHaveLength(1)
  })

  test("opens circuit on database failure", async () => {
    const service = new ObservabilityService({ insert: async () => { throw new Error("SQLITE_BUSY") } })
    service.record(createTraceContext(), event())
    expect(await service.flush()).toBe(0)
    expect(service.record(createTraceContext(), event())).toEqual({ ok: false, reason: "circuit_open" })
  })
})
