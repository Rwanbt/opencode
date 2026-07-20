import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import {
  clearViewerTimingMarks,
  disableViewerTiming,
  enableViewerTiming,
  getViewerTimingMarks,
  isViewerTimingEnabled,
  markViewerTiming,
  viewerTimingLatency,
} from "./viewer-timing"

// FORK (PLAN-READONLY-VIEWER-REACTIVITY Phase 0): viewer-timing.ts is the
// shared instrumentation module used across packages/app and packages/ui to
// measure the save -> read-only-viewer pipeline (cause C1 in particular).
// These tests cover the module in isolation, framework-agnostic.

describe("viewer-timing", () => {
  afterEach(() => {
    disableViewerTiming()
  })

  test("disabled by default: markViewerTiming is a no-op", () => {
    expect(isViewerTimingEnabled()).toBe(false)
    markViewerTiming("save-start", { path: "a.ts" })
    expect(getViewerTimingMarks()).toEqual([])
  })

  test("enableViewerTiming turns marking on; disableViewerTiming turns it off and clears marks", () => {
    enableViewerTiming()
    expect(isViewerTimingEnabled()).toBe(true)
    markViewerTiming("save-start", { path: "a.ts" })
    expect(getViewerTimingMarks().length).toBe(1)

    disableViewerTiming()
    expect(isViewerTimingEnabled()).toBe(false)
    expect(getViewerTimingMarks()).toEqual([])

    // Still a no-op once disabled again.
    markViewerTiming("save-start", { path: "a.ts" })
    expect(getViewerTimingMarks()).toEqual([])
  })

  test("clearViewerTimingMarks empties the buffer without disabling", () => {
    enableViewerTiming()
    markViewerTiming("save-start")
    clearViewerTimingMarks()
    expect(getViewerTimingMarks()).toEqual([])
    expect(isViewerTimingEnabled()).toBe(true)
  })

  describe("viewerTimingLatency", () => {
    beforeEach(() => enableViewerTiming())

    test("undefined when the 'from' mark is missing", () => {
      markViewerTiming("editing-false", { path: "a.ts" })
      expect(viewerTimingLatency("save-start", "editing-false", "a.ts")).toBeUndefined()
    })

    test("undefined when the 'to' mark never followed the 'from' mark", () => {
      markViewerTiming("save-start", { path: "a.ts" })
      expect(viewerTimingLatency("save-start", "editing-false", "a.ts")).toBeUndefined()
    })

    test("computes a non-negative latency between two marks on the same path", () => {
      markViewerTiming("save-start", { path: "a.ts" })
      markViewerTiming("editing-false", { path: "a.ts" })
      const latency = viewerTimingLatency("save-start", "editing-false", "a.ts")
      expect(latency).toBeDefined()
      expect(latency!).toBeGreaterThanOrEqual(0)
    })

    test("scopes to the given path — marks from another path don't interfere", () => {
      markViewerTiming("save-start", { path: "a.ts" })
      markViewerTiming("save-start", { path: "b.ts" })
      markViewerTiming("editing-false", { path: "b.ts" })
      // a.ts never reached editing-false.
      expect(viewerTimingLatency("save-start", "editing-false", "a.ts")).toBeUndefined()
      expect(viewerTimingLatency("save-start", "editing-false", "b.ts")).toBeDefined()
    })

    test("without a path, matches across all marks in order", () => {
      markViewerTiming("save-start")
      markViewerTiming("editing-false")
      expect(viewerTimingLatency("save-start", "editing-false")).toBeDefined()
    })
  })

  test("viewer-ready is recorded only after layout-ready and viewer-stable", () => {
    enableViewerTiming()
    const path = "large.ts"
    markViewerTiming("notify-shadow-ready-end", { path })
    markViewerTiming("layout-ready", { path })
    markViewerTiming("viewer-stable", { path })
    markViewerTiming("viewer-ready", { path })

    expect(getViewerTimingMarks().map((mark) => mark.event)).toEqual([
      "notify-shadow-ready-end",
      "layout-ready",
      "viewer-stable",
      "viewer-ready",
    ])
  })})
