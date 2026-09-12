/* SPDX-License-Identifier: MIT */

import { createSequentialQueue, type SequentialQueue, type ThumbnailPreview } from "./design-files-thumbnail-model"

/**
 * F12 — bounded thumbnail queue with per-path cancellation.
 *
 * Two problems the F12 oracle (« changement de sélection annule ;
 * cache borné ») is built against:
 *
 *   1. **Cancellation on selection change**: when the user picks a
 *      new file in the design list, every in-flight thumbnail
 *      generation for the previous file is wasted work. The
 *      iframes the worker mounts keep rendering after the user has
 *      moved on, costing CPU and memory for an image no one will
 *      ever look at. Cancelling the per-path AbortController on
 *      selection change aborts the in-flight work cooperatively.
 *
 *   2. **Bounded cache**: a user who navigates a 5 000-file design
 *      workspace can blow the heap with a 5 000-entry preview map.
 *      An LRU eviction policy with a configurable cap is the only
 *      way to bound memory deterministically.
 *
 * The queue reuses `createSequentialQueue` from the model layer
 * (one-at-a-time generation keeps iframe count at 1) and adds the
 * two F12 primitives on top. The `generate(path, produce)` API is
 * the unit-tested surface — tests assert:
 *   - selection change cancels in-flight work
 *   - the cache respects the cap (oldest entry evicted)
 *   - the queue processes paths strictly in submission order
 *   - cancellation is idempotent (calling cancel on a finished
 *     path is a no-op)
 */

export type ThumbnailTask = (signal: AbortSignal) => Promise<ThumbnailPreview>

export type ThumbnailQueueStats = {
  /** Number of paths currently in the cache (may exceed cap during the next eviction). */
  cached: number
  /** Number of paths with an in-flight generation. */
  inflight: number
  /** Number of paths cancelled before completion since the queue was created. */
  cancelled: number
}

export type ThumbnailQueue = {
  /**
   * Generate a thumbnail for `path`. If a generation is already
   * in flight for this path, the in-flight task is cancelled and a
   * fresh one is enqueued. The returned promise resolves to the
   * completed preview, or rejects with `AbortError` if the
   * generation is cancelled (e.g. by a new selection).
   */
  generate(path: string, task: ThumbnailTask): Promise<ThumbnailPreview>
  /** Cancel the in-flight generation for `path` (no-op if none). */
  cancel(path: string): void
  /** Cancel every in-flight generation. */
  cancelAll(): void
  /** Read the cached preview for `path`, or undefined. Marks the entry as recently used. */
  get(path: string): ThumbnailPreview | undefined
  /** Drop the cached preview for `path`. */
  evict(path: string): void
  /** Drop every cached preview. */
  clear(): void
  /** Snapshot of the queue counters (cache size, in-flight, total cancellations). */
  stats(): ThumbnailQueueStats
  /** Cap (after which the least-recently-used entry is evicted on the next `get`/`generate`). */
  readonly cap: number
}

export type ThumbnailQueueOptions = {
  /** Maximum number of cached previews. Defaults to 64. */
  cap?: number
  /** Sequential queue to funnel generation through. Defaults to a fresh one. */
  queue?: SequentialQueue
}

export function createThumbnailQueue(options: ThumbnailQueueOptions = {}): ThumbnailQueue {
  const cap = options.cap ?? 64
  const queue = options.queue ?? createSequentialQueue()
  // Map<path, AbortController> — the in-flight generation, if any.
  // Cleared on completion or cancellation.
  const inflight = new Map<string, AbortController>()
  // Map<path, ThumbnailPreview> — the cache. Insertion order is
  // the LRU signal: `get` re-inserts, `generate` re-inserts on
  // completion. When size > cap, the oldest entry is dropped.
  const cache = new Map<string, ThumbnailPreview>()
  let cancelled = 0

  const evictIfOverCap = () => {
    while (cache.size > cap) {
      const oldest = cache.keys().next().value
      if (oldest === undefined) break
      cache.delete(oldest)
    }
  }

  const touch = (path: string, preview: ThumbnailPreview): ThumbnailPreview => {
    // WHY delete + set: Map preserves insertion order. Re-inserting
    // bumps the entry to the most-recently-used end of the LRU
    // chain. Without this, `get`/`generate` would not refresh the
    // LRU position and an actively-viewed file would still be the
    // first to be evicted.
    cache.delete(path)
    cache.set(path, preview)
    evictIfOverCap()
    return preview
  }

  return {
    cap,
    generate: (path, task) => {
      const previous = inflight.get(path)
      if (previous) {
        // WHY cancel the previous task: the user's selection has
        // settled on `path` (or another path that supersedes
        // this one); keeping the old in-flight generation around
        // is the wasted-CPU/memory case the F12 oracle forbids.
        previous.abort()
        cancelled += 1
        inflight.delete(path)
      }
      const controller = new AbortController()
      inflight.set(path, controller)
      return queue
        .enqueue(() => task(controller.signal))
        .then((preview) => {
          // Drop the controller only if it's still the active one
          // (a cancellation that raced with the natural
          // completion would have replaced the controller in the
          // `cancel` path — we don't want to delete someone
          // else's controller).
          if (inflight.get(path) === controller) inflight.delete(path)
          return touch(path, preview)
        })
        .catch((reason: unknown) => {
          if (inflight.get(path) === controller) inflight.delete(path)
          throw reason
        })
    },
    cancel: (path) => {
      const controller = inflight.get(path)
      if (!controller) return
      controller.abort()
      inflight.delete(path)
      cancelled += 1
    },
    cancelAll: () => {
      for (const controller of inflight.values()) controller.abort()
      cancelled += inflight.size
      inflight.clear()
    },
    get: (path) => {
      const value = cache.get(path)
      if (value === undefined) return undefined
      // Bump to most-recently-used.
      cache.delete(path)
      cache.set(path, value)
      return value
    },
    evict: (path) => { cache.delete(path) },
    clear: () => { cache.clear() },
    stats: () => ({ cached: cache.size, inflight: inflight.size, cancelled }),
  }
}
