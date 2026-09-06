/* SPDX-License-Identifier: MIT */
/**
 * Timeout contracts (Plan V2.3.1 §200 M3-09, ADR-022).
 *
 * The IR encodes per-node and per-workflow timeouts in a single
 * discriminated union that the runtime can reason about. Three
 * kinds:
 *
 * - `none`: no timeout. The node can run as long as the workflow's
 *   overall deadline allows. This is the safe default for tasks
 *   that are naturally bounded by their inputs (e.g. an in-memory
 *   computation).
 * - `fixed`: a hard upper bound on the node's duration. The
 *   runtime kills the node at `maxDurationMs` and routes the
 *   failure per the workflow's failure policy.
 * - `deadline`: an absolute wall-clock deadline. The node must
 *   complete before `deadlineAt`. Useful when several nodes must
 *   collectively finish before a hard wall-clock time.
 *
 * Cross-reference: a `node.failurePolicy.kind = "ignore"` node
 * with a `deadline` will silently lose its output if the deadline
 * is hit. The schema does not enforce a richer interaction
 * (the runtime does) — but the cross-ref is documented here.
 *
 * ADR-022 (timer/timeout/cancellation) DECIDED.
 * ADR-000 (substrate) CHANGES_REQUIRED — runtime enforcement
 * depends on the substrate choice. This is a contract-only
 * change.
 */

import { z } from "zod"

/**
 * Maximum timeout duration allowed in a `fixed` or `deadline` config.
 * 24 hours is well above realistic workflow durations and well
 * below the storage / log noise threshold.
 */
export const TIMEOUT_MAX_DURATION_MS = 24 * 60 * 60 * 1000

/**
 * Per-node timeout config. Distinct from the workflow-level
 * `defaultTimeoutMs` (which lives in `WorkflowDefinitionSchema`).
 * When a node's config specifies `TimeoutConfig`, it overrides
 * the workflow default.
 */
export const TimeoutConfigSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("none"),
  }),
  z.object({
    kind: z.literal("fixed"),
    maxDurationMs: z
      .number()
      .int()
      .positive("timeout: maxDurationMs must be positive")
      .max(
        TIMEOUT_MAX_DURATION_MS,
        `timeout: maxDurationMs must be ≤ ${TIMEOUT_MAX_DURATION_MS}ms (24h)`,
      ),
  }),
  z.object({
    kind: z.literal("deadline"),
    /**
     * Absolute deadline as a Unix timestamp in milliseconds.
     * Must be strictly positive.
     */
    deadlineAt: z
      .number()
      .int()
      .positive("timeout: deadlineAt must be a positive Unix timestamp (ms)"),
  }),
])
export type TimeoutConfig = z.infer<typeof TimeoutConfigSchema>

/**
 * Validate the opaque `config` record of a node that opts into
 * the `TimeoutConfig` shape. Throws `z.ZodError` on failure.
 *
 * Like the M2 / M3 family validators (`parseControlIfConfig`,
 * `parseEffectNodeConfig`, ...), this is the trust-boundary
 * bridge between the IR's opaque `Node.config` and the typed
 * family-specific shape. Callers MUST go through this helper
 * before reading the `kind` discriminator — the type system
 * cannot enforce it because `config` is opaque.
 */
export function parseTimeoutConfig(config: unknown): TimeoutConfig {
  return TimeoutConfigSchema.parse(config)
}

/**
 * Resolve a `TimeoutConfig` to an effective wall-clock deadline
 * (Unix ms), given a start time. Pure function.
 *
 * - `kind: "none"`     → `null` (no deadline).
 * - `kind: "fixed"`    → `startMs + maxDurationMs`.
 * - `kind: "deadline"` → `deadlineAt` (start ignored).
 */
export function resolveEffectiveDeadline(
  config: TimeoutConfig,
  startMs: number,
): number | null {
  switch (config.kind) {
    case "none":
      return null
    case "fixed":
      return startMs + config.maxDurationMs
    case "deadline":
      return config.deadlineAt
  }
}
