import type { ObservabilityEvent, ObservabilityEventInput } from "./event-schema"
import { parseObservabilityEvent } from "./event-schema"
import { ObservabilityId } from "./id"
import { BoundedEventQueue, type QueuePriority } from "./queue"
import type { TraceContext } from "./trace-context"
import { parseTraceContext } from "./trace-context"

export type RecordResult =
  | { ok: true; accepted: true; enqueueSeq: number }
  | { ok: false; reason: "invalid_context" | "invalid_event" | "queue_full" | "circuit_open" }

export type ObservabilityWriter = { insert(events: ObservabilityEvent[]): Promise<void> }

// Classifies a writer.insert() failure by SQLite error code/message so the
// health endpoint can distinguish transient contention (busy), a full disk
// (full), and on-disk damage (corrupt) from any other db error — same
// detection pattern proven against a real SQLITE_BUSY in
// test/observability/sqlite-busy.test.ts. Falls back to the generic "db"
// bucket for anything unrecognized (network drivers, mocked writers, etc.).
type DbFailureKind = "busy" | "full" | "corrupt" | "db"

function classifyDbFailure(error: unknown): DbFailureKind {
  const code = typeof error === "object" && error !== null && "code" in error ? String((error as { code?: unknown }).code) : undefined
  const message = String((error as { message?: unknown })?.message ?? error)
  if (code === "SQLITE_BUSY" || /SQLITE_BUSY|database is locked/i.test(message)) return "busy"
  if (code === "SQLITE_FULL" || /SQLITE_FULL|database or disk is full/i.test(message)) return "full"
  if (code === "SQLITE_CORRUPT" || /SQLITE_CORRUPT|malformed database/i.test(message)) return "corrupt"
  return "db"
}

export class ObservabilityService {
  #queue = new BoundedEventQueue<ObservabilityEvent>()
  #circuitOpen = false
  #failedDb = 0
  #failedBusy = 0
  #failedFull = 0
  #failedCorrupt = 0
  #inserted = 0
  #accepted = 0
  #rejectedInvalidContext = 0
  #rejectedInvalidEvent = 0
  #droppedQueueFull = 0
  #droppedCircuitOpen = 0
  #sanitizerFailed = 0
  #lastErrorAt?: number
  #lastErrorKind?: DbFailureKind

  constructor(private readonly writer: ObservabilityWriter) {}

  record(
    context: TraceContext,
    input: Omit<ObservabilityEventInput, "context" | "eventId" | "enqueueSeq">,
  ): RecordResult {
    if (!parseTraceContext(context).success) {
      this.#rejectedInvalidContext++
      return { ok: false, reason: "invalid_context" }
    }
    if (this.#circuitOpen) {
      this.#droppedCircuitOpen++
      return { ok: false, reason: "circuit_open" }
    }
    // Enqueue the Zod-validated, defaulted result (parsed.data) — not the raw
    // input — so NOT NULL columns like redaction_status are never undefined
    // when a caller relies on schema defaults instead of repeating them.
    const parsed = parseObservabilityEvent({ ...input, context, eventId: ObservabilityId.create(), enqueueSeq: 1 })
    if (!parsed.success) {
      this.#rejectedInvalidEvent++
      return { ok: false, reason: "invalid_event" }
    }
    const event = parsed.data
    if (event.redactionStatus === "failed_closed") this.#sanitizerFailed++
    const priority: QueuePriority = event.status === "started" ? "low" : "high"
    const queued = this.#queue.enqueue(event, JSON.stringify(event).length, priority)
    if (!queued.accepted) {
      this.#droppedQueueFull++
      return { ok: false, reason: "queue_full" }
    }
    this.#droppedQueueFull += queued.dropped
    event.enqueueSeq = queued.enqueueSeq
    this.#accepted++
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
    } catch (error) {
      const kind = classifyDbFailure(error)
      this.#lastErrorAt = Date.now()
      this.#lastErrorKind = kind
      if (kind === "busy") this.#failedBusy++
      else if (kind === "full") this.#failedFull++
      else if (kind === "corrupt") this.#failedCorrupt++
      else this.#failedDb++
      this.#circuitOpen = true
      return 0
    }
  }

  stats() {
    return {
      circuitOpen: this.#circuitOpen,
      eventsAccepted: this.#accepted,
      eventsInserted: this.#inserted,
      eventsRejectedInvalidContext: this.#rejectedInvalidContext,
      eventsRejectedInvalidEvent: this.#rejectedInvalidEvent,
      eventsDroppedQueueFull: this.#droppedQueueFull,
      eventsDroppedCircuitOpen: this.#droppedCircuitOpen,
      eventsFailedDb: this.#failedDb,
      eventsFailedBusy: this.#failedBusy,
      eventsFailedFull: this.#failedFull,
      eventsFailedCorrupt: this.#failedCorrupt,
      sanitizerFailed: this.#sanitizerFailed,
      lastErrorAt: this.#lastErrorAt,
      lastErrorKind: this.#lastErrorKind,
      queueSize: this.#queue.size,
      queueBytes: this.#queue.bytes,
    }
  }
}
