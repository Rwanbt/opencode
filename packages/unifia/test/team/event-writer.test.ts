import { describe, expect, it } from "bun:test"
import { paginateEvents, type TeamEvent } from "../../src/team/events"
import { EventQueueFullError, EventWriter, type EventSink } from "../../src/team/event-writer"

class MemorySink implements EventSink {
  readonly batches: TeamEvent[][] = []
  fail = false
  waitForAppend: Promise<void> | null = null

  async append(events: readonly TeamEvent[]): Promise<void> {
    if (this.waitForAppend) await this.waitForAppend
    if (this.fail) throw new Error("sink unavailable")
    this.batches.push([...events])
  }
}

function input(runId = "run-1") {
  return { runId, family: "task" as const, type: "task.updated", payload: { status: "running" } }
}

describe("EventWriter", () => {
  it("assigns global and per-run monotonic sequences and batches durable writes", async () => {
    const sink = new MemorySink()
    const writer = new EventWriter(sink, { batchSize: 2, queueLimit: 8, now: () => "2026-07-26T20:10:00.000Z", id: (() => { let count = 0; return () => `event-${++count}` })() })
    const promises = [writer.append(input()), writer.append(input()), writer.append(input("run-2")), writer.append(input()), writer.append(input("run-2"))]
    await writer.close()
    const events = await Promise.all(promises)

    expect(sink.batches.map((batch) => batch.length)).toEqual([2, 2, 1])
    expect(events.map((event) => event.sequence)).toEqual([1, 2, 3, 4, 5])
    expect(events.map((event) => event.runSequence)).toEqual([1, 2, 1, 3, 2])
    expect(events.every((event) => event.schemaVersion === "1.0.0")).toBe(true)
  })

  it("bounds queued and in-flight events and exposes no token-level API", async () => {
    const sink = new MemorySink()
    let release!: () => void
    sink.waitForAppend = new Promise<void>((resolve) => { release = resolve })
    const writer = new EventWriter(sink, { batchSize: 2, queueLimit: 2 })
    const first = writer.append(input())
    const second = writer.append(input())
    await Promise.resolve()
    expect(writer.pendingCount).toBe(2)
    await expect(writer.append(input())).rejects.toBeInstanceOf(EventQueueFullError)
    release()
    await writer.close()
    await Promise.all([first, second])
  })

  it("propagates sink failure to the event promise", async () => {
    const sink = new MemorySink()
    sink.fail = true
    const writer = new EventWriter(sink, { batchSize: 1 })
    const event = writer.append(input())
    await expect(event).rejects.toThrow("sink unavailable")
    await writer.close()
  })

  it("rejects oversized event payloads before durable enqueue", async () => {
    const sink = new MemorySink()
    const writer = new EventWriter(sink, { batchSize: 2 })
    await expect(writer.append({ ...input(), payload: "x".repeat(65 * 1024) })).rejects.toThrow(RangeError)
    expect(writer.pendingCount).toBe(0)
    await expect(writer.append({ ...input(), family: "unknown" as "task" })).rejects.toThrow(TypeError)
  })
})

describe("paginateEvents", () => {
  function events(count: number): TeamEvent[] {
    return Array.from({ length: count }, (_, index) => ({
      schemaVersion: "1.0.0",
      eventId: `event-${index + 1}`,
      runId: "run-1",
      family: "task",
      type: "task.updated",
      payload: null,
      sequence: index + 1,
      runSequence: index + 1,
      occurredAt: "2026-07-26T20:10:00.000Z",
    }))
  }

  it("paginates one million ordered events with bounded pages", () => {
    const page = paginateEvents(events(1_000_000), "500000", 100)

    expect(page.items).toHaveLength(100)
    expect(page.items[0]?.sequence).toBe(500001)
    expect(page.items[99]?.sequence).toBe(500100)
    expect(page.nextCursor).toBe("500100")
  })

  it("rejects invalid cursors and page sizes", () => {
    const source = events(2)
    expect(() => paginateEvents(source, "not-a-number")).toThrow(TypeError)
    expect(() => paginateEvents(source, null, 0)).toThrow(RangeError)
    expect(() => paginateEvents(source, null, 1001)).toThrow(RangeError)
  })
})
