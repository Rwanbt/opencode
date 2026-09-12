import { randomUUID } from "node:crypto"
import { createTeamEvent, type TeamEvent, type TeamEventInput } from "./events"

const DEFAULT_BATCH_SIZE = 64
const DEFAULT_QUEUE_LIMIT = 256

export interface EventSink {
  append(events: readonly TeamEvent[]): Promise<void>
}

export interface EventWriterOptions {
  readonly batchSize?: number
  readonly queueLimit?: number
  readonly now?: () => string
  readonly id?: () => string
}

interface PendingEvent {
  readonly event: TeamEvent
  readonly resolve: (event: TeamEvent) => void
  readonly reject: (error: unknown) => void
}

export class EventQueueFullError extends Error {
  constructor(limit: number) {
    super(`event writer queue is full (limit ${limit})`)
    this.name = "EventQueueFullError"
  }
}

export class EventWriter {
  readonly #sink: EventSink
  readonly #batchSize: number
  readonly #queueLimit: number
  readonly #now: () => string
  readonly #id: () => string
  readonly #pending: PendingEvent[] = []
  readonly #runSequences = new Map<string, number>()
  #globalSequence = 0
  #inFlight = 0
  #flushTail: Promise<void> = Promise.resolve()

  constructor(sink: EventSink, options: EventWriterOptions = {}) {
    this.#sink = sink
    this.#batchSize = options.batchSize ?? DEFAULT_BATCH_SIZE
    this.#queueLimit = options.queueLimit ?? DEFAULT_QUEUE_LIMIT
    this.#now = options.now ?? (() => new Date().toISOString())
    this.#id = options.id ?? randomUUID
    if (!Number.isInteger(this.#batchSize) || this.#batchSize <= 0) throw new RangeError("batchSize must be positive")
    if (!Number.isInteger(this.#queueLimit) || this.#queueLimit < this.#batchSize) throw new RangeError("queueLimit must be at least batchSize")
  }

  get pendingCount(): number {
    return this.#pending.length + this.#inFlight
  }

  append(input: Omit<TeamEventInput, "eventId"> & { eventId?: string }): Promise<TeamEvent> {
    if (this.pendingCount >= this.#queueLimit) return Promise.reject(new EventQueueFullError(this.#queueLimit))
    const eventId = input.eventId ?? this.#id()
    try {
      createTeamEvent({ ...input, eventId }, 1, 1, this.#now())
    } catch (error) {
      return Promise.reject(error)
    }
    const sequence = ++this.#globalSequence
    const runSequence = (this.#runSequences.get(input.runId) ?? 0) + 1
    this.#runSequences.set(input.runId, runSequence)
    const event = createTeamEvent({ ...input, eventId }, sequence, runSequence, this.#now())
    const promise = new Promise<TeamEvent>((resolve, reject) => this.#pending.push({ event, resolve, reject }))
    if (this.#pending.length >= this.#batchSize) void this.flush()
    return promise
  }
  flush(): Promise<void> {
    if (this.#pending.length === 0) return this.#flushTail
    const batches: PendingEvent[][] = []
    let batchCount = 0
    while (this.#pending.length > 0) batches.push(this.#pending.splice(0, this.#batchSize))
    batchCount = batches.reduce((count, batch) => count + batch.length, 0)
    this.#inFlight += batchCount
    this.#flushTail = this.#flushTail.then(async () => {
      for (const batch of batches) {
        try {
          await this.#sink.append(batch.map((pending) => pending.event))
          for (const pending of batch) pending.resolve(pending.event)
          this.#inFlight -= batch.length
        } catch (error) {
          for (const pending of batch) pending.reject(error)
          this.#inFlight -= batch.length
        }
      }
    })
    return this.#flushTail
  }
  async close(): Promise<void> {
    while (this.#pending.length > 0) await this.flush()
    await this.#flushTail
  }
}
