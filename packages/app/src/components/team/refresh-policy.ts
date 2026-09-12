// =============================================================================
// components/team/refresh-policy.ts — TEAM-M03
//
// When to refetch, and when to stop trying.
//
// Two acceptance criteria of this card live here — throttle and error recovery
// — and both are decisions rather than rendering, so they are written as
// functions that can be tested for what they conclude instead of being buried
// in an effect and verified by watching a screen.
// =============================================================================

import type { Reachability } from "@/context/team"

export const DEFAULT_THROTTLE_MS = 500
export const DEFAULT_MAX_ATTEMPTS = 5
export const DEFAULT_BASE_DELAY_MS = 500
export const DEFAULT_MAX_DELAY_MS = 30_000

/**
 * Whether an update should be applied now or held.
 *
 * A Team run emits events far faster than a person can read them, and applying
 * each one immediately spends the frame budget on renders nobody sees. Holding
 * is only safe because the caller keeps the deferred value and applies it at
 * the end of the window — a throttle that dropped updates would leave the last
 * one, the one that says the run finished, on the floor.
 */
export function shouldEmit(input: { lastEmitAt: number | undefined; now: number; intervalMs?: number }): boolean {
  if (input.lastEmitAt === undefined) return true
  const interval = input.intervalMs ?? DEFAULT_THROTTLE_MS
  return input.now - input.lastEmitAt >= interval
}

/**
 * How long to wait before the next attempt.
 *
 * Exponential with a ceiling: a server that is down stays down for minutes, and
 * a client retrying every 500ms for those minutes is a client attacking its own
 * backend. The ceiling is what keeps a long outage cheap.
 */
export function retryDelayMs(attempt: number, options?: { baseMs?: number; maxMs?: number }): number {
  const base = options?.baseMs ?? DEFAULT_BASE_DELAY_MS
  const max = options?.maxMs ?? DEFAULT_MAX_DELAY_MS
  if (attempt <= 0) return 0
  return Math.min(max, base * 2 ** (attempt - 1))
}

/**
 * Whether another attempt is worth making.
 *
 * `offline` and `unavailable` are conditions that pass: the network comes back,
 * the registry finishes loading. `error` is not — a 400 answers the same way
 * however many times it is asked, and retrying it turns a client bug into
 * sustained load with no chance of succeeding.
 */
export function shouldRetry(input: {
  reachability: Reachability
  attempt: number
  maxAttempts?: number
}): boolean {
  if (input.reachability === "ok") return false
  if (input.reachability === "error") return false
  return input.attempt < (input.maxAttempts ?? DEFAULT_MAX_ATTEMPTS)
}

export interface RecoveryPlan {
  readonly retry: boolean
  readonly delayMs: number
  /** True once retrying has been given up, so the surface can say so. */
  readonly exhausted: boolean
}

/**
 * The whole recovery decision in one answer.
 *
 * `exhausted` is carried separately from `retry` because "we are still trying"
 * and "we have stopped trying" are different things to show a user, and folding
 * them into a single false leaves a screen that quietly stops updating with no
 * explanation.
 */
export function planRecovery(input: {
  reachability: Reachability
  attempt: number
  maxAttempts?: number
  baseMs?: number
  maxMs?: number
}): RecoveryPlan {
  const retry = shouldRetry(input)
  const recoverable = input.reachability === "offline" || input.reachability === "unavailable"
  return {
    retry,
    delayMs: retry ? retryDelayMs(input.attempt + 1, { baseMs: input.baseMs, maxMs: input.maxMs }) : 0,
    exhausted: recoverable && !retry,
  }
}
