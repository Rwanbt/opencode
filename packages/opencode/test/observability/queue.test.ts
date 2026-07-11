import { describe, expect, test } from "bun:test"
import { BoundedEventQueue } from "../../src/observability/queue"

describe("observability bounded queue", () => {
  test("assigns FIFO enqueue sequences", () => {
    const queue = new BoundedEventQueue<string>(3, 100)
    expect(queue.enqueue("started", 10, "low")).toMatchObject({ accepted: true, enqueueSeq: 1 })
    expect(queue.enqueue("finished", 10, "high")).toMatchObject({ accepted: true, enqueueSeq: 2 })
    expect(queue.peek(2).map((item) => item.value)).toEqual(["started", "finished"])
  })

  test("preserves high priority terminal events on overflow", () => {
    const queue = new BoundedEventQueue<string>(2, 100)
    queue.enqueue("old-started", 10, "low")
    queue.enqueue("finished", 10, "high")
    expect(queue.enqueue("new-failed", 10, "high")).toMatchObject({ accepted: true, dropped: 1 })
    expect(queue.peek(2).map((item) => item.value)).toEqual(["finished", "new-failed"])
  })

  test("rejects a low priority event when only high priority events remain", () => {
    const queue = new BoundedEventQueue<string>(1, 100)
    queue.enqueue("finished", 10, "high")
    expect(queue.enqueue("started", 10, "low")).toEqual({ accepted: false, reason: "queue_full" })
  })

  test("rejects a high priority event when only high priority events remain (no low-priority victim to evict)", () => {
    const queue = new BoundedEventQueue<string>(1, 100)
    queue.enqueue("finished", 10, "high")
    expect(queue.enqueue("failed", 10, "high")).toEqual({ accepted: false, reason: "queue_full" })
    expect(queue.peek(1).map((item) => item.value)).toEqual(["finished"])
  })

  test("evicts multiple low priority events to make room for one incoming event under the event-count bound", () => {
    const queue = new BoundedEventQueue<string>(3, 1000)
    queue.enqueue("low-1", 10, "low")
    queue.enqueue("low-2", 10, "low")
    queue.enqueue("low-3", 10, "low")
    // maxEvents=3, all three slots occupied by low priority — enqueueing one
    // high priority event must evict exactly one (the oldest by array order,
    // per BoundedEventQueue.#drop's findIndex), not the whole queue.
    expect(queue.enqueue("high-1", 10, "high")).toMatchObject({ accepted: true, dropped: 1 })
    expect(queue.peek(3).map((item) => item.value)).toEqual(["low-2", "low-3", "high-1"])
  })

  test("evicts multiple low priority events to make room under the byte bound", () => {
    const queue = new BoundedEventQueue<string>(100, 30)
    queue.enqueue("low-1", 10, "low")
    queue.enqueue("low-2", 10, "low")
    queue.enqueue("low-3", 10, "low")
    // maxBytes=30, already full by bytes (not by count) — a single incoming
    // 15-byte high priority event must evict enough low-priority items
    // (here: two — one alone only frees 10 bytes, still not enough room for
    // 15 more under a 30-byte cap) to fit under the byte cap, proving the
    // eviction loop is driven by #isFull's byte check too, not only the
    // event-count check.
    const result = queue.enqueue("high-1", 15, "high")
    expect(result).toMatchObject({ accepted: true, dropped: 2 })
    expect(queue.peek(2).map((item) => item.value)).toEqual(["low-3", "high-1"])
    expect(queue.bytes).toBe(25)
  })

  test("rejects a single event larger than maxBytes outright, without touching existing items", () => {
    const queue = new BoundedEventQueue<string>(10, 100)
    queue.enqueue("existing", 10, "high")
    expect(queue.enqueue("too-big", 101, "low")).toEqual({ accepted: false, reason: "event_too_large" })
    expect(queue.size).toBe(1)
    expect(queue.bytes).toBe(10)
  })

  test("enqueueSeq keeps incrementing monotonically across evictions, never reused", () => {
    const queue = new BoundedEventQueue<string>(1, 100)
    expect(queue.enqueue("low-1", 10, "low")).toMatchObject({ accepted: true, enqueueSeq: 1 })
    // Evicts low-1 to make room — the accepted event still gets the next
    // sequence number (2), not a reused/rewound one.
    const evicting = queue.enqueue("high-1", 10, "high")
    expect(evicting).toMatchObject({ accepted: true, dropped: 1, enqueueSeq: 2 })
    // Queue is now full of a single high-priority item — nothing left to evict.
    const next = queue.enqueue("high-2", 10, "high")
    expect(next).toEqual({ accepted: false, reason: "queue_full" })
  })
})
