// FORK (PLAN-READONLY-VIEWER-REACTIVITY C1/Phase 2): monotone generation
// counter per key. Guards against a slow/superseded async response (e.g. a
// backend fetch started before a newer seed or another fetch for the same
// key) overwriting fresher, already-applied data.
//
// Pattern: call `bump(key)` synchronously whenever new data for `key`
// becomes authoritative (a direct seed, or the start of a new fetch).
// Capture the returned generation number, then before applying an async
// response, check `isCurrent(key, gen)` — if it's no longer current, drop
// the response instead of applying it.

export function createGenerationTracker() {
  const generation = new Map<string, number>()

  const bump = (key: string): number => {
    const next = (generation.get(key) ?? 0) + 1
    generation.set(key, next)
    return next
  }

  const isCurrent = (key: string, gen: number): boolean => generation.get(key) === gen

  const current = (key: string): number | undefined => generation.get(key)

  const clear = () => generation.clear()

  return { bump, isCurrent, current, clear }
}

export type GenerationTracker = ReturnType<typeof createGenerationTracker>
