/* SPDX-License-Identifier: MIT */

/**
 * Session event hub: assigns replay sequences and serves reconnecting readers.
 *
 * WHY this exists: `RuntimeEvent.sequence` and `subscribeEvents(afterSequence)`
 * were added so an interrupted stream can resume where it stopped — a Phase 2
 * exit criterion ("les événements sont rejouables"). A backend that emits no
 * sequence makes the server omit the SSE `id:` line, which leaves the client
 * with nothing to resume from; a backend that ignores `afterSequence` hands a
 * reconnecting client only what happens next, silently losing whatever arrived
 * while it was away. Both failures are invisible until someone reconnects.
 *
 * The hub is deliberately transport-agnostic and free of any runtime
 * dependency, so the sequencing contract can be proven without booting a
 * runtime.
 */

import type { RuntimeEvent } from "./runtime.ts"

export type UnsequencedEvent = Omit<RuntimeEvent, "sequence">

/**
 * Raised when a reader asks to resume from a point the hub no longer retains.
 *
 * It is an error rather than a silent jump forward: skipping the gap would give
 * the reader a stream that looks continuous but is not, which is worse than
 * telling it to resynchronise.
 */
export class EventGapError extends Error {
  readonly requested: number
  readonly oldestRetained: number
  constructor(requested: number, oldestRetained: number) {
    super(`cannot resume from sequence ${requested}; the oldest retained event is ${oldestRetained}`)
    this.name = "EventGapError"
    this.requested = requested
    this.oldestRetained = oldestRetained
  }
}

const DEFAULT_HISTORY_LIMIT = 1000

type Waiter = (result: IteratorResult<RuntimeEvent>) => void

export class SessionEventHub {
  readonly #history: RuntimeEvent[] = []
  readonly #historyLimit: number
  readonly #waiters = new Set<{ afterSequence: number; resolve: Waiter }>()
  #nextSequence = 1
  #closed = false

  constructor(historyLimit: number = DEFAULT_HISTORY_LIMIT) {
    if (!Number.isSafeInteger(historyLimit) || historyLimit <= 0) throw new Error("history limit must be a positive integer")
    this.#historyLimit = historyLimit
  }

  get lastSequence(): number {
    return this.#nextSequence - 1
  }

  /** Sequence of the oldest event still replayable, or 0 when nothing was dropped. */
  get oldestRetained(): number {
    return this.#history.length > 0 ? (this.#history[0]!.sequence ?? 0) - 1 : 0
  }

  /** Assigns the next sequence, retains the event, and wakes live readers. */
  publish(event: UnsequencedEvent): RuntimeEvent {
    if (this.#closed) throw new Error("event hub is closed")
    const sequenced: RuntimeEvent = { ...event, sequence: this.#nextSequence++ }
    this.#history.push(sequenced)
    if (this.#history.length > this.#historyLimit) this.#history.shift()
    for (const waiter of [...this.#waiters]) {
      this.#waiters.delete(waiter)
      waiter.resolve({ done: false, value: sequenced })
    }
    return sequenced
  }

  /**
   * Reads from `afterSequence` onward: everything still retained after that
   * point, then live events as they arrive.
   *
   * @throws EventGapError when the requested cursor predates the retained window.
   */
  subscribe(afterSequence = 0): AsyncIterable<RuntimeEvent> {
    if (afterSequence < 0 || !Number.isSafeInteger(afterSequence)) throw new Error("afterSequence must be a non-negative integer")
    if (afterSequence > 0 && afterSequence < this.oldestRetained) throw new EventGapError(afterSequence, this.oldestRetained)
    const pending = this.#history.filter((event) => (event.sequence ?? 0) > afterSequence)
    let cursor = Math.max(afterSequence, this.lastSequence - this.#history.length)
    return {
      [Symbol.asyncIterator]: () => ({
        next: (): Promise<IteratorResult<RuntimeEvent>> => {
          const replayed = pending.shift()
          if (replayed) {
            cursor = replayed.sequence ?? cursor
            return Promise.resolve({ done: false, value: replayed })
          }
          if (this.#closed) return Promise.resolve({ done: true, value: undefined })
          return new Promise<IteratorResult<RuntimeEvent>>((resolve) => {
            const waiter = { afterSequence: cursor, resolve }
            this.#waiters.add(waiter)
          })
        },
        return: async (): Promise<IteratorResult<RuntimeEvent>> => {
          // Only this reader stops; other readers and the hub are unaffected.
          return { done: true, value: undefined }
        },
      }),
    }
  }

  /** Ends every live reader. Retained history stays readable until dropped. */
  close(): void {
    if (this.#closed) return
    this.#closed = true
    for (const waiter of [...this.#waiters]) {
      this.#waiters.delete(waiter)
      waiter.resolve({ done: true, value: undefined })
    }
  }
}

/** Keeps one hub per session and disposes them together. */
export class SessionEventHubRegistry {
  readonly #hubs = new Map<string, SessionEventHub>()
  readonly #historyLimit: number

  constructor(historyLimit: number = DEFAULT_HISTORY_LIMIT) {
    this.#historyLimit = historyLimit
  }

  for(sessionId: string): SessionEventHub {
    const existing = this.#hubs.get(sessionId)
    if (existing) return existing
    const hub = new SessionEventHub(this.#historyLimit)
    this.#hubs.set(sessionId, hub)
    return hub
  }

  close(sessionId: string): void {
    this.#hubs.get(sessionId)?.close()
    this.#hubs.delete(sessionId)
  }

  closeAll(): void {
    for (const sessionId of [...this.#hubs.keys()]) this.close(sessionId)
  }
}
