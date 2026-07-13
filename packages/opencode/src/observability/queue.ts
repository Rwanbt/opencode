export type QueuePriority = "low" | "high"

export type QueueItem<T> = {
  enqueueSeq: number
  value: T
  bytes: number
  priority: QueuePriority
}

export type QueueEnqueueResult =
  | { accepted: true; enqueueSeq: number; dropped: number }
  | { accepted: false; reason: "queue_full" | "event_too_large" }

export class BoundedEventQueue<T> {
  #items: QueueItem<T>[] = []
  #bytes = 0
  #nextSequence = 1

  constructor(
    readonly maxEvents = 500,
    readonly maxBytes = 64 * 1024 * 1024,
  ) {}

  get size() {
    return this.#items.length
  }

  get bytes() {
    return this.#bytes
  }

  enqueue(value: T, bytes: number, priority: QueuePriority): QueueEnqueueResult {
    if (!Number.isSafeInteger(bytes) || bytes < 0 || bytes > this.maxBytes) return { accepted: false, reason: "event_too_large" }

    let dropped = 0
    while (this.#isFull(bytes)) {
      const index = this.#items.findIndex((item) => item.priority === "low")
      if (index < 0) return { accepted: false, reason: "queue_full" }
      this.#drop(index)
      dropped++
    }

    const enqueueSeq = this.#nextSequence++
    this.#items.push({ enqueueSeq, value, bytes, priority })
    this.#bytes += bytes
    return { accepted: true, enqueueSeq, dropped }
  }

  peek(limit: number) {
    return this.#items.slice(0, limit)
  }

  acknowledge(count: number) {
    const safeCount = Math.max(0, Math.min(count, this.#items.length))
    for (const item of this.#items.splice(0, safeCount)) this.#bytes -= item.bytes
  }

  #isFull(nextBytes: number) {
    return this.#items.length >= this.maxEvents || this.#bytes + nextBytes > this.maxBytes
  }

  #drop(index: number) {
    const [item] = this.#items.splice(index, 1)
    this.#bytes -= item.bytes
  }
}
