/* SPDX-License-Identifier: MIT */

export type PersistWriteMonitor = {
  record(key: string): void
}

type Options = {
  now?: () => number
  warn?: (message: string) => void
  windowMs?: number
  threshold?: number
}

type Burst = {
  startedAt: number
  count: number
  warned: boolean
}

const DEFAULT_WINDOW_MS = 1_000
const DEFAULT_THRESHOLD = 50

export function createPersistWriteMonitor(options: Options = {}): PersistWriteMonitor {
  const now = options.now ?? Date.now
  const warn = options.warn ?? console.warn
  const windowMs = options.windowMs ?? DEFAULT_WINDOW_MS
  const threshold = options.threshold ?? DEFAULT_THRESHOLD
  const bursts = new Map<string, Burst>()

  return {
    record(key) {
      const time = now()
      const burst = bursts.get(key)
      if (!burst || time < burst.startedAt || time - burst.startedAt >= windowMs) {
        bursts.set(key, { startedAt: time, count: 1, warned: false })
        return
      }

      burst.count += 1
      if (burst.count <= threshold || burst.warned) return
      burst.warned = true
      // "persist calls", not "writes": the workspace-tabs integration counts
      // REQUESTS upstream of its 50 ms debounce, while persist.ts counts the
      // synchronous write itself. One noun has to be true of both, and the
      // number a reader acts on is how often persistence was asked for.
      warn(
        `[persist] "${key}" reached ${burst.count} persist calls in ${windowMs} ms; possible reactive self-dependency`,
      )
    },
  }
}
