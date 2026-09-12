/* SPDX-License-Identifier: MIT */

import type { PersistWriteMonitor } from "@/utils/persist-write-monitor"

/** Milliseconds a burst is coalesced over before the state reaches storage. */
export const PERSIST_DEBOUNCE_MS = 50

export type DebouncedPersist<T> = {
  /** Records the request, then (re)arms the debounced write. */
  schedule(snapshot: T): void
  /** Cancels a pending write. Safe to call more than once. */
  dispose(): void
}

/**
 * Debounced persistence, with the write-storm counter on the REQUEST side.
 *
 * WHY the counter sits here and not next to `write`: the 50 ms debounce
 * coalesces a burst into at most 20 writes per second, so a 50/s threshold
 * placed after it is unreachable by construction — the guard could never fire
 * on the runaway it exists to catch. Four bounded reproductions failed for
 * exactly that reason before the arithmetic was noticed. A reactive
 * self-dependency is visible in how often persistence is *asked for*, which is
 * what `schedule` counts.
 *
 * WHY this is a module and not inline in the provider: the guard's sensitivity
 * has to be provable through the code the provider actually runs. Testing a
 * replica of this logic would prove the replica — the failure mode this whole
 * plan exists to prevent.
 */
export function createDebouncedPersist<T>(input: {
  key: string
  write: (snapshot: T) => void
  writes?: PersistWriteMonitor
  delayMs?: number
  setTimeoutImpl?: (fn: () => void, ms: number) => ReturnType<typeof setTimeout>
  clearTimeoutImpl?: (handle: ReturnType<typeof setTimeout>) => void
}): DebouncedPersist<T> {
  const delayMs = input.delayMs ?? PERSIST_DEBOUNCE_MS
  const arm = input.setTimeoutImpl ?? setTimeout
  const disarm = input.clearTimeoutImpl ?? clearTimeout
  let timer: ReturnType<typeof setTimeout> | undefined

  return {
    schedule(snapshot) {
      input.writes?.record(input.key)
      if (timer !== undefined) disarm(timer)
      timer = arm(() => input.write(snapshot), delayMs)
    },
    dispose() {
      if (timer === undefined) return
      disarm(timer)
      timer = undefined
    },
  }
}
