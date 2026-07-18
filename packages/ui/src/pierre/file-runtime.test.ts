import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { clearReadyWatcher, createReadyWatcher, disposeReadyWatcher, notifyShadowReady, watchViewerLineRows } from "./file-runtime"

// FORK (PLAN-READONLY-VIEWER-REACTIVITY C3 / C12): file-runtime.ts had zero
// test coverage before this file. These tests pin the notifyShadowReady /
// disposeReadyWatcher contract, in particular the C3 fix: a settle-frame RAF
// scheduled between "ready detected" and settleFrames elapsing must not fire
// onReady() (or leave a MutationObserver dangling) once the owning component
// is disposed.
//
// requestAnimationFrame / cancelAnimationFrame / MutationObserver are not
// standard Bun test globals, and file-runtime.ts is written to guard their
// absence — so real timing here would either no-op or be non-deterministic.
// These fakes give exact, synchronous control over "one animation frame" and
// "one mutation batch" instead of racing real timers.

type RafCallback = (time: number) => void

let rafQueue: Map<number, RafCallback>
let rafNextId: number
let originalRaf: typeof requestAnimationFrame | undefined
let originalCancelRaf: typeof cancelAnimationFrame | undefined
let originalMutationObserver: typeof MutationObserver | undefined
let originalResizeObserver: typeof ResizeObserver | undefined
let originalHTMLElement: typeof HTMLElement | undefined

// Bun's test runtime has no DOM at all — referencing the bare `HTMLElement`
// identifier (as watchViewerLineRows does, via `root.host instanceof
// HTMLElement`) throws a ReferenceError, not just `typeof === "undefined"`.
// A minimal stub is enough since only `instanceof` is exercised.
class FakeHTMLElement {}

class FakeMutationObserver {
  static instances: FakeMutationObserver[] = []
  disconnected = false
  constructor(public callback: MutationCallback) {
    FakeMutationObserver.instances.push(this)
  }
  observe() {}
  disconnect() {
    this.disconnected = true
  }
  // Test-only helper — simulates the browser delivering a mutation batch.
  trigger() {
    this.callback([], this as unknown as MutationObserver)
  }
}

class FakeResizeObserver {
  static instances: FakeResizeObserver[] = []
  disconnected = false
  observedTargets: unknown[] = []
  constructor(public callback: ResizeObserverCallback) {
    FakeResizeObserver.instances.push(this)
  }
  observe(target: unknown) {
    this.observedTargets.push(target)
  }
  unobserve() {}
  disconnect() {
    this.disconnected = true
  }
  // Test-only helper — simulates the browser reporting a size change.
  trigger() {
    this.callback([], this as unknown as ResizeObserver)
  }
}

function flushFrames() {
  const entries = Array.from(rafQueue.entries())
  rafQueue.clear()
  for (const [, cb] of entries) cb(0)
}

beforeEach(() => {
  rafQueue = new Map()
  rafNextId = 0
  originalRaf = globalThis.requestAnimationFrame
  originalCancelRaf = globalThis.cancelAnimationFrame
  originalMutationObserver = globalThis.MutationObserver

  globalThis.requestAnimationFrame = ((cb: RafCallback) => {
    rafNextId += 1
    rafQueue.set(rafNextId, cb)
    return rafNextId
  }) as typeof requestAnimationFrame
  globalThis.cancelAnimationFrame = ((id: number) => {
    rafQueue.delete(id)
  }) as typeof cancelAnimationFrame

  FakeMutationObserver.instances = []
  globalThis.MutationObserver = FakeMutationObserver as unknown as typeof MutationObserver

  originalResizeObserver = globalThis.ResizeObserver
  FakeResizeObserver.instances = []
  globalThis.ResizeObserver = FakeResizeObserver as unknown as typeof ResizeObserver

  originalHTMLElement = globalThis.HTMLElement
  globalThis.HTMLElement = FakeHTMLElement as unknown as typeof HTMLElement
})

afterEach(() => {
  if (originalRaf) globalThis.requestAnimationFrame = originalRaf
  else delete (globalThis as { requestAnimationFrame?: unknown }).requestAnimationFrame
  if (originalCancelRaf) globalThis.cancelAnimationFrame = originalCancelRaf
  else delete (globalThis as { cancelAnimationFrame?: unknown }).cancelAnimationFrame
  if (originalMutationObserver) globalThis.MutationObserver = originalMutationObserver
  else delete (globalThis as { MutationObserver?: unknown }).MutationObserver
  if (originalResizeObserver) globalThis.ResizeObserver = originalResizeObserver
  else delete (globalThis as { ResizeObserver?: unknown }).ResizeObserver
  if (originalHTMLElement) globalThis.HTMLElement = originalHTMLElement
  else delete (globalThis as { HTMLElement?: unknown }).HTMLElement
})

const fakeRoot = {} as ShadowRoot
const fakeContainer = {} as HTMLElement

describe("notifyShadowReady", () => {
  test("ready immediately: onReady fires after the settle-frame RAF is flushed, not synchronously", () => {
    const state = createReadyWatcher()
    let readyCalls = 0
    notifyShadowReady({
      state,
      container: fakeContainer,
      getRoot: () => fakeRoot,
      isReady: () => true,
      onReady: () => {
        readyCalls++
      },
    })
    expect(readyCalls).toBe(0)
    flushFrames()
    expect(readyCalls).toBe(1)
  })

  test("settleFrames > 0 waits the full chain before calling onReady", () => {
    const state = createReadyWatcher()
    let readyCalls = 0
    notifyShadowReady({
      state,
      container: fakeContainer,
      getRoot: () => fakeRoot,
      isReady: () => true,
      settleFrames: 2,
      onReady: () => {
        readyCalls++
      },
    })
    flushFrames()
    expect(readyCalls).toBe(0)
    flushFrames()
    expect(readyCalls).toBe(0)
    flushFrames()
    expect(readyCalls).toBe(1)
  })

  test("not ready yet: installs a MutationObserver and calls onReady once a mutation reports ready", () => {
    const state = createReadyWatcher()
    let readyState = false
    let readyCalls = 0
    notifyShadowReady({
      state,
      container: fakeContainer,
      getRoot: () => fakeRoot,
      isReady: () => readyState,
      onReady: () => {
        readyCalls++
      },
    })
    expect(FakeMutationObserver.instances.length).toBe(1)
    const observer = FakeMutationObserver.instances[0]!

    observer.trigger() // still not ready — no-op
    expect(readyCalls).toBe(0)
    expect(observer.disconnected).toBe(false)

    readyState = true
    observer.trigger() // now ready — disconnects and schedules the settle frame
    expect(observer.disconnected).toBe(true)
    flushFrames()
    expect(readyCalls).toBe(1)
  })

  test("a superseding notifyShadowReady call invalidates the previous generation's pending frame", () => {
    const state = createReadyWatcher()
    let readyCalls = 0
    notifyShadowReady({
      state,
      container: fakeContainer,
      getRoot: () => fakeRoot,
      isReady: () => true,
      settleFrames: 1,
      onReady: () => {
        readyCalls += 1
      },
    })
    flushFrames() // consumes step(1), schedules step(0) for generation 1

    // A fresh render cycle starts before generation 1 settles (e.g. content
    // changed again before the previous render finished settling).
    notifyShadowReady({
      state,
      container: fakeContainer,
      getRoot: () => fakeRoot,
      isReady: () => true,
      settleFrames: 0,
      onReady: () => {
        readyCalls += 10
      },
    })

    // Both frames are now queued (as they would be in the same real browser
    // frame) — only generation 2's callback must actually fire.
    flushFrames()
    expect(readyCalls).toBe(10)
  })
})

describe("disposeReadyWatcher (C3 — no task survives destruction)", () => {
  test("disposing between 'ready detected' and settle-frame completion cancels the pending frame outright", () => {
    const state = createReadyWatcher()
    let readyCalls = 0
    notifyShadowReady({
      state,
      container: fakeContainer,
      getRoot: () => fakeRoot,
      isReady: () => true,
      settleFrames: 2,
      onReady: () => {
        readyCalls++
      },
    })
    flushFrames() // first settle frame consumed, one more RAF now pending
    expect(rafQueue.size).toBe(1)

    // Component torn down mid-settle-frame wait (e.g. `<Show when={!editing()}>`
    // unmounts the viewer right after save).
    disposeReadyWatcher(state)
    expect(rafQueue.size).toBe(0) // the pending frame was cancelled, not just orphaned

    flushFrames() // no-op: nothing left to flush
    expect(readyCalls).toBe(0)
  })

  test("disposing after a MutationObserver reported ready but before settle frames elapse: observer stays disconnected, onReady never fires", () => {
    const state = createReadyWatcher()
    let readyState = false
    let readyCalls = 0
    notifyShadowReady({
      state,
      container: fakeContainer,
      getRoot: () => fakeRoot,
      isReady: () => readyState,
      settleFrames: 1,
      onReady: () => {
        readyCalls++
      },
    })
    const observer = FakeMutationObserver.instances[0]!
    readyState = true
    observer.trigger()
    expect(observer.disconnected).toBe(true)
    expect(rafQueue.size).toBe(1)

    disposeReadyWatcher(state)
    expect(rafQueue.size).toBe(0)

    flushFrames()
    expect(readyCalls).toBe(0)
  })

  test("clearReadyWatcher alone (the internal, mid-cycle reset) does NOT cancel a pending settle-frame", () => {
    // Documents the distinction the C3 fix relies on: clearReadyWatcher is
    // reused by notifyShadowReady itself between/within cycles and must stay
    // a no-op on `token`/the RAF, or it would invalidate its own in-flight
    // generation. Only disposeReadyWatcher performs the final teardown.
    const state = createReadyWatcher()
    let readyCalls = 0
    notifyShadowReady({
      state,
      container: fakeContainer,
      getRoot: () => fakeRoot,
      isReady: () => true,
      settleFrames: 1,
      onReady: () => {
        readyCalls++
      },
    })
    clearReadyWatcher(state)
    flushFrames() // consumes step(1), schedules step(0)
    flushFrames() // consumes step(0) -> onReady
    expect(readyCalls).toBe(1)
  })

  test("idempotent: safe to call twice, and safe on a watcher that was never armed", () => {
    const state = createReadyWatcher()
    expect(() => disposeReadyWatcher(state)).not.toThrow()
    expect(() => disposeReadyWatcher(state)).not.toThrow()
    expect(state.disposed).toBe(true)
  })

  test("notifyShadowReady is a no-op on an already-disposed watcher", () => {
    const state = createReadyWatcher()
    disposeReadyWatcher(state)

    let readyCalls = 0
    notifyShadowReady({
      state,
      container: fakeContainer,
      getRoot: () => fakeRoot,
      isReady: () => true,
      onReady: () => {
        readyCalls++
      },
    })
    flushFrames()
    expect(readyCalls).toBe(0)
    expect(rafQueue.size).toBe(0)
    expect(FakeMutationObserver.instances.length).toBe(0)
  })
})

// FORK (PLAN-READONLY-VIEWER-REACTIVITY Phase 4): watchViewerLineRows moved
// here from components/file.tsx (see the move's WHY comment above
// getSynchronizedGridRows in file-runtime.ts) — first test coverage for its
// scheduling/cleanup contract. querySelectorAll returns [] in every fake
// root below, so fixSubgridLineRowCollapse's own DOM math is a no-op here —
// these tests pin the *scheduler* (coalescing, cleanup, no-loop), not the
// row-height computation (covered separately in file-line-rows.test.ts).
describe("watchViewerLineRows", () => {
  function fakeLineRowsRoot(): ShadowRoot {
    const host = new FakeHTMLElement()
    return {
      querySelectorAll: () => [],
      host,
    } as unknown as ShadowRoot
  }

  test("undefined root: returns a no-op cleanup, installs nothing", () => {
    const stop = watchViewerLineRows(undefined)
    expect(() => stop()).not.toThrow()
    expect(FakeMutationObserver.instances.length).toBe(0)
    expect(FakeResizeObserver.instances.length).toBe(0)
  })

  test("installs a MutationObserver and a ResizeObserver on root.host, and runs once immediately", () => {
    const root = fakeLineRowsRoot()
    watchViewerLineRows(root)
    expect(FakeMutationObserver.instances.length).toBe(1)
    expect(FakeResizeObserver.instances.length).toBe(1)
    expect(FakeResizeObserver.instances[0]!.observedTargets).toEqual([root.host])
    // The initial schedule() call already queued a frame.
    expect(rafQueue.size).toBe(1)
  })

  test("multiple mutations before the frame fires coalesce into a single scheduled frame (no pile-up)", () => {
    const root = fakeLineRowsRoot()
    watchViewerLineRows(root)
    const sizeAfterInit = rafQueue.size
    const observer = FakeMutationObserver.instances[0]!
    observer.trigger()
    observer.trigger()
    observer.trigger()
    // Still just one pending frame — schedule() no-ops while frame !== 0.
    expect(rafQueue.size).toBe(sizeAfterInit)
  })

  test("a resize triggers the same coalesced schedule as a mutation", () => {
    const root = fakeLineRowsRoot()
    watchViewerLineRows(root)
    flushFrames() // consume the initial schedule() frame
    expect(rafQueue.size).toBe(0)

    FakeResizeObserver.instances[0]!.trigger()
    expect(rafQueue.size).toBe(1)
  })

  test("cleanup disconnects both observers and cancels a pending frame", () => {
    const root = fakeLineRowsRoot()
    const stop = watchViewerLineRows(root)
    const mutation = FakeMutationObserver.instances[0]!
    const resize = FakeResizeObserver.instances[0]!
    expect(rafQueue.size).toBe(1) // initial schedule() still pending

    stop()

    expect(mutation.disconnected).toBe(true)
    expect(resize.disconnected).toBe(true)
    expect(rafQueue.size).toBe(0) // the pending frame was cancelled, not just orphaned
  })

  test("cleanup after the frame already fired is still safe (idempotent-ish: no throw, no stale cancel)", () => {
    const root = fakeLineRowsRoot()
    const stop = watchViewerLineRows(root)
    flushFrames()
    expect(() => stop()).not.toThrow()
  })
})
