import { describe, expect, test } from "bun:test"
import { getSessionHandoff, getTerminalHandoff, setSessionHandoff, setTerminalHandoff } from "./handoff"

// D-08: module-level LRU handoff stores (cap 40). State is shared across tests
// in this file, so eviction tests insert >= 40 of their own keys to flush any
// prior state, and merge/get tests assert on freshly-inserted (MRU) keys.

describe("session handoff", () => {
  test("stores a new session from defaults merged with the patch", () => {
    setSessionHandoff("mg-1", { prompt: "hello" })
    expect(getSessionHandoff("mg-1")).toEqual({ prompt: "hello", files: {} })
  })

  test("merges a partial patch over the previous value", () => {
    setSessionHandoff("mg-2", { prompt: "first", files: { "a.ts": { start: 1, end: 2 } } })
    setSessionHandoff("mg-2", { prompt: "second" })
    expect(getSessionHandoff("mg-2")).toEqual({ prompt: "second", files: { "a.ts": { start: 1, end: 2 } } })
  })

  test("returns undefined for an unknown key", () => {
    expect(getSessionHandoff("never-set")).toBeUndefined()
  })

  test("evicts the oldest entries beyond the 40-entry cap", () => {
    // Insert 45 keys: the map keeps only the 40 most recent, so the first 5 of
    // this burst are evicted regardless of any prior state.
    for (let i = 0; i < 45; i++) setSessionHandoff(`ev-${i}`, { prompt: `p${i}` })
    expect(getSessionHandoff("ev-4")).toBeUndefined()
    expect(getSessionHandoff("ev-5")).toBeDefined()
    expect(getSessionHandoff("ev-44")).toBeDefined()
  })

  test("re-setting a key refreshes its recency so it survives eviction", () => {
    for (let i = 0; i < 40; i++) setSessionHandoff(`tc-${i}`, { prompt: `p${i}` }) // map = tc-0..tc-39
    setSessionHandoff("tc-0", { prompt: "refreshed" }) // tc-0 -> most recent
    setSessionHandoff("tc-40", { prompt: "new" }) // size 41 -> evict oldest, now tc-1
    expect(getSessionHandoff("tc-1")).toBeUndefined()
    expect(getSessionHandoff("tc-0")).toEqual({ prompt: "refreshed", files: {} })
    expect(getSessionHandoff("tc-40")).toBeDefined()
  })
})

describe("terminal handoff", () => {
  test("stores and returns the buffer for a key", () => {
    setTerminalHandoff("term-1", ["line a", "line b"])
    expect(getTerminalHandoff("term-1")).toEqual(["line a", "line b"])
  })

  test("returns undefined for an unknown key", () => {
    expect(getTerminalHandoff("term-missing")).toBeUndefined()
  })
})
