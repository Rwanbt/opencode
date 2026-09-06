/* SPDX-License-Identifier: MIT */

// ADR-1041: the dev flag is removed. The Automate surface is reachable
// from the rail whenever the workspace has `workflow.run` granted; it
// is hidden otherwise. The capability check is the single gate.
//
// WHY a named predicate and not an inline `grants.has("workflow.run")`:
// the test suite (mode.test.ts) exercises the visibility transition
// without mounting the whole provider tree. A pure function with one
// input (the granted set) and one output (a boolean) is the right seam
// to test in isolation; the live `ModeContextProvider` uses the same
// function on the connection's `grants` signal.

/**
 * The capability the Automate surface is gated on (ADR-1041). Held
 * here so the predicate and the constant stay in lockstep — a future
 * rename of the capability in `p3.ts` would otherwise require two
 * edits in this file, easy to miss.
 */
export const AUTOMATE_CAPABILITY = "workflow.run"

/**
 * Pure predicate: does the supplied set of capability grants allow
 * the Automate surface to be reachable from the rail? `true` only
 * when the set contains `AUTOMATE_CAPABILITY`. The connection's
 * `grants` is the single source of truth at runtime; this function
 * is the unit-tested shape of the gate.
 */
export function isAutomateAccessible(grants: ReadonlySet<string>): boolean {
  return grants.has(AUTOMATE_CAPABILITY)
}
