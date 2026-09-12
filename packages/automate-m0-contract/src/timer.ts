/* SPDX-License-Identifier: MIT */
/* Copyright (c) 2026 Unifia contributors */

/**
 * Durable timer contract (ADR-000 §32).
 *
 * A timer is where a durable engine's honesty about time gets tested. The
 * two properties that matter are both about what must *not* happen:
 *
 *   - a `FIRED` timer must never return to `PENDING` (§32) — otherwise a
 *     restart can replay whatever the firing triggered;
 *   - moving the wall clock backwards must not refire an already-fired
 *     timer (§32, FC-15) — otherwise the engine's notion of "already done"
 *     is only as trustworthy as the machine's NTP client.
 *
 * A subtlety §32 spells out and that is easy to lose: `ELIGIBLE` does not
 * mean the external effect the timer triggers has completed. It means the
 * timer's own deadline has passed. Conflating the two would make a crash
 * between "eligible" and "dispatched" look like a completed firing.
 */
import type { CanonicalTimestamp } from "./value.js"
import type { DurableTimerId } from "./ids.js"

/* ------------------------------------------------------------------ */
/* States (§32)                                                        */
/* ------------------------------------------------------------------ */

export const DURABLE_TIMER_STATES = [
  "PENDING",
  "ELIGIBLE",
  "FIRED",
  "CANCELLED",
  "EXPIRED",
] as const

export type DurableTimerState = (typeof DURABLE_TIMER_STATES)[number]

/** Terminal states: nothing leaves them. */
export const TERMINAL_TIMER_STATES: ReadonlySet<DurableTimerState> = new Set([
  "FIRED",
  "CANCELLED",
  "EXPIRED",
])

/**
 * What to do with a deadline that elapsed while the authority was down.
 * M0 fixes the policy to `FIRE_ON_RECOVERY` (§32); the enum exists so a
 * candidate cannot quietly implement a different one and call it the same.
 */
export const MISSED_TIMER_POLICIES = ["FIRE_ON_RECOVERY"] as const
export type MissedTimerPolicy = (typeof MISSED_TIMER_POLICIES)[number]

export interface DurableTimer {
  readonly timerId: DurableTimerId
  readonly createdAt: CanonicalTimestamp
  readonly notBefore: CanonicalTimestamp
  readonly state: DurableTimerState
  readonly missedTimerPolicy: MissedTimerPolicy
}

export class TimerContractError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "TimerContractError"
  }
}

/* ------------------------------------------------------------------ */
/* Legal transitions                                                   */
/* ------------------------------------------------------------------ */

/**
 * The complete transition table. Written out rather than derived, because
 * the invariant this file exists to protect is a *missing* edge —
 * `FIRED → PENDING` — and an absent edge is only obvious when the present
 * ones are enumerated.
 */
const LEGAL_TRANSITIONS: Readonly<Record<DurableTimerState, readonly DurableTimerState[]>> = {
  PENDING: ["ELIGIBLE", "CANCELLED", "EXPIRED"],
  ELIGIBLE: ["FIRED", "CANCELLED", "EXPIRED"],
  FIRED: [],
  CANCELLED: [],
  EXPIRED: [],
}

export function isLegalTimerTransition(
  from: DurableTimerState,
  to: DurableTimerState,
): boolean {
  return (LEGAL_TRANSITIONS[from] as readonly DurableTimerState[]).includes(to)
}

export function assertLegalTimerTransition(
  from: DurableTimerState,
  to: DurableTimerState,
): void {
  if (isLegalTimerTransition(from, to)) return
  if (from === "FIRED" && to === "PENDING") {
    throw new TimerContractError(
      "a FIRED timer must not return to PENDING (§32) — this is the invariant that stops a restart replaying a firing",
    )
  }
  if (TERMINAL_TIMER_STATES.has(from)) {
    throw new TimerContractError(`${from} is terminal; no transition to ${to} is legal`)
  }
  throw new TimerContractError(`illegal timer transition ${from} → ${to}`)
}

/* ------------------------------------------------------------------ */
/* Recovery evaluation (§32, FC-15, FC-16, FC-17)                      */
/* ------------------------------------------------------------------ */

/**
 * Decide a timer's state after a restart or resume, given the authority's
 * own notion of time.
 *
 * `authoritativeTime` is deliberately a parameter, not a call to
 * `Date.now()`. §32 permits an implementation to use a monotonic clock
 * internally, and the harness must be able to drive time to test FC-15
 * (clock backwards) and FC-16 (clock forwards). A module that read the
 * wall clock itself would be untestable for exactly the properties that
 * matter most.
 *
 * The rule (§32, policy `FIRE_ON_RECOVERY`): a non-terminal timer whose
 * `notBefore` has been reached becomes `ELIGIBLE`. A terminal timer is
 * returned untouched — which is what makes moving the clock backwards a
 * no-op on an already-`FIRED` timer.
 */
export function evaluateTimerOnRecovery(
  timer: DurableTimer,
  authoritativeTime: CanonicalTimestamp,
): DurableTimer {
  if (TERMINAL_TIMER_STATES.has(timer.state)) return timer
  if (timer.state === "ELIGIBLE") return timer
  return authoritativeTime >= timer.notBefore ? { ...timer, state: "ELIGIBLE" } : timer
}

/**
 * Well-formedness of a timer as persisted.
 *
 * `notBefore < createdAt` is rejected: a deadline in the past relative to
 * the timer's own creation is not a scheduling choice, it is a corrupted
 * or mis-derived record, and FC-20 asks that such a record be detected
 * rather than acted on.
 */
export function assertWellFormedTimer(timer: DurableTimer): void {
  if (!DURABLE_TIMER_STATES.includes(timer.state)) {
    throw new TimerContractError(`unknown timer state: ${String(timer.state)}`)
  }
  if (!MISSED_TIMER_POLICIES.includes(timer.missedTimerPolicy)) {
    throw new TimerContractError(
      `unknown missedTimerPolicy: ${String(timer.missedTimerPolicy)}`,
    )
  }
  if (!Number.isInteger(timer.createdAt) || !Number.isInteger(timer.notBefore)) {
    throw new TimerContractError("createdAt and notBefore must be exact epoch milliseconds")
  }
  if (timer.notBefore < timer.createdAt) {
    throw new TimerContractError(
      `notBefore (${timer.notBefore}) precedes createdAt (${timer.createdAt})`,
    )
  }
}
