// FORK (CORRECTIF F8, 2026-07-19): strictly monotonic epoch, never reset,
// distinguishing scope visits that per-path generation counters (see
// generation.ts) cannot — gen.clear() resets every path's counter to 0 on
// each scope change, so a directory round trip (A -> B -> A) can hand two
// DIFFERENT requests for the same path the SAME numeric generation. A
// captured epoch never repeats across the tracker's lifetime, so comparing
// against the current epoch correctly rejects a stale request regardless of
// how many scope changes happened while it was in flight, and regardless of
// which one resolves first.

export function createScopeEpochTracker() {
  let epoch = 0

  const bump = (): number => {
    epoch += 1
    return epoch
  }

  const capture = (): number => epoch

  const isCurrent = (captured: number): boolean => captured === epoch

  return { bump, capture, isCurrent }
}

export type ScopeEpochTracker = ReturnType<typeof createScopeEpochTracker>
