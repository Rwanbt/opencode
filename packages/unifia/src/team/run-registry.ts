export interface TeamRunControl {
  readonly signal: AbortSignal
  waitUntilRunnable(): Promise<void>
}

interface Entry {
  readonly controller: AbortController
  readonly release: Set<() => void>
  paused: boolean
  parentAbort?: () => void
}

export const MAX_ACTIVE_TEAM_RUNS = 4

export class TeamRunRegistry {
  readonly #active = new Map<string, Entry>()

  constructor(private readonly maxActiveRuns = MAX_ACTIVE_TEAM_RUNS) {
    if (!Number.isInteger(maxActiveRuns) || maxActiveRuns < 1) throw new RangeError("maxActiveRuns must be a positive integer")
  }

  register(runId: string, parentSignal?: AbortSignal): TeamRunControl {
    if (!runId.trim()) throw new TypeError("runId must not be empty")
    if (this.#active.has(runId)) throw new Error(`Team run ${runId} is already active`)
    if (this.#active.size >= this.maxActiveRuns) throw new Error(`Team active run limit reached (${this.maxActiveRuns})`)
    const entry: Entry = { controller: new AbortController(), release: new Set(), paused: false }
    if (parentSignal) {
      entry.parentAbort = () => entry.controller.abort(parentSignal.reason)
      if (parentSignal.aborted) entry.parentAbort()
      else parentSignal.addEventListener("abort", entry.parentAbort, { once: true })
    }
    this.#active.set(runId, entry)
    return {
      signal: entry.controller.signal,
      async waitUntilRunnable() {
        if (!entry.paused || entry.controller.signal.aborted) return
        await new Promise<void>((resolve) => {
          let settled = false
          const release = () => {
            if (settled) return
            settled = true
            entry.release.delete(release)
            entry.controller.signal.removeEventListener("abort", release)
            resolve()
          }
          entry.release.add(release)
          entry.controller.signal.addEventListener("abort", release, { once: true })
        })
      },
    }
  }

  activeCount(): number {
    return this.#active.size
  }

  pause(runId: string): boolean {
    const entry = this.#active.get(runId)
    if (!entry || entry.controller.signal.aborted) return false
    entry.paused = true
    return true
  }

  resume(runId: string): boolean {
    const entry = this.#active.get(runId)
    if (!entry || entry.controller.signal.aborted) return false
    entry.paused = false
    for (const release of [...entry.release]) release()
    return true
  }

  cancel(runId: string): boolean {
    const entry = this.#active.get(runId)
    if (!entry) return false
    entry.controller.abort(new Error(`Team run ${runId} cancelled`))
    for (const release of [...entry.release]) release()
    return true
  }

  status(runId: string): "running" | "paused" | "cancelled" | null {
    const entry = this.#active.get(runId)
    if (!entry) return null
    if (entry.controller.signal.aborted) return "cancelled"
    return entry.paused ? "paused" : "running"
  }

  finish(runId: string, parentSignal?: AbortSignal): void {
    const entry = this.#active.get(runId)
    if (!entry) return
    if (parentSignal && entry.parentAbort) parentSignal.removeEventListener("abort", entry.parentAbort)
    for (const release of [...entry.release]) release()
    this.#active.delete(runId)
  }
}
