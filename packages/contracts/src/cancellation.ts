/* SPDX-License-Identifier: MIT */
/* Copyright (c) 2026 Unifia contributors */

/**
 * Cancellation contracts (Plan V2.3.1 §200 M3-10, ADR-008, ADR-022).
 *
 * Cancellation is a **durable** signal: a cancellation request
 * survives a crash of the orchestrator. The state machine is
 * RUNNING → CANCELLING → CANCELLED | FAILED_TO_CANCEL.
 *
 * Why a discriminated union rather than a boolean: cancellation
 * has more than two outcomes. A handler may successfully clean up
 * (`CANCELLED`) or may refuse (`FAILED_TO_CANCEL`, the runtime
 * surfaces the run as failed). Collapsing to boolean loses this
 * signal and is exactly the bug pattern that "did we cancel or
 * not?" reporting usually hides.
 *
 * ADR-008 (scheduler) DECIDED.
 * ADR-022 (timer) DECIDED.
 * ADR-000 (substrate) CHANGES_REQUIRED — runtime propagation
 * depends on the substrate choice. This is a contract-only change.
 */
import { z } from "zod"

/* ------------------------------------------------------------------ */
/* Constants                                                          */
/* ------------------------------------------------------------------ */

/**
 * Hard cap on the length of a `CancellationToken` string.
 * 256 chars is a generous ceiling for an opaque id (UUIDs fit in
 * 36, ULIDs in 26, anything beyond 256 chars is almost certainly
 * a mis-encoded payload). The runtime treats the token as opaque
 * (no format guarantee) — workflow authors see it in audit logs
 * and can match on it but should not parse it. This matches the
 * M0 I2 `EffectId` convention.
 */
export const CANCELLATION_TOKEN_MAX_CHARS = 256

/**
 * Hard cap on the length of the optional human-readable `note`
 * on a `CancellationRequest`. 280 chars is the same bound used
 * for `description` fields on control / effect node configs —
 * it is metadata for an inspector UI, not a documentation field.
 */
export const CANCELLATION_NOTE_MAX_CHARS = 280

/**
 * Default grace period (ms) a `cleanup` handler gets to release
 * resources before the runtime force-kills the node. 30 seconds
 * is a generous ceiling for an in-process cleanup (close a file
 * handle, drain a buffer, mark a row) and short enough that a
 * stuck run does not block the worker's slot indefinitely.
 */
export const CANCELLATION_CLEANUP_DEFAULT_MS = 30_000

/**
 * Hard cap on `maxCleanupMs`. 60 seconds is the absolute ceiling;
 * a cleanup that needs more than a minute is almost certainly
 * stuck (the right answer is to fail-fast, not to wait).
 */
export const CANCELLATION_CLEANUP_MAX_MS = 60_000

/**
 * Hard cap on the length of the optional `description` on a
 * `NodeCancellationConfig`. 280 chars — same bound as the
 * `note` above and the `CONTROL_*_DESCRIPTION_MAX_CHARS` family.
 */
export const NODE_CANCELLATION_DESCRIPTION_MAX_CHARS = 280

/* ------------------------------------------------------------------ */
/* CancellationToken                                                  */
/* ------------------------------------------------------------------ */

/**
 * A unique identifier for a cancellation request. The runtime
 * assigns one when a request enters the durable state. ADR-008.
 *
 * The token is **opaque** (no format guarantee) — workflow
 * authors see it in audit logs and can match on it but should
 * not parse it. This matches the M0 I2 `EffectId` convention.
 */
export const CancellationTokenSchema = z
  .string()
  .min(1, "cancellation: token must be non-empty")
  .max(
    CANCELLATION_TOKEN_MAX_CHARS,
    `cancellation: token must be ≤ ${CANCELLATION_TOKEN_MAX_CHARS} chars`,
  )
  .brand<"CancellationToken">()
export type CancellationToken = z.infer<typeof CancellationTokenSchema>

/**
 * Brand an opaque string as a `CancellationToken`. Throws
 * `ZodError` on failure (empty string, > 256 chars). Use at the
 * trust boundary (after the token has been issued by the runtime
 * and is being recorded in audit logs / handed off to consumers).
 */
export function asCancellationToken(value: string): CancellationToken {
  return CancellationTokenSchema.parse(value)
}

/* ------------------------------------------------------------------ */
/* CancellationState                                                  */
/* ------------------------------------------------------------------ */

/**
 * The state of a run with respect to cancellation. ADR-008.
 *
 * - `RUNNING`: no cancellation requested. The default.
 * - `CANCELLING`: a cancellation request was received; the
 *   runtime is walking the graph to invoke handlers.
 * - `CANCELLED`: all handlers completed; the run is durably
 *   marked as cancelled.
 * - `FAILED_TO_CANCEL`: a handler refused or threw; the runtime
 *   surfaces the run as failed (and the run is not retried).
 */
export const CancellationStateSchema = z.enum([
  "RUNNING",
  "CANCELLING",
  "CANCELLED",
  "FAILED_TO_CANCEL",
])
export type CancellationState = z.infer<typeof CancellationStateSchema>

/* ------------------------------------------------------------------ */
/* CancellationReason                                                 */
/* ------------------------------------------------------------------ */

/**
 * Why a cancellation was requested. The runtime logs this in
 * the audit trail. ADR-008.
 *
 * - `user`: explicit user request (UI button, API call).
 * - `system`: the system itself cancelled (e.g. workflow
 *   deadline exceeded, quota exhausted).
 * - `parent`: a parent workflow cancelled a child workflow.
 *   Propagates through the call graph.
 * - `timeout`: a per-node or per-workflow timeout fired.
 */
export const CancellationReasonSchema = z.enum([
  "user",
  "system",
  "parent",
  "timeout",
])
export type CancellationReason = z.infer<typeof CancellationReasonSchema>

/* ------------------------------------------------------------------ */
/* CancellationRequest                                                */
/* ------------------------------------------------------------------ */

/**
 * A request to cancel a workflow run. Persisted durably; survives
 * orchestrator crashes. The runtime assigns the token and the
 * state transitions to `CANCELLING`.
 */
export const CancellationRequestSchema = z.object({
  token: CancellationTokenSchema,
  workflowRunId: z
    .string()
    .min(1, "cancellation: workflowRunId must be a non-empty run id"),
  requestedAt: z
    .number()
    .int()
    .nonnegative(
      "cancellation: requestedAt must be a non-negative Unix timestamp (ms)",
    ),
  reason: CancellationReasonSchema,
  /**
   * Optional human-readable note. Capped at 280 chars.
   */
  note: z
    .string()
    .max(
      CANCELLATION_NOTE_MAX_CHARS,
      `cancellation: note must be ≤ ${CANCELLATION_NOTE_MAX_CHARS} chars`,
    )
    .optional(),
})
export type CancellationRequest = z.infer<typeof CancellationRequestSchema>

export function parseCancellationRequest(
  config: unknown,
): CancellationRequest {
  return CancellationRequestSchema.parse(config)
}

/* ------------------------------------------------------------------ */
/* CancellationHandler                                                */
/* ------------------------------------------------------------------ */

/**
 * How a node reacts when the run is cancelled. ADR-008.
 *
 * - `ignore`: the node keeps running; cancellation is recorded
 *   but does not interrupt this node. Useful for nodes that
 *   must complete (e.g. a payment capture that already started).
 *   Forbidden on a node that is a `child workflow` whose parent
 *   is being cancelled with reason `parent` (propagation is
 *   unconditional in that case).
 * - `cleanup`: the node receives a cancellation signal, has
 *   a bounded time (`maxCleanupMs`, default 30s, max 60s) to
 *   release resources, then is force-killed.
 * - `fail`: the node fails immediately with a `CancellationError`.
 *   The workflow's failure policy applies.
 * - `compensate`: the node's compensation (M3-07) is invoked,
 *   then the node is marked cancelled. Requires the node to
 *   have a `CompensationBinding` (cross-ref documented; the
 *   schema does not enforce it because the cross-ref is across
 *   files).
 */
export const CancellationHandlerSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("ignore") }),
  z.object({
    kind: z.literal("cleanup"),
    maxCleanupMs: z
      .number()
      .int()
      .nonnegative("cancellation: maxCleanupMs must be ≥ 0")
      .max(
        CANCELLATION_CLEANUP_MAX_MS,
        `cancellation: maxCleanupMs must be ≤ ${CANCELLATION_CLEANUP_MAX_MS}ms`,
      )
      .default(CANCELLATION_CLEANUP_DEFAULT_MS),
  }),
  z.object({ kind: z.literal("fail") }),
  z.object({ kind: z.literal("compensate") }),
])
export type CancellationHandler = z.infer<typeof CancellationHandlerSchema>

export function parseCancellationHandler(
  config: unknown,
): CancellationHandler {
  return CancellationHandlerSchema.parse(config)
}

/* ------------------------------------------------------------------ */
/* NodeCancellationConfig                                             */
/* ------------------------------------------------------------------ */

/**
 * The combined node-level cancellation config. Couples a node's
 * `CancellationHandler` with the cross-cutting state.
 *
 * The `compensate` handler is documented as requiring a
 * `CompensationBinding` to be useful — the schema doesn't
 * enforce that (the cross-ref is across files), but the runtime
 * does. The schema also doesn't forbid `ignore` on a child
 * workflow whose parent is being cancelled with reason
 * `parent` — that's a runtime rule, not a contract one.
 */
export const NodeCancellationConfigSchema = z.object({
  handler: CancellationHandlerSchema,
  /**
   * Optional human-readable description of the cancellation
   * behavior for inspector UIs. Capped at 280 chars.
   */
  description: z
    .string()
    .max(
      NODE_CANCELLATION_DESCRIPTION_MAX_CHARS,
      `cancellation: description must be ≤ ${NODE_CANCELLATION_DESCRIPTION_MAX_CHARS} chars`,
    )
    .optional(),
})
export type NodeCancellationConfig = z.infer<typeof NodeCancellationConfigSchema>

export function parseNodeCancellationConfig(
  config: unknown,
): NodeCancellationConfig {
  return NodeCancellationConfigSchema.parse(config)
}
