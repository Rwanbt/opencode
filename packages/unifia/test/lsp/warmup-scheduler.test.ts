/* SPDX-License-Identifier: MIT */

import { test, expect } from "bun:test"
import { runBounded } from "../../src/lsp/warmup-scheduler"

test("runBounded with capacity 1 is sequential and order-preserving", async () => {
  const tasks = [1, 2, 3, 4, 5].map((i) => async () => {
    await new Promise((r) => setTimeout(r, 5))
    return i
  })
  const results = await runBounded(tasks, 1)
  expect(results).toEqual([1, 2, 3, 4, 5])
})

test("runBounded with capacity >= N runs all tasks concurrently", async () => {
  const tasks = [1, 2, 3].map((i) => async () => {
    await new Promise((r) => setTimeout(r, 20))
    return i
  })
  const start = Date.now()
  const results = await runBounded(tasks, 5)
  const elapsed = Date.now() - start
  expect(results).toEqual([1, 2, 3])
  // 3 tasks * 20ms each, but with capacity 5 they all run in parallel
  // — total should be ~20ms, not 60ms.
  expect(elapsed).toBeLessThan(50)
})

test("runBounded with capacity 2 never exceeds the capacity", async () => {
  let active = 0
  let maxActive = 0
  const tasks = [1, 2, 3, 4, 5].map((i) => async () => {
    active++
    maxActive = Math.max(maxActive, active)
    await new Promise((r) => setTimeout(r, 10))
    active--
    return i
  })
  const results = await runBounded(tasks, 2)
  expect(results).toEqual([1, 2, 3, 4, 5])
  expect(maxActive).toBeLessThanOrEqual(2)
})

test("runBounded with empty task list returns empty array", async () => {
  const results = await runBounded([], 4)
  expect(results).toEqual([])
})

test("runBounded with single task works", async () => {
  const results = await runBounded([async () => 42], 4)
  expect(results).toEqual([42])
})

test("runBounded preserves order even with mixed durations", async () => {
  const tasks = [
    async () => {
      await new Promise((r) => setTimeout(r, 30))
      return "slow"
    },
    async () => {
      await new Promise((r) => setTimeout(r, 5))
      return "fast"
    },
    async () => {
      await new Promise((r) => setTimeout(r, 15))
      return "medium"
    },
  ]
  const results = await runBounded(tasks, 3)
  expect(results).toEqual(["slow", "fast", "medium"])
})

test("runBounded with capacity 0 is treated as capacity 1 (defensive)", async () => {
  const results = await runBounded([async () => 1, async () => 2], 0)
  expect(results).toEqual([1, 2])
})
