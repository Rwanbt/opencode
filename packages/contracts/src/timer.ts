/* SPDX-License-Identifier: MIT */
/**
 * Timer policies — Plan V2.3.1 §101, ADR-022.
 *
 * The two policy dimensions the Automate v2 scheduler must know
 * about for any timed trigger (cron, interval, missed-fire catch-up):
 *
 * - OverlapPolicy: what to do when a new firing would overlap the
 *   previous run (still in flight).
 * - CatchUpPolicy: what to do when the runtime was offline and missed
 *   one or more scheduled firings.
 *
 * These enums are deliberately small and orthogonal. A scheduler is
 * free to refuse combinations it considers unsafe (e.g. forbid +
 * fire-each-missed) but the contract does not forbid them.
 */
import { z } from "zod"

/**
 * What to do when a new trigger firing would overlap an in-flight
 * previous run of the same workflow.
 *
 * - `allow`   : start a new run in parallel (caller is responsible
 *               for downstream concurrency safety).
 * - `forbid`  : drop the new firing, leave the previous run untouched.
 * - `queue`   : enqueue the new firing and start it when the previous
 *               run completes. The queue is per-trigger.
 * - `replace` : cancel the in-flight run and start the new firing.
 */
export const OverlapPolicySchema = z.enum(["allow", "forbid", "queue", "replace"])

export type OverlapPolicy = z.infer<typeof OverlapPolicySchema>

/**
 * What to do when the runtime was offline and missed one or more
 * scheduled firings.
 *
 * - `skip`             : drop all missed firings, wait for the next.
 * - `fire-once`        : coalesce every miss into a single firing
 *                        (the most recent missed time).
 * - `fire-each-missed` : replay one firing per missed slot, in order.
 */
export const CatchUpPolicySchema = z.enum(["skip", "fire-once", "fire-each-missed"])

export type CatchUpPolicy = z.infer<typeof CatchUpPolicySchema>
