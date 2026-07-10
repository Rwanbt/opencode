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
})
