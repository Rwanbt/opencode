/* SPDX-License-Identifier: MIT */

import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { createPersistWriteMonitor } from "./persist-write-monitor"

function setup() {
  let time = 0
  const warnings: string[] = []
  const monitor = createPersistWriteMonitor({
    now: () => time,
    warn: (message) => warnings.push(message),
  })
  return {
    monitor,
    warnings,
    advance(ms: number) {
      time += ms
    },
  }
}

describe("persist write storm monitor", () => {
  test("does not warn at or below the threshold", () => {
    const { monitor, warnings } = setup()
    for (let count = 0; count < 50; count += 1) monitor.record("safe")
    expect(warnings).toEqual([])
  })

  test("warns once when a key exceeds the threshold", () => {
    const { monitor, warnings } = setup()
    for (let count = 0; count < 51; count += 1) monitor.record("workspace-tabs")
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toContain("workspace-tabs")
    expect(warnings[0]).toContain("51 persist calls")
    expect(warnings[0]).toContain("possible reactive self-dependency")
  })

  test("does not warn again during the same burst", () => {
    const { monitor, warnings } = setup()
    for (let count = 0; count < 100; count += 1) monitor.record("workspace-tabs")
    expect(warnings).toHaveLength(1)
  })

  test("rearms after the one-second window", () => {
    const { monitor, warnings, advance } = setup()
    for (let count = 0; count < 51; count += 1) monitor.record("workspace-tabs")
    advance(1_000)
    for (let count = 0; count < 51; count += 1) monitor.record("workspace-tabs")
    expect(warnings).toHaveLength(2)
  })

  test("tracks keys independently", () => {
    const { monitor, warnings } = setup()
    for (const key of ["tabs", "catalog"]) {
      for (let count = 0; count < 51; count += 1) monitor.record(key)
    }
    expect(warnings).toHaveLength(2)
    expect(warnings[0]).toContain("tabs")
    expect(warnings[1]).toContain("catalog")
  })

  // The gate this file exists for. Four bounded reproductions failed to make
  // the guard fire, and the reason was arithmetic, not scenario: the
  // workspace-tabs key is debounced 50 ms upstream, capping it at 20 writes/s,
  // so a 50/s threshold placed AFTER the debounce is unreachable by
  // construction. Measured 2026-08-28 with the three route/catalogue
  // protections removed: 40 forced mode switches produced 128 writes over
  // 44 s, about 1/s/key. Counting the request instead is what makes the guard
  // able to fire at all.
  test("the workspace-tabs integration counts the request, not the debounced write", () => {
    const tabs = readFileSync(resolve(import.meta.dir, "../context/workspace-tabs-provider.tsx"), "utf-8")
    // The scheduling now lives in createDebouncedPersist, which records the
    // request before arming the timer; see workspace-tabs-persist.test.ts for
    // the behavioural proof. What matters here is that the provider routes
    // through it instead of owning a private timer.
    expect(tabs).toContain("createDebouncedPersist")
    expect(tabs).not.toContain("writeTimer")
    expect(tabs).not.toContain("writePersistedState(snapshot, writes)")
  })

  test("a debounced key can still exceed the threshold once requests are counted", () => {
    // 60 requests inside one window: impossible to observe after a 50 ms
    // debounce (20/s ceiling), ordinary on the request side.
    const { monitor, warnings } = setup()
    for (let count = 0; count < 60; count += 1) monitor.record("unifia:workspace-tabs:v1")
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toContain("unifia:workspace-tabs:v1")
  })

  test("product integrations instantiate the monitor only in DEV", () => {
    const persist = readFileSync(resolve(import.meta.dir, "./persist.ts"), "utf-8")
    const tabs = readFileSync(resolve(import.meta.dir, "../context/workspace-tabs-provider.tsx"), "utf-8")
    expect(persist).toContain("import.meta.env.DEV ? createPersistWriteMonitor() : undefined")
    expect(tabs).toContain("import.meta.env.DEV ? createPersistWriteMonitor() : undefined")
  })
})
