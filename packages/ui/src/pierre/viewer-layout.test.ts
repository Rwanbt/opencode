import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test"
import { countViewerLines, getViewerLayoutStrategy, shouldVirtualizeViewer, watchViewerLineRows } from "./viewer-layout"

const previousMutationObserver = globalThis.MutationObserver
const previousResizeObserver = globalThis.ResizeObserver
const previousRequestAnimationFrame = globalThis.requestAnimationFrame
const previousCancelAnimationFrame = globalThis.cancelAnimationFrame

let frames: FrameRequestCallback[] = []

function flushFrames() {
  while (frames.length) {
    const pending = frames
    frames = []
    for (const callback of pending) callback(performance.now())
  }
}
function flushOneFrame() {
  const pending = frames
  frames = []
  for (const callback of pending) callback(performance.now())
}

beforeEach(() => {
  frames = []
  globalThis.requestAnimationFrame = ((callback: FrameRequestCallback) => {
    frames.push(callback)
    return frames.length
  }) as typeof requestAnimationFrame
  globalThis.cancelAnimationFrame = mock(() => {})
  globalThis.MutationObserver = class {
    observe() {}
    disconnect() {}
    takeRecords() {
      return []
    }
  } as unknown as typeof MutationObserver
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver
})

afterEach(() => {
  globalThis.MutationObserver = previousMutationObserver
  globalThis.ResizeObserver = previousResizeObserver
  globalThis.requestAnimationFrame = previousRequestAnimationFrame
  globalThis.cancelAnimationFrame = previousCancelAnimationFrame
})

describe("getViewerLayoutStrategy", () => {
  test("uses native layout for desktop subgrid and all virtualized files", () => {
    expect(getViewerLayoutStrategy({ platform: "desktop", isVirtual: false, lineCount: 100, supportsSubgrid: true })).toBe("native")
    expect(getViewerLayoutStrategy({ platform: "mobile-webview", isVirtual: true, lineCount: 50_000, supportsSubgrid: false })).toBe("native")
  })

  test("measures Android WebView and browsers without subgrid", () => {
    expect(getViewerLayoutStrategy({ platform: "mobile-webview", isVirtual: false, lineCount: 100, supportsSubgrid: true })).toBe("measured")
    expect(getViewerLayoutStrategy({ platform: "web", isVirtual: false, lineCount: 100, supportsSubgrid: false })).toBe("measured")
  })
})


describe("shouldVirtualizeViewer", () => {
  test("virtualizes the 500 KB and 1 MB boundaries", () => {
    expect(shouldVirtualizeViewer({ bytes: 500_000, lineCount: 1_000 })).toBe(true)
    expect(shouldVirtualizeViewer({ bytes: 1_000_000, lineCount: 1_000 })).toBe(true)
  })

  test("virtualizes 50,000 short lines even below the byte threshold", () => {
    expect(shouldVirtualizeViewer({ bytes: 100_000, lineCount: 50_000 })).toBe(true)
  })

  test("keeps a normal small file on the native renderer", () => {
    expect(shouldVirtualizeViewer({ bytes: 20_000, lineCount: 1_000 })).toBe(false)
  })
})

describe("countViewerLines", () => {
  test("matches viewer semantics without allocating a split array", () => {
    expect(countViewerLines("")).toBe(1)
    expect(countViewerLines("one")).toBe(1)
    expect(countViewerLines("one\n")).toBe(1)
    expect(countViewerLines("one\ntwo")).toBe(2)
    expect(countViewerLines("one\ntwo\n")).toBe(2)
  })
})
test("layout-ready pass precedes two stable animation frames", () => {
  const events: string[] = []
  watchViewerLineRows(
    { querySelectorAll: () => [], host: {} } as unknown as ShadowRoot,
    {
      strategy: "native",
      onPass: () => events.push("layout-ready"),
      onStable: () => events.push("viewer-stable"),
    },
  )

  flushOneFrame()
  expect(events).toEqual(["layout-ready"])
  flushOneFrame()
  expect(events).toEqual(["layout-ready"])
  flushOneFrame()
  expect(events).toEqual(["layout-ready", "viewer-stable"])
})

test("superseded layout cycle cannot report stability after cleanup", () => {
  let stable = 0
  const stop = watchViewerLineRows(
    { querySelectorAll: () => [], host: {} } as unknown as ShadowRoot,
    { strategy: "native", onStable: () => (stable += 1) },
  )
  flushOneFrame()
  stop()
  flushFrames()
  expect(stable).toBe(0)
})
test("a sustained mutation burst reconnects after the cooldown instead of staying desynced forever", () => {
  let observeCalls = 0
  let disconnectCalls = 0
  let mutate: (() => void) | undefined
  globalThis.MutationObserver = class {
    constructor(callback: (records: MutationRecord[]) => void) {
      mutate = () => callback([])
    }
    observe() {
      observeCalls += 1
    }
    disconnect() {
      disconnectCalls += 1
    }
    takeRecords() {
      return []
    }
  } as unknown as typeof MutationObserver

  const timers: Array<() => void> = []
  const previousSetTimeout = globalThis.setTimeout
  const previousClearTimeout = globalThis.clearTimeout
  globalThis.setTimeout = ((callback: () => void) => {
    timers.push(callback)
    return timers.length
  }) as unknown as typeof setTimeout
  globalThis.clearTimeout = (() => {}) as unknown as typeof clearTimeout

  const passes: number[] = []
  watchViewerLineRows(
    { querySelectorAll: () => [], host: {} } as unknown as ShadowRoot,
    { strategy: "measured", onPass: (result) => passes.push(result.pass) },
  )

  // Keep mutating faster than the 2-frame settle window can resolve — a
  // real streamed-token-span burst never lets consecutivePasses reset.
  for (let i = 0; i < 10; i += 1) {
    flushOneFrame()
    mutate?.()
  }

  expect(passes.length).toBeGreaterThanOrEqual(8)
  expect(disconnectCalls).toBeGreaterThanOrEqual(1)
  expect(timers.length).toBeGreaterThanOrEqual(1)

  const passesBeforeCooldown = passes.length
  const observeCallsBeforeCooldown = observeCalls
  timers[timers.length - 1]!()
  flushOneFrame()

  expect(observeCalls).toBeGreaterThan(observeCallsBeforeCooldown)
  expect(passes.length).toBeGreaterThan(passesBeforeCooldown)

  globalThis.setTimeout = previousSetTimeout
  globalThis.clearTimeout = previousClearTimeout
})

test("native strategy reaches stability without scanning line rows", () => {
  const querySelectorAll = mock(() => {
    throw new Error("native layout must not scan rows")
  })
  const passes: number[] = []
  let stable = 0

  watchViewerLineRows(
    { querySelectorAll, host: {} } as unknown as ShadowRoot,
    {
      strategy: "native",
      onPass: (result) => passes.push(result.rows),
      onStable: () => {
        stable += 1
      },
    },
  )
  flushFrames()

  expect(passes).toEqual([0])
  expect(stable).toBe(1)
  expect(querySelectorAll).not.toHaveBeenCalled()
})