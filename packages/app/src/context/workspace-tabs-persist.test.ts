/* SPDX-License-Identifier: MIT */

import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { createPersistWriteMonitor } from "@/utils/persist-write-monitor"
import { PERSIST_DEBOUNCE_MS, createDebouncedPersist } from "./workspace-tabs-persist"

// C6 sensitivity, proven through the module the provider actually runs.
//
// Four bounded browser reproductions failed to make the guard fire, and the
// reason turned out to be arithmetic rather than scenario: the counter sat
// after a 50 ms debounce, which caps any key at 20 writes/s, so a 50/s
// threshold was unreachable by construction. Measured 2026-08-28 with three
// route/catalogue protections removed: 40 forced mode switches produced 128
// writes over 44 s — about 1/s/key, nowhere near the threshold.
//
// The historical runaway can no longer be reproduced on this branch at all:
// nine commits of fixes sit between the baseline the §4 mutation matrix was
// measured against and the current tree, so removing three protections leaves
// the others still holding. That is the code being correct, not a protocol
// error — which is precisely why sensitivity has to be proven by driving the
// real integration rather than by waiting for a defect that no longer exists.

function harness(threshold?: number) {
  let time = 0
  const warnings: string[] = []
  const writes: string[] = []
  const timers = new Map<number, () => void>()
  let nextHandle = 1

  const persist = createDebouncedPersist<string>({
    key: "unifia:workspace-tabs:v1",
    write: (snapshot) => writes.push(snapshot),
    writes: createPersistWriteMonitor({
      now: () => time,
      warn: (message) => warnings.push(message),
      ...(threshold === undefined ? {} : { threshold }),
    }),
    setTimeoutImpl: ((fn: () => void) => {
      const handle = nextHandle++
      timers.set(handle, fn)
      return handle as unknown as ReturnType<typeof setTimeout>
    }) as never,
    clearTimeoutImpl: ((handle: number) => timers.delete(handle)) as never,
  })

  return {
    persist,
    warnings,
    writes,
    advance(ms: number) {
      time += ms
    },
    /** Runs whatever debounced write is still armed, as the real timer would. */
    flush() {
      const pending = [...timers.values()]
      timers.clear()
      for (const fn of pending) fn()
    },
  }
}

describe("workspace-tabs debounced persistence", () => {
  test("coalesces a burst into a single write", () => {
    const h = harness()
    for (let i = 0; i < 60; i += 1) h.persist.schedule(`snapshot-${i}`)
    h.flush()
    // 60 requests, one surviving write — this is the ratio that made a
    // post-debounce counter blind.
    expect(h.writes).toEqual(["snapshot-59"])
  })

  test("the guard fires on a storm of requests through the real module", () => {
    const h = harness()
    for (let i = 0; i < 51; i += 1) h.persist.schedule("s")
    expect(h.warnings).toHaveLength(1)
    expect(h.warnings[0]).toContain("unifia:workspace-tabs:v1")
    expect(h.warnings[0]).toContain("possible reactive self-dependency")
  })

  test("a normal interaction rate never warns", () => {
    const h = harness()
    // A drag emits an event every 50-100 ms; ten of them is a busy second.
    for (let i = 0; i < 10; i += 1) {
      h.persist.schedule("s")
      h.advance(100)
    }
    expect(h.warnings).toEqual([])
  })

  test("dispose cancels the pending write", () => {
    const h = harness()
    h.persist.schedule("s")
    h.persist.dispose()
    h.flush()
    expect(h.writes).toEqual([])
  })

  test("dispose is idempotent", () => {
    const h = harness()
    h.persist.schedule("s")
    h.persist.dispose()
    h.persist.dispose()
    expect(h.writes).toEqual([])
  })

  // The arithmetic that made the old placement unprovable, stated as a test:
  // at one write per debounce window, a key cannot exceed 20/s.
  test("the debounce ceiling is below the default threshold", () => {
    const ceilingPerSecond = 1_000 / PERSIST_DEBOUNCE_MS
    expect(ceilingPerSecond).toBe(20)
    expect(ceilingPerSecond).toBeLessThan(50)
  })

  test("the provider schedules through this module, not its own timer", () => {
    const provider = readFileSync(resolve(import.meta.dir, "./workspace-tabs-provider.tsx"), "utf-8")
    expect(provider).toContain("createDebouncedPersist")
    expect(provider).toContain("persist.schedule(snapshot)")
    // A private timer here would put the counter back behind the debounce.
    expect(provider).not.toContain("writeTimer")
  })
})
