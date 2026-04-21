/**
 * DAG wave computation extracted from `team.ts` so tests can invoke the
 * production algorithm without pulling in the full agent/session runtime.
 *
 * Non-breaking: `team.ts` re-imports `computeWaves` from here; external
 * callers see no API change.
 */

/** Minimal task shape consumed by the wave scheduler. */
export interface WaveTask {
  depends_on?: number[]
}

/**
 * Group tasks into execution waves based on the dependency graph.
 *
 * Wave N contains tasks whose dependencies all live in waves < N.
 * Wave 0 contains tasks with no dependencies.
 *
 * Throws if the graph has a cycle or references an out-of-range index.
 */
export function computeWaves(tasks: WaveTask[]): number[][] {
  const n = tasks.length
  const assigned = new Array<number>(n).fill(-1)
  let changed = true

  while (changed) {
    changed = false
    for (let i = 0; i < n; i++) {
      if (assigned[i] >= 0) continue
      const deps = tasks[i].depends_on ?? []
      if (deps.length === 0) {
        assigned[i] = 0
        changed = true
      } else if (deps.every((d) => assigned[d] >= 0)) {
        assigned[i] = Math.max(...deps.map((d) => assigned[d])) + 1
        changed = true
      }
    }
  }

  if (assigned.some((w) => w < 0)) {
    throw new Error("Circular or invalid dependencies detected in task graph")
  }

  const maxWave = Math.max(...assigned)
  const waves: number[][] = []
  for (let w = 0; w <= maxWave; w++) {
    waves.push(assigned.map((wave, idx) => (wave === w ? idx : -1)).filter((idx) => idx >= 0))
  }
  return waves
}
