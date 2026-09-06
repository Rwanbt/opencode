/* SPDX-License-Identifier: MIT */
import { z } from "zod"

import { EffectNodeConfigSchema } from "./workflow-effect.js"

/* Effect node config — M3-04 (retry, ADR-007 / ADR-008)               */
/* ------------------------------------------------------------------ */

/**
 * Hard cap on `backoffMs` for any single retry delay. 60s keeps a
 * single retry bounded even when the caller typos a number. A
 * workflow that legitimately needs a longer backoff must use
 * `maxBackoffMs` (which is itself capped at the same ceiling).
 */
export const CONTROL_RETRY_BACKOFF_MAX_MS = 60_000

/**
 * Hard cap on the number of retry attempts an IR config can request.
 * 100 is well above any sensible operational ceiling (a flaky external
 * API that needs 100 retries is a real problem, not a workflow
 * configuration) and below the point where retries would dominate
 * the run's lifetime even with exponential backoff.
 */
export const CONTROL_RETRY_MAX_ATTEMPTS = 100

/**
 * Backoff strategy for a retry sequence. ADR-007, ADR-008.
 *
 * - `fixed`               : every retry waits `backoffMs`.
 * - `exponential`         : retry n waits `backoffMs * 2^(n-1)`,
 *                           capped by `maxBackoffMs` when set.
 * - `decorrelated-jitter` : retry n waits a random value in
 *                           `[backoffMs, prevWait * 3]` (the
 *                           AWS architecture-blog recipe). Capped
 *                           by `maxBackoffMs` when set.
 */
export const RetryBackoffKindSchema = z.enum(["fixed", "exponential", "decorrelated-jitter"])
export type RetryBackoffKind = z.infer<typeof RetryBackoffKindSchema>

/**
 * Retry policy attached to an effect node (or to a workflow as a
 * whole). Overlaps with `FailurePolicySchema` (M1): when both are
 * set, the node-level `RetryPolicy` wins. The runtime evaluates
 * this config; the contract only validates its shape and bounds.
 * ADR-007, ADR-008.
 */
export const RetryPolicySchema = z.object({
  kind: RetryBackoffKindSchema,
  maxAttempts: z
    .number()
    .int()
    .positive("retry: maxAttempts must be ≥ 1")
    .max(
      CONTROL_RETRY_MAX_ATTEMPTS,
      `retry: maxAttempts must be ≤ ${CONTROL_RETRY_MAX_ATTEMPTS}`,
    ),
  backoffMs: z
    .number()
    .int()
    .nonnegative("retry: backoffMs must be ≥ 0")
    .max(
      CONTROL_RETRY_BACKOFF_MAX_MS,
      `retry: backoffMs must be ≤ ${CONTROL_RETRY_BACKOFF_MAX_MS}ms`,
    )
    .default(1000),
  maxBackoffMs: z
    .number()
    .int()
    .nonnegative()
    .max(CONTROL_RETRY_BACKOFF_MAX_MS)
    .optional(),
  jitterRatio: z
    .number()
    .min(0, "retry: jitterRatio must be ≥ 0")
    .max(1, "retry: jitterRatio must be ≤ 1")
    .default(0.25),
})
export type RetryPolicy = z.infer<typeof RetryPolicySchema>

/**
 * Validate the opaque `retry` config of a node. Throws
 * `z.ZodError` on failure. Same trust-boundary contract as the
 * other `parseControl*Config` helpers.
 */
export function parseRetryPolicy(config: unknown): RetryPolicy {
  return RetryPolicySchema.parse(config)
}

/* ------------------------------------------------------------------ */
/* Effect node config — M3-05 (reconciliation, ADR-007)                */
/* ------------------------------------------------------------------ */

/**
 * Hard cap on the length of a reconciliation `probeExpression`.
 * 1024 chars is a generous ceiling for a single-line API query
 * (e.g. `GET /v1/charges/${id}`); longer values almost always
 * indicate the author meant to put a script somewhere else.
 */
export const RECONCILIATION_PROBE_MAX_CHARS = 1024

/**
 * What the probe MUST observe for the run to continue. ADR-007.
 *
 * - `absent`  : the external resource must NOT exist (use case:
 *              "I'm about to create a charge, so the probe must
 *              return 404 — if it returns 200, a previous run
 *              already created it and we should not double-charge").
 * - `present` : the external resource MUST exist (use case:
 *              "I tried to refund, so the probe must return the
 *              refunded charge — if it returns the original
 *              charge, the refund never landed").
 * - `error`   : the probe MUST observe an explicit error
 *              (4xx/5xx, or a typed error returned by the SDK).
 */
export const ReconcileExpectedResultSchema = z.enum(["absent", "present", "error"])
export type ReconcileExpectedResult = z.infer<typeof ReconcileExpectedResultSchema>

/**
 * When the probe's actual result does not match `expectedResult`,
 * how loud should the failure be. ADR-007.
 *
 * - `unexpected_present`  : fail only if the resource exists when
 *                          it shouldn't.
 * - `unexpected_absent`   : fail only if the resource is missing
 *                          when it should exist.
 * - `any_mismatch`        : fail on either direction.
 */
export const ReconcileFailOnSchema = z.enum(["unexpected_present", "unexpected_absent", "any_mismatch"])
export type ReconcileFailOn = z.infer<typeof ReconcileFailOnSchema>

/**
 * Reconciliation config attached to an effect node. A non-idempotent
 * effect can opt into a probe-based replay strategy: before retrying,
 * the runtime asks the external system "is the resource already
 * there?". The shape of the question and the expected answer live
 * here. ADR-007.
 */
export const ReconciliationConfigSchema = z.object({
  probeExpression: z
    .string()
    .min(1, "reconciliation: probeExpression must be non-empty")
    .max(
      RECONCILIATION_PROBE_MAX_CHARS,
      `reconciliation: probeExpression must be ≤ ${RECONCILIATION_PROBE_MAX_CHARS} chars`,
    ),
  expectedResult: ReconcileExpectedResultSchema,
  failOn: ReconcileFailOnSchema,
})
export type ReconciliationConfig = z.infer<typeof ReconciliationConfigSchema>

/**
 * Validate the opaque `reconciliation` config of a node. Throws
 * `z.ZodError` on failure. Same trust-boundary contract as the
 * other `parseControl*Config` helpers.
 */
export function parseReconciliationConfig(config: unknown): ReconciliationConfig {
  return ReconciliationConfigSchema.parse(config)
}

/* ------------------------------------------------------------------ */
/* Effect node config — M3-06 (UNKNOWN_EXTERNAL_STATE, ADR-007/009)   */
/* ------------------------------------------------------------------ */

/**
 * What the runtime should do when a probe (or a side effect) returns
 * a state the runtime cannot classify (timeout, 5xx without body,
 * ambiguous SDK error). ADR-007, ADR-009.
 *
 * - `FAIL`            : surface a hard error to the workflow. The
 *                       author has decided the run cannot continue
 *                       without a human in the loop.
 * - `RECONCILE_PROBE` : run a fresh `reconciliation.probeExpression`
 *                       and apply its `expectedResult` / `failOn`
 *                       rule. This is the safe default for any
 *                       non-idempotent effect.
 * - `RECONCILE_REPLAY` : treat the side effect as if it had not run
 *                       and re-dispatch it. The runtime requires
 *                       `idempotency != NONE` for this action — a
 *                       non-idempotent replay is the exact failure
 *                       mode the contract exists to prevent. The
 *                       `refine` below encodes that rule.
 */
export const UnknownExternalStateActionSchema = z.enum([
  "FAIL",
  "RECONCILE_PROBE",
  "RECONCILE_REPLAY",
])
export type UnknownExternalStateAction = z.infer<typeof UnknownExternalStateActionSchema>

/**
 * Cross-field constraint: `RECONCILE_REPLAY` requires
 * `idempotency != NONE`. The runtime refuses to replay a
 * non-idempotent effect — the refine captures this rule at the
 * parse boundary so the IR itself rejects the bad combo.
 */
export const EffectNodeConfigWithReconciliationSchema = z
  .object({
    effect: EffectNodeConfigSchema,
    reconciliation: ReconciliationConfigSchema,
    onUnknown: UnknownExternalStateActionSchema,
  })
  .refine(
    (cfg) => {
      if (cfg.onUnknown === "RECONCILE_REPLAY") {
        return cfg.effect.idempotency !== "NONE"
      }
      return true
    },
    {
      message:
        "effect: onUnknown='RECONCILE_REPLAY' requires idempotency != NONE (cannot replay a non-idempotent effect)",
    },
  )

export type EffectNodeConfigWithReconciliation = z.infer<
  typeof EffectNodeConfigWithReconciliationSchema
>

/**
 * Validate the bundled effect+reconciliation+onUnknown config of
 * a node. Throws `z.ZodError` on failure. Same trust-boundary
 * contract as the other `parseControl*Config` helpers.
 */
export function parseEffectNodeConfigWithReconciliation(
  config: unknown,
): EffectNodeConfigWithReconciliation {
  return EffectNodeConfigWithReconciliationSchema.parse(config)
}

/* ------------------------------------------------------------------ */
/* Effect node config — M3-07 (compensation / Saga, ADR-007/008)      */
/* ------------------------------------------------------------------ */

/**
 * Maximum length of a `forwardNode` or `compensationNode` id.
 * 64 chars matches the existing node-id conventions elsewhere
 * in the IR (see `CONTROL_*_ID_MAX_CHARS` family).
 */
export const COMPENSATION_BRANCH_ID_MAX_CHARS = 64

/**
 * One Saga-style binding: a forward node with its paired
 * compensation node. The compensation runs in reverse order when
 * the workflow's later step fails. ADR-007, ADR-008.
 */
export const CompensationBindingSchema = z.object({
  forwardNode: z
    .string()
    .min(1, "compensation: forwardNode must be a non-empty node id"),
  compensationNode: z
    .string()
    .min(1, "compensation: compensationNode must be a non-empty node id"),
  /**
   * Optional human-readable description of what the compensation
   * does (e.g. "refund the Stripe charge"). Capped at 280 chars
   * (parity with `EFFECT_DESCRIPTION_MAX_CHARS`).
   */
  description: z
    .string()
    .max(280, "compensation: description must be ≤ 280 chars")
    .optional(),
})
export type CompensationBinding = z.infer<typeof CompensationBindingSchema>

/**
 * A list of compensation bindings. The `refine` rejects a list
 * with two bindings on the same `forwardNode` — a node can have
 * at most one compensation (Sagas). Multiple compensations on a
 * single forward would mean the runtime doesn't know which to
 * fire, which is the failure mode the contract exists to prevent.
 */
export const CompensationListSchema = z
  .array(CompensationBindingSchema)
  .refine(
    (bindings) => {
      const seen = new Set<string>()
      for (const b of bindings) {
        if (seen.has(b.forwardNode)) return false
        seen.add(b.forwardNode)
      }
      return true
    },
    { message: "compensation: duplicate forwardNode detected" },
  )

export type CompensationList = z.infer<typeof CompensationListSchema>

/**
 * Validate a single compensation binding. Throws `z.ZodError` on
 * failure. Same trust-boundary contract as the other
 * `parseControl*Config` helpers.
 */
export function parseCompensationBinding(config: unknown): CompensationBinding {
  return CompensationBindingSchema.parse(config)
}

/* ------------------------------------------------------------------ */
/* Effect node config — M3-08 (wait contract, ADR-022 / ADR-000)       */
/* ------------------------------------------------------------------ */

/**
 * Hard cap on the duration of a single wait. 1 year. A duration
 * above this is almost always a typo (e.g. milliseconds vs seconds
 * confusion) and the workflow author almost certainly did not
 * mean to schedule a run for a year. The runtime may further
 * clamp based on durable-timer storage limits; this is the IR
 * ceiling.
 */
export const WAIT_DURATION_MAX_MS = 365 * 24 * 60 * 60 * 1000

/**
 * Upper bound on `jitterRatio` for a wait. The contract
 * rejects anything > 1 (jitter is a fraction of the base
 * duration; > 1 means the wait can grow unbounded relative to
 * its base, which would defeat the point of pinning a base
 * duration).
 */
export const WAIT_JITTER_MAX = 1

/**
 * Unit of a wait's `duration`. ADR-022.
 *
 * - `ms`  : milliseconds. Identity.
 * - `s`   : seconds. × 1000 at resolve time.
 * - `min` : minutes. × 60_000 at resolve time.
 */
export const WaitUnitSchema = z.enum(["ms", "s", "min"])
export type WaitUnit = z.infer<typeof WaitUnitSchema>

/**
 * Configuration of a `wait` node. Consolidates the brief
 * `WaitConfigSchema` esquissé in M2-09 (control.if branch) into
 * its own canonical shape. The *implementation* of a durable
 * timer that honors this config is out of scope for M3 — it is
 * blocked on ADR-000. This is the contract only.
 */
export const WaitConfigSchema = z.object({
  duration: z
    .number()
    .positive("wait: duration must be positive")
    .max(
      WAIT_DURATION_MAX_MS,
      `wait: duration must be ≤ ${WAIT_DURATION_MAX_MS}ms (1 year)`,
    ),
  unit: WaitUnitSchema.default("ms"),
  jitterRatio: z
    .number()
    .min(0, "wait: jitterRatio must be ≥ 0")
    .max(WAIT_JITTER_MAX, "wait: jitterRatio must be ≤ 1")
    .default(0.1),
  /**
   * Optional name of the variable that receives the actual
   * waited duration (after jitter). Allows the workflow to
   * inspect what it got. The variable is bound only if the
   * workflow reads it.
   */
  outputVariable: z
    .string()
    .min(1, "wait: outputVariable must be non-empty when set")
    .max(64, "wait: outputVariable must be ≤ 64 chars")
    .regex(/^[a-zA-Z_][a-zA-Z0-9_]*$/, "wait: outputVariable must be a valid identifier")
    .optional(),
})
export type WaitConfig = z.infer<typeof WaitConfigSchema>

/**
 * Validate the opaque `config` record of a `wait` node. Throws
 * `z.ZodError` on failure. Same trust-boundary contract as the
 * other `parseControl*Config` helpers.
 */
export function parseWaitConfig(config: unknown): WaitConfig {
  return WaitConfigSchema.parse(config)
}

/**
 * Resolve a `WaitConfig` to a millisecond duration. Pure function.
 * `unit: "ms"` → identity, `"s"` → × 1000, `"min"` → × 60_000.
 * The exhaustive `switch` is on a closed 3-value enum so the
 * compiler enforces totality.
 */
export function resolveWaitDurationMs(config: WaitConfig): number {
  switch (config.unit) {
    case "ms": {
      return config.duration
    }
    case "s": {
      return config.duration * 1000
    }
    case "min": {
      return config.duration * 60_000
    }
  }
}

/* ------------------------------------------------------------------ */
