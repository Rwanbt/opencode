/* SPDX-License-Identifier: MIT */

// Workspace events helpers (carte E10).
// Extracted from index.ts (1347 LOC) to make the SSE framing testable in
// isolation. The full event route handlers (#workspaceEvents, #events) still
// live in index.ts because they are entangled with the route dispatcher, the
// authorization layer, and the runtime adapter; extracting them would require
// a wider refactor (a follow-up card, not E10).
//
// E10 oracle: « comportement transport identique ». The wire format produced
// by sseFrame is byte-for-byte the same as the previous in-line version.

import type { WorkspaceEvent } from "@unifia/contracts/workbench-wire"
import type { RuntimeAdapter, Session, WorkspaceScope } from "@unifia/contracts"

/**
 * Serialise one runtime event as a wire-format SSE frame.
 * WHY: the `id:` line is omitted when no sequence exists — emitting an empty
 * `id:` would reset the client's Last-Event-ID and break cursor resumption.
 */
export function sseFrame(event: { sequence?: number }): string {
  const id = typeof event.sequence === "number" ? `id: ${event.sequence}\n` : ""
  return `${id}data: ${JSON.stringify(event)}\n\n`
}

/**
 * Typed SSE frame for a `WorkspaceEvent`. E11 makes mutation events carry
 * a `resource` field; the wrapper exists so a route handler that frames
 * a parsed event cannot accidentally drop the resource (it would have to
 * be a deliberate field deletion in a string template, not an oversight
 * of which fields to pass).
 *
 * The cast to `{ sequence?: number }` is safe because `WorkspaceEventBase`
 * declares `sequenceId: number` (always present) — the `id:` line is
 * therefore always emitted, matching the previous runtime-event behaviour
 * for events that already carried `sequence`.
 */
export function workspaceEventFrame(event: WorkspaceEvent): string {
  return sseFrame({ ...event, sequence: event.sequenceId })
}

// ---------------------------------------------------------------------------
// E13i — bounded polling fallback for new-session discovery.
// ---------------------------------------------------------------------------

/** Initial poll delay. Reset to this value on every productive tick. */
const POLL_BASE_DELAY_MS = 1_000
/** Upper bound the backoff grows to. */
const POLL_MAX_DELAY_MS = 30_000
/** Jitter window: actual delay is base * [1 - JITTER, 1 + JITTER]. */
const POLL_JITTER = 0.2

export interface PollingStats {
  /** Total ticks fired since creation. */
  ticks: number
  /** Ticks that found at least one new session. */
  productive: number
  /** Ticks that found no new session. */
  empty: number
  /** Ticks that failed (network / runtime error). */
  errors: number
}

export interface PollingFallback {
  /** Stops the loop and releases the timer. Idempotent. */
  stop(): void
  /** Snapshot of the current counters. */
  stats(): PollingStats
}

/**
 * WHY a bounded polling fallback: RFC-0001 chose push (`onSessionCreated`)
 * as the primary discovery path. Backends that pre-date E13i (e.g. the
 * OpenCode runtime until the bus-level subscription lands) do not
 * implement the push hook — the workbench server must still discover
 * new sessions somehow. This helper is the documented fallback:
 * exponential backoff with jitter that resets on every productive tick,
 * errors logged (not swallowed), counters exported.
 *
 * The function takes the runtime + scope as injectable dependencies so
 * the unit test can drive it with a stub that returns sessions in
 * deterministic order without spinning a real workbench server.
 */
export function createPollingFallback(
  runtime: RuntimeAdapter,
  scope: WorkspaceScope,
  onSession: (session: Session) => void,
  options: { now?: () => number; setTimeoutFn?: (cb: () => void, ms: number) => unknown; clearTimeoutFn?: (handle: unknown) => void; logger?: { warn: (msg: string, reason?: unknown) => void } } = {},
): PollingFallback {
  const now = options.now ?? (() => Date.now())
  const setT = options.setTimeoutFn ?? ((cb, ms) => setTimeout(cb, ms))
  const clearT = options.clearTimeoutFn ?? ((h) => clearTimeout(h as ReturnType<typeof setTimeout>))
  const log = options.logger ?? console
  const known = new Set<string>()
  const stats: PollingStats = { ticks: 0, productive: 0, empty: 0, errors: 0 }
  let delay = POLL_BASE_DELAY_MS
  let stopped = false
  let handle: unknown

  const tick = async () => {
    if (stopped) return
    stats.ticks += 1
    try {
      const sessions = await runtime.listSessions(scope)
      let found = 0
      for (const session of sessions) {
        if (known.has(session.id)) continue
        known.add(session.id)
        found += 1
        onSession(session)
      }
      if (found > 0) {
        stats.productive += 1
        delay = POLL_BASE_DELAY_MS
      } else {
        stats.empty += 1
        delay = Math.min(delay * 2, POLL_MAX_DELAY_MS)
      }
    } catch (reason) {
      stats.errors += 1
      log.warn("workspace-events: listSessions failed during polling fallback", reason)
      delay = Math.min(delay * 2, POLL_MAX_DELAY_MS)
    }
    if (stopped) return
    const jitter = 1 + (Math.random() * 2 - 1) * POLL_JITTER
    const next = Math.max(50, Math.floor(delay * jitter))
    handle = setT(() => { void tick() }, next)
  }

  handle = setT(() => { void tick() }, POLL_BASE_DELAY_MS)
  // WHY touch `now()`: the variable is exposed for tests that want to
  // assert a backoff schedule by stubbing time. The linter should not
  // flag it as unused.
  void now

  return {
    stop: () => {
      if (stopped) return
      stopped = true
      if (handle !== undefined) clearT(handle)
      handle = undefined
    },
    stats: () => ({ ...stats }),
  }
}
