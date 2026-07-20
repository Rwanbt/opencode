import { describe, expect, test } from "bun:test"
import { createScopeEpochTracker } from "./scope-epoch"

// FORK (CORRECTIF F8, 2026-07-19): pins the exact race context/file.tsx's
// load() closes — a directory round trip (A -> B -> A) where an old
// in-flight request for A and a new request for A both land on the same
// per-path generation number, so gen.isCurrent() alone can't tell them
// apart. scopeEpoch never resets, so it must.

describe("createScopeEpochTracker", () => {
  test("starts at 0 and bump() returns an increasing sequence", () => {
    const tracker = createScopeEpochTracker()
    expect(tracker.capture()).toBe(0)
    expect(tracker.bump()).toBe(1)
    expect(tracker.bump()).toBe(2)
    expect(tracker.bump()).toBe(3)
  })

  test("isCurrent is true only for the latest captured epoch", () => {
    const tracker = createScopeEpochTracker()
    const e1 = tracker.capture()
    expect(tracker.isCurrent(e1)).toBe(true)
    tracker.bump()
    expect(tracker.isCurrent(e1)).toBe(false)
  })

  test("A -> B -> A: an epoch captured before the round trip never matches again, regardless of resolution order", () => {
    // Old request for directory A captures the epoch before any scope change.
    const tracker = createScopeEpochTracker()
    const oldAEpoch = tracker.capture()

    // Scope changes to B, then back to A — each transition bumps once
    // (mirrors context/file.tsx's createEffect on `scope()`).
    tracker.bump() // A -> B
    tracker.bump() // B -> A
    const newAEpoch = tracker.capture()

    // The two requests captured different epochs even though both target
    // directory "A" — this is exactly what `scope() !== directory` cannot
    // distinguish (both would read "A" at resolution time).
    expect(oldAEpoch).not.toBe(newAEpoch)

    // Resolution order must not matter: whichever finishes first, only the
    // new request's epoch is current.
    expect(tracker.isCurrent(newAEpoch)).toBe(true)
    expect(tracker.isCurrent(oldAEpoch)).toBe(false)

    // Same assertions hold if checked in the opposite order (simulating the
    // old request resolving LAST, after the new one already applied).
    expect(tracker.isCurrent(oldAEpoch)).toBe(false)
    expect(tracker.isCurrent(newAEpoch)).toBe(true)
  })

  test("no scope change: two requests for the same visit share one epoch and both stay current", () => {
    const tracker = createScopeEpochTracker()
    const e1 = tracker.capture()
    const e2 = tracker.capture()
    expect(e1).toBe(e2)
    expect(tracker.isCurrent(e1)).toBe(true)
    expect(tracker.isCurrent(e2)).toBe(true)
  })
})
