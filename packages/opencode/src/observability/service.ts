import type { ObservabilityEvent } from "./event-schema"
import { parseObservabilityEvent } from "./event-schema"
import { ObservabilityId } from "./id"
import { BoundedEventQueue, type QueuePriority } from "./queue"
import type { TraceContext } from "./trace-context"
import { parseTraceContext } from "./trace-context"

export type RecordResult =
  | { ok: true; accepted: true; enqueueSeq: number }
  | { ok: false; reason: "invalid_context" | "invalid_event" | "queue_full" | "circuit_open" }

export type ObservabilityWriter = { insert(events: ObservabilityEvent[]): Promise<void> }

export class ObservabilityService {
  #queue = new BoundedEventQueue<ObservabilityEvent>()
  #circuitOpen = false
  #failedDb = 0
  #inserted = 0

  constructor(private readonly writer: ObservabilityWriter) {}

  record(context: TraceContext, input: Omit<ObservabilityEvent, "context" | "eventId" | "enqueueSeq">): RecordResult {
    if (!parseTraceContext(context).success) return { ok: false, reason: "invalid_context" }
    if (this.#circuitOpen) return { ok: false, reason: "circuit_open" }
    const event = { ...input, context, eventId: ObservabilityId.create(), enqueueSeq: 1 }
    if (!parseObservabilityEvent(event).success) return { ok: false, reason: "invalid_event" }
    const priority: QueuePriority = event.status === "started" ? "low" : "high"
    const queued = this.#queue.enqueue(event, JSON.stringify(event).length, priority)
    if (!queued.accepted) return { ok: false, reason: "queue_full" }
    event.enqueueSeq = queued.enqueueSeq
    return { ok: true, accepted: true, enqueueSeq: queued.enqueueSeq }
  }

  async flush(limit = 100) {
    const batch = this.#queue.peek(limit)
    if (!batch.length) return 0
    try {
      await this.writer.insert(batch.map((item) => item.value))
      this.#queue.acknowledge(batch.length)
      this.#inserted += batch.length
      return batch.length
    } catch {
      this.#failedDb++
      this.#circuitOpen = true
      return 0
    }
  }

  stats() {
    return { circuitOpen: this.#circuitOpen, eventsInserted: this.#inserted, eventsFailedDb: this.#failedDb, queueSize: this.#queue.size, queueBytes: this.#queue.bytes }
  }
}
