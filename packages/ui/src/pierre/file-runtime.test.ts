import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { clearReadyWatcher, createReadyWatcher, disposeReadyWatcher, notifyShadowReady } from "./file-runtime"

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
})

afterEach(() => {
  if (originalRaf) globalThis.requestAnimationFrame = originalRaf
  else delete (globalThis as { requestAnimationFrame?: unknown }).requestAnimationFrame
  if (originalCancelRaf) globalThis.cancelAnimationFrame = originalCancelRaf
  else delete (globalThis as { cancelAnimationFrame?: unknown }).cancelAnimationFrame
  if (originalMutationObserver) globalThis.MutationObserver = originalMutationObserver
  else delete (globalThis as { MutationObserver?: unknown }).MutationObserver
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
