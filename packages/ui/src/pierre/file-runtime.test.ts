import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import {
  clearReadyWatcher,
  createAnnotationApplyTracker,
  createReadyWatcher,
  disposeReadyWatcher,
  notifyShadowReady,
  watchViewerLineRows,
} from "./file-runtime"

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

    observer.trigger() // still not ready — schedules a coalesced check frame
    flushFrames() // consumes checkReady(): isReady() still false, no-op
    expect(readyCalls).toBe(0)
    expect(observer.disconnected).toBe(false)

    readyState = true
    observer.trigger() // now ready, but the check itself is coalesced onto a frame (C8)
    expect(observer.disconnected).toBe(false)
    flushFrames() // consumes checkReady(): isReady() true -> disconnects, schedules settle frame
    expect(observer.disconnected).toBe(true)
    flushFrames() // consumes the settle frame -> onReady
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

  test("F4: a leftover settle-frame RAF from a superseded cycle does not swallow the new cycle's single mutation", () => {
    const state = createReadyWatcher()
    let readyCalls = 0

    // Cycle 1: root ready immediately, settleFrames=1 leaves a pending
    // settle RAF (RAF-A) — deliberately NOT flushed before cycle 2 starts.
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
    expect(rafQueue.size).toBe(1) // RAF-A pending

    // Cycle 2 supersedes before RAF-A fires: root exists but is NOT ready
    // yet, so notifyShadowReady installs a MutationObserver instead of
    // going straight to runReady().
    let cycle2Ready = false
    notifyShadowReady({
      state,
      container: fakeContainer,
      getRoot: () => fakeRoot,
      isReady: () => cycle2Ready,
      onReady: () => {
        readyCalls += 10
      },
    })
    // FORK (CORRECTIF F4) pins this: the stale RAF-A must be cancelled by
    // the supersession itself, not left dangling.
    expect(rafQueue.size).toBe(0)

    const observer = FakeMutationObserver.instances[0]!
    cycle2Ready = true
    // Exactly ONE mutation arrives. Before the F4 fix, RAF-A would still be
    // occupying state.frame here, so the observer callback's
    // `state.frame !== undefined` guard would swallow this mutation and
    // checkReady would never be scheduled — cycle 2 would never become
    // ready without a second, coincidental mutation.
    observer.trigger()
    expect(rafQueue.size).toBe(1) // checkReady scheduled

    flushFrames() // consumes checkReady(): isReady() true -> schedules the settle frame
    expect(readyCalls).toBe(0)
    flushFrames() // consumes the settle frame -> onReady
    expect(readyCalls).toBe(10)
  })

  test("F6: root already ready when it appears — the container observer is disconnected, not left dangling", () => {
    const state = createReadyWatcher()
    let readyCalls = 0
    let root: ShadowRoot | undefined

    notifyShadowReady({
      state,
      container: fakeContainer,
      getRoot: () => root,
      isReady: () => true, // once a root exists, it's immediately ready
      onReady: () => {
        readyCalls += 1
      },
    })

    expect(FakeMutationObserver.instances.length).toBe(1)
    const containerObserver = FakeMutationObserver.instances[0]!
    expect(containerObserver.disconnected).toBe(false)

    // The shadow root appears, already ready (e.g. Pierre inserted it and
    // rendered synchronously before the next mutation batch).
    root = fakeRoot
    containerObserver.trigger()

    // FORK (CORRECTIF F6) pins this: observeRoot's ready branch must
    // disconnect the container observer, mirroring its not-ready branch.
    // Without the fix, this stays false and a later container mutation
    // re-triggers observeRoot -> runReady -> onReady (duplicate
    // scroll/watcher restoration).
    expect(containerObserver.disconnected).toBe(true)

    flushFrames() // settle frame -> onReady
    expect(readyCalls).toBe(1)
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
    observer.trigger() // schedules a coalesced ready-check frame (C8), not yet disconnected
    expect(observer.disconnected).toBe(false)
    expect(rafQueue.size).toBe(1)
    flushFrames() // consumes checkReady(): isReady() true -> disconnects, schedules settle frame
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
    flushFrames() // consume the initial measured-layout frame
    flushFrames() // first stability frame
    flushFrames() // second stability frame disconnects observation
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

// FORK (CORRECTIF F2, 2026-07-19): components/file.tsx's renderViewer()
// always creates a fresh render target initialized with lineAnnotations:[].
// The tracker must re-apply annotations whenever EITHER the target or the
// annotations array identity changes — reference equality on annotations
// alone is only a valid no-op signal when the target hasn't also changed.
describe("createAnnotationApplyTracker (F2 — annotation loss on instance replacement)", () => {
  function fakeTarget() {
    const calls: { setLineAnnotations: number; rerender: number } = { setLineAnnotations: 0, rerender: 0 }
    return {
      calls,
      setLineAnnotations: () => {
        calls.setLineAnnotations += 1
      },
      rerender: () => {
        calls.rerender += 1
      },
    }
  }

  test("new target, same annotations reference → still re-applies (the core F2 bug)", () => {
    const tracker = createAnnotationApplyTracker<ReturnType<typeof fakeTarget>, { line: number }>()
    const annotations = [{ line: 1 }]

    const t1 = fakeTarget()
    expect(tracker.apply(t1, annotations)).toBe(true)
    expect(t1.calls).toEqual({ setLineAnnotations: 1, rerender: 1 })

    // Simulates renderViewer() swapping in a fresh instance (e.g. a
    // post-save re-render) while the annotations prop is a stable/memoized
    // reference — the exact scenario that wiped line comments before F2.
    const t2 = fakeTarget()
    expect(tracker.apply(t2, annotations)).toBe(true)
    expect(t2.calls).toEqual({ setLineAnnotations: 1, rerender: 1 })
  })

  test("fresh target with no annotations skips the redundant force rerender", () => {
    const tracker = createAnnotationApplyTracker<ReturnType<typeof fakeTarget>, never>()
    const empty: never[] = []

    const t1 = fakeTarget()
    expect(tracker.apply(t1, empty)).toBe(false)
    expect(t1.calls).toEqual({ setLineAnnotations: 0, rerender: 0 })

    // Same target, same annotations reference again → no-op (this is the
    // guard Phase 6.4 introduced to avoid a redundant full re-render on
    // every content render).
    expect(tracker.apply(t1, empty)).toBe(false)
    expect(t1.calls).toEqual({ setLineAnnotations: 0, rerender: 0 })
  })

  test("same target, annotations reference changes → re-applies", () => {
    const tracker = createAnnotationApplyTracker<ReturnType<typeof fakeTarget>, { line: number }>()
    const t1 = fakeTarget()
    const a1 = [{ line: 1 }]
    const a2 = [{ line: 2 }]

    expect(tracker.apply(t1, a1)).toBe(true)
    expect(tracker.apply(t1, a2)).toBe(true)
    expect(t1.calls).toEqual({ setLineAnnotations: 2, rerender: 2 })
  })

  test("undefined target is a no-op", () => {
    const tracker = createAnnotationApplyTracker<ReturnType<typeof fakeTarget>, { line: number }>()
    expect(tracker.apply(undefined, [{ line: 1 }])).toBe(false)
  })
})
