/* SPDX-License-Identifier: MIT */

import { describe, expect, test } from "bun:test"
import { createThumbnailQueue, type ThumbnailTask } from "./design-files-thumbnail-queue"
import type { ThumbnailPreview } from "./design-files-thumbnail-model"

function makePreview(label: string) {
  return { kind: "text", lines: [label] } as const
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

describe("F12 — createThumbnailQueue (bounded + cancellable)", () => {
  test("a completed generation is cached and readable via get()", async () => {
    const queue = createThumbnailQueue()
    const task: ThumbnailTask = async () => makePreview("a")
    const preview = await queue.generate("/a", task)
    expect(preview).toEqual(makePreview("a"))
    expect(queue.get("/a")).toEqual(makePreview("a"))
  })

  test("selection change cancels the in-flight generation for the previous path (F12 oracle)", async () => {
    const queue = createThumbnailQueue()
    let aAborted = false
    const aTask: ThumbnailTask = (signal) => new Promise<ThumbnailPreview>((_, reject) => {
      const onAbort = () => { aAborted = true; reject(new DOMException("aborted", "AbortError")) }
      if (signal.aborted) onAbort()
      else signal.addEventListener("abort", onAbort)
    })
    const aPromise = queue.generate("/a", aTask)
    // Yield twice so the controller lands in `inflight` AND the
    // sequential queue has started running the first task before
    // the second `generate` fires the cancellation.
    await Promise.resolve()
    await Promise.resolve()
    const aRetryTask: ThumbnailTask = async () => makePreview("a-retry")
    const retry = queue.generate("/a", aRetryTask)
    await expect(aPromise).rejects.toThrow(/aborted/)
    expect(aAborted).toBe(true)
    const value = await retry
    expect(value).toEqual(makePreview("a-retry"))
  })

  test("cancel() is idempotent on a path with no in-flight generation", () => {
    const queue = createThumbnailQueue()
    expect(() => queue.cancel("/missing")).not.toThrow()
    expect(queue.stats().cancelled).toBe(0)
  })

  test("cancel() aborts an in-flight generation and counts the cancellation", async () => {
    const queue = createThumbnailQueue()
    const task: ThumbnailTask = (signal) => new Promise<ThumbnailPreview>((_, reject) => {
      const onAbort = () => reject(new DOMException("aborted", "AbortError"))
      if (signal.aborted) onAbort()
      else signal.addEventListener("abort", onAbort)
    })
    const promise = queue.generate("/a", task)
    await Promise.resolve()
    await Promise.resolve()
    queue.cancel("/a")
    await expect(promise).rejects.toThrow(/aborted/)
    expect(queue.stats().cancelled).toBe(1)
    expect(queue.stats().inflight).toBe(0)
  })

  test("cancelAll() aborts every in-flight generation", async () => {
    const queue = createThumbnailQueue()
    const hanging: ThumbnailTask = (signal) => new Promise<ThumbnailPreview>((_, reject) => {
      const onAbort = () => reject(new DOMException("aborted", "AbortError"))
      if (signal.aborted) onAbort()
      else signal.addEventListener("abort", onAbort)
    })
    const promises = [
      queue.generate("/a", hanging),
      queue.generate("/b", hanging),
      queue.generate("/c", hanging),
    ]
    await Promise.resolve()
    await Promise.resolve()
    queue.cancelAll()
    // Wait for ALL three to reject in parallel — the queue is
    // sequential, so a finishes first, then b, then c. Each
    // rejection must surface as an AbortError.
    const results = await Promise.allSettled(promises)
    for (const result of results) {
      expect(result.status).toBe("rejected")
      if (result.status === "rejected") {
        expect((result.reason as Error).name).toBe("AbortError")
      }
    }
    expect(queue.stats().cancelled).toBe(3)
    expect(queue.stats().inflight).toBe(0)
  })

  test("cache respects the cap (LRU evicts the oldest entry) (F12 oracle)", async () => {
    const queue = createThumbnailQueue({ cap: 2 })
    await queue.generate("/a", async () => makePreview("a"))
    await queue.generate("/b", async () => makePreview("b"))
    await queue.generate("/c", async () => makePreview("c"))  // /a is the oldest, gets evicted
    expect(queue.get("/a")).toBeUndefined()
    expect(queue.get("/b")).toEqual(makePreview("b"))
    expect(queue.get("/c")).toEqual(makePreview("c"))
    expect(queue.stats().cached).toBe(2)
  })

  test("a get() refreshes the LRU position so an actively-read file is not evicted", async () => {
    const queue = createThumbnailQueue({ cap: 2 })
    await queue.generate("/a", async () => makePreview("a"))
    await queue.generate("/b", async () => makePreview("b"))
    // Touch /a to make it the most-recently-used.
    expect(queue.get("/a")).toEqual(makePreview("a"))
    // Now insert /c — the oldest entry should be /b (not /a).
    await queue.generate("/c", async () => makePreview("c"))
    expect(queue.get("/a")).toEqual(makePreview("a"))
    expect(queue.get("/b")).toBeUndefined()
    expect(queue.get("/c")).toEqual(makePreview("c"))
  })

  test("evict() drops a specific entry without affecting the others", async () => {
    const queue = createThumbnailQueue()
    await queue.generate("/a", async () => makePreview("a"))
    await queue.generate("/b", async () => makePreview("b"))
    queue.evict("/a")
    expect(queue.get("/a")).toBeUndefined()
    expect(queue.get("/b")).toEqual(makePreview("b"))
  })

  test("clear() empties the cache", async () => {
    const queue = createThumbnailQueue()
    await queue.generate("/a", async () => makePreview("a"))
    await queue.generate("/b", async () => makePreview("b"))
    queue.clear()
    expect(queue.stats().cached).toBe(0)
  })

  test("generations are processed strictly one at a time (sequential queue)", async () => {
    const queue = createThumbnailQueue()
    const events: string[] = []
    const makeTask = (label: string, ms: number): ThumbnailTask => async () => {
      events.push(`start:${label}`)
      await delay(ms)
      events.push(`end:${label}`)
      return makePreview(label)
    }
    const a = queue.generate("/a", makeTask("a", 10))
    const b = queue.generate("/b", makeTask("b", 1))
    await Promise.all([a, b])
    expect(events).toEqual(["start:a", "end:a", "start:b", "end:b"])
  })
})
