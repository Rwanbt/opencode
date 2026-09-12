/* SPDX-License-Identifier: MIT */

// Bounded concurrent scheduler for LSP warmup (carte B12).
// Replaces `Promise.all(map(...))` with a queue that limits in-flight tasks to
// `capacity` while preserving input order (deterministic). Avoids the unbounded
// concurrency of `Promise.all` (30+ filesystem walks hitting the OS at once)
// without paying the cost of strict sequential execution (over a second on a
// Windows dev machine, per the original comment in lsp/index.ts).

export type Task<T> = () => Promise<T>

// Run `tasks` with at most `capacity` tasks in flight at any time, returning
// results in the same order as the input array.
//
// Determinism: results[i] === await tasks[i]() (modulo the bounded concurrency).
// Capacity: at any moment, `Promise.all`-equivalent of running workers has
// length <= min(capacity, tasks.length).
export async function runBounded<T>(tasks: Task<T>[], capacity: number): Promise<T[]> {
  if (tasks.length === 0) return []
  const cap = Math.max(1, Math.min(capacity, tasks.length))
  const results: T[] = new Array(tasks.length)
  let next = 0
  const workers = Array.from({ length: cap }, async () => {
    while (true) {
      const i = next++
      if (i >= tasks.length) return
      results[i] = await tasks[i]()
    }
  })
  await Promise.all(workers)
  return results
}
