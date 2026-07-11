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

  test("counts accepted, rejected-context, rejected-event, and circuit-open drops separately", async () => {
    const service = new ObservabilityService({ insert: async () => {} })
    expect(service.record(createTraceContext(), event())).toMatchObject({ ok: true })
    expect(
      service.record({ traceId: "not-a-ulid", spanId: "not-a-ulid" }, event()),
    ).toEqual({ ok: false, reason: "invalid_context" })
    expect(
      // Built by hand, not via createTraceContext() — that helper Zod-parses
      // internally and would throw before record() ever sees this invalid
      // stepIndex (TraceContextSchema requires it non-negative).
      service.record({ ...createTraceContext(), stepIndex: -1 }, event()),
    ).toEqual({ ok: false, reason: "invalid_context" })
    expect(
      service.record(createTraceContext(), { ...event(), metadata: { unknownField: "x" } as never }),
    ).toEqual({ ok: false, reason: "invalid_event" })

    const stats = service.stats()
    expect(stats.eventsAccepted).toBe(1)
    expect(stats.eventsRejectedInvalidContext).toBe(2)
    expect(stats.eventsRejectedInvalidEvent).toBe(1)

    // Now open the circuit and confirm the drop is counted under its own bucket, not eventsRejectedInvalidContext/-Event.
    const failing = new ObservabilityService({ insert: async () => { throw new Error("boom") } })
    failing.record(createTraceContext(), event())
    await failing.flush()
    failing.record(createTraceContext(), event())
    expect(failing.stats().eventsDroppedCircuitOpen).toBe(1)
  })

  test("classifies db failures into busy/full/corrupt/generic buckets and records lastError", async () => {
    for (const [message, kind] of [
      ["SQLITE_BUSY: database is locked", "eventsFailedBusy"],
      ["SQLITE_FULL: database or disk is full", "eventsFailedFull"],
      ["SQLITE_CORRUPT: malformed database schema", "eventsFailedCorrupt"],
      ["ECONNRESET", "eventsFailedDb"],
    ] as const) {
      const service = new ObservabilityService({ insert: async () => { throw new Error(message) } })
      service.record(createTraceContext(), event())
      await service.flush()
      const stats = service.stats()
      expect(stats[kind]).toBe(1)
      expect(stats.lastErrorAt).toBeGreaterThan(0)
      expect(typeof stats.lastErrorKind).toBe("string")
    }
  })

  test("counts sanitizer fail-closed events without rejecting the record", () => {
    const service = new ObservabilityService({ insert: async () => {} })
    const result = service.record(createTraceContext(), { ...event(), redactionStatus: "failed_closed" })
    expect(result).toMatchObject({ ok: true })
    expect(service.stats().sanitizerFailed).toBe(1)
  })
})
