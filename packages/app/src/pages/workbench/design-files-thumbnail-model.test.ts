/* SPDX-License-Identifier: MIT */

import { describe, expect, test } from "bun:test"
import { createSequentialQueue, firstTextLines } from "@/pages/workbench/design-files-thumbnail-model"

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

describe("firstTextLines", () => {
  test("splits on \\n and takes the first two lines by default", () => {
    expect(firstTextLines("a\nb\nc")).toEqual(["a", "b"])
  })

  test("splits on CRLF", () => {
    expect(firstTextLines("a\r\nb\r\nc")).toEqual(["a", "b"])
  })

  test("splits on lone CR", () => {
    expect(firstTextLines("a\rb\rc")).toEqual(["a", "b"])
  })

  test("returns fewer lines than count when the content is shorter", () => {
    expect(firstTextLines("only")).toEqual(["only"])
  })

  test("returns a single empty line for empty content", () => {
    expect(firstTextLines("")).toEqual([""])
  })

  test("truncates a line longer than maxChars with an ellipsis", () => {
    const long = "x".repeat(100)
    const [line] = firstTextLines(long, 1, 80)
    expect(line?.length).toBe(81)
    expect(line?.endsWith("…")).toBe(true)
    expect(line?.startsWith("x".repeat(80))).toBe(true)
  })

  test("does not truncate a line at or under maxChars", () => {
    const exact = "x".repeat(80)
    expect(firstTextLines(exact, 1, 80)).toEqual([exact])
  })

  test("honors a custom count", () => {
    expect(firstTextLines("a\nb\nc\nd", 3)).toEqual(["a", "b", "c"])
  })
})

describe("createSequentialQueue", () => {
  test("runs tasks strictly one at a time, in submission order", async () => {
    const queue = createSequentialQueue()
    const events: string[] = []
    const runs = [1, 2, 3].map((n) =>
      queue.enqueue(async () => {
        events.push(`start:${n}`)
        await delay(n === 1 ? 15 : 1)
        events.push(`end:${n}`)
        return n
      }),
    )
    const results = await Promise.all(runs)
    expect(results).toEqual([1, 2, 3])
    expect(events).toEqual(["start:1", "end:1", "start:2", "end:2", "start:3", "end:3"])
  })

  test("a rejecting task does not block tasks queued behind it", async () => {
    const queue = createSequentialQueue()
    const first = queue.enqueue(async () => {
      throw new Error("boom")
    })
    const second = queue.enqueue(async () => "ok")
    await expect(first).rejects.toThrow("boom")
    await expect(second).resolves.toBe("ok")
  })

  test("pending() reflects queued+running tasks and drains to zero", async () => {
    const queue = createSequentialQueue()
    expect(queue.pending()).toBe(0)
    const a = queue.enqueue(() => delay(5))
    const b = queue.enqueue(() => delay(5))
    expect(queue.pending()).toBe(2)
    await a
    expect(queue.pending()).toBe(1)
    await b
    expect(queue.pending()).toBe(0)
  })
})
