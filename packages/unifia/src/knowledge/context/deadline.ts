/* SPDX-License-Identifier: MIT */
/**
 * Deadline enforcement for retrieval (card C21).
 *
 * The router used to read the clock only between two notes, so a single slow
 * `source.list()` or `source.read()` ran to completion however long it took:
 * a source sleeping 80 ms against a 1 ms deadline returned after 97 ms with
 * `truncated: false`. A bound that only holds between operations is not a
 * bound.
 *
 * `KnowledgeSource` has no cancellation in its contract, so a call that
 * overruns cannot be stopped — but the caller must not keep waiting on it.
 * `withDeadline` stops waiting and reports the overrun; the abandoned promise
 * is left to settle on its own, with its rejection absorbed so it cannot
 * surface as an unhandled rejection.
 */

import { KnowledgeFailure } from "../domain/errors.js"

export class DeadlineExceeded extends Error {
  constructor(readonly operation: string, readonly budgetMs: number) {
    super(`${operation} exceeded its ${budgetMs}ms budget`)
    this.name = "DeadlineExceeded"
  }
}

/** Milliseconds left before `deadlineAt`, never negative. */
export function remainingMs(deadlineAt: number, now: number = Date.now()): number {
  return Math.max(0, deadlineAt - now)
}

/**
 * Await `work`, but stop waiting once `budgetMs` has elapsed.
 *
 * Rejects with `DeadlineExceeded` on overrun. A budget of 0 fails
 * immediately: there is no time left to start the work.
 */
export function withDeadline<T>(
  work: Promise<T>,
  budgetMs: number,
  operation: string,
): Promise<T> {
  if (budgetMs <= 0) {
    // Absorb the abandoned promise so an eventual rejection stays contained.
    void work.catch(() => undefined)
    return Promise.reject(new DeadlineExceeded(operation, budgetMs))
  }

  return new Promise<T>((resolve, reject) => {
    let settled = false
    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      reject(new DeadlineExceeded(operation, budgetMs))
    }, budgetMs)
    // Do not hold the process open for a deadline that has no work left.
    if (typeof timer === "object" && timer !== null && "unref" in timer) {
      ;(timer as { unref: () => void }).unref()
    }

    work.then(
      (value) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        resolve(value)
      },
      (error: unknown) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        reject(error instanceof Error ? error : new Error(String(error)))
      },
    )
  })
}

/** Convert a deadline overrun into the typed knowledge error. */
export function asKnowledgeFailure(e: unknown): KnowledgeFailure {
  if (e instanceof DeadlineExceeded) {
    return KnowledgeFailure.deadlineExceeded(e.message, { operation: e.operation })
  }
  return KnowledgeFailure.internal(e instanceof Error ? e.message : String(e))
}
