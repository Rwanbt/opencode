/* SPDX-License-Identifier: MIT */
/* Copyright (c) 2026 Unifia contributors */

/**
 * Effect identity and semantics (ADR-000 §20-§24).
 *
 * This is the module the whole substrate comparison turns on. A durable
 * engine's job is not to run a step once — it cannot promise that — but to
 * give every logical effect a **stable identity** that survives retry,
 * restart and authority reacquisition, so the system can reason about what
 * may or may not have already happened out in the world.
 *
 * §23 forbids two promises outright, and the wording matters:
 *
 *     generic "exactly once"                     — forbidden
 *     "at-most-once via idempotency"             — forbidden
 *
 * The model is instead: durable execution/dispatch semantics + stable
 * `EffectKey` + provider idempotency *when available* + reconciliation
 * *when available* + explicit uncertainty otherwise. An idempotency key
 * does not turn an arbitrary external call into an at-most-once one; when
 * the outcome cannot be established, the honest answer is
 * `UNKNOWN_EXTERNAL_STATE` (§24), not a retry.
 *
 * What ADR-000 deliberately does **not** decide here: the hash algorithm,
 * the binary or text encoding, and the canonical serializer used to turn
 * an `EffectKey` into an `EffectId` (§20). That is ADR-001's. So this
 * module defines the *structure* and its equality, and leaves derivation
 * behind an injectable port.
 */
import type {
  AttemptId,
  EffectId,
  LogicalInvocationId,
  WorkflowDeploymentId,
  WorkflowRunId,
} from "./ids.js"
import type { UnifiaValue } from "./value.js"

/* ------------------------------------------------------------------ */
/* EffectSlot (§21)                                                    */
/* ------------------------------------------------------------------ */

/**
 * One coordinate of an iteration, materialized durably before dispatch.
 *
 * §21 is strict about the failure mode it exists to prevent: a retry must
 * never *re-enumerate* a collection and silently derive new coordinates.
 * If the coordinate came from a stable business key it is recorded as
 * `key`; if no such key exists, the ordinal actually used is itself
 * materialized as `ordinal`. Either way the coordinate is durable data,
 * not something recomputed at retry time.
 */
export type IterationCoordinate =
  | { readonly kind: "key"; readonly key: string }
  | { readonly kind: "ordinal"; readonly ordinal: number }

/**
 * A stable structural locator for an effect inside an immutable
 * `WorkflowVersion` (§21).
 *
 * `effectOrdinal` distinguishes several effects emitted by one logical
 * invocation. §21 routes its full precision to card **M0-M01**; what is
 * fixed here is that it exists, is a non-negative integer, and takes part
 * in identity.
 */
export interface EffectSlot {
  /** Stable identity of the node inside the pinned WorkflowVersion. */
  readonly nodeExecutionPath: string
  /** Empty for a non-iterated node; outermost coordinate first. */
  readonly iterationCoordinates: readonly IterationCoordinate[]
  readonly effectOrdinal: number
}

/* ------------------------------------------------------------------ */
/* EffectKey (§20)                                                     */
/* ------------------------------------------------------------------ */

/**
 * The normative semantic identity of an effect (§20).
 *
 * `effectIdentityVersion` is first because identity schemes evolve: a
 * future change to how slots are built must be able to coexist with keys
 * already persisted, and a version field is the only way to tell an old
 * key from a new one rather than silently comparing across schemes.
 */
export interface EffectKey {
  readonly effectIdentityVersion: number
  readonly deploymentId: WorkflowDeploymentId
  readonly runId: WorkflowRunId
  readonly logicalInvocationId: LogicalInvocationId
  readonly effectSlot: EffectSlot
}

export const EFFECT_IDENTITY_VERSION_M0 = 1

/**
 * Structural equality of two effect keys.
 *
 * This is the predicate the failure matrix leans on: FC-04 asks that a
 * retried effect keeps its key, the non-linear fixture (§52) asks that map
 * and loop coordinates stay stable across restart, and §19 asks that a new
 * `AttemptId` does *not* change the key. Comparing structurally — rather
 * than through a serializer — keeps that assertion independent of ADR-001,
 * which has not been decided.
 */
export function effectKeyEquals(left: EffectKey, right: EffectKey): boolean {
  if (left.effectIdentityVersion !== right.effectIdentityVersion) return false
  if (left.deploymentId !== right.deploymentId) return false
  if (left.runId !== right.runId) return false
  if (left.logicalInvocationId !== right.logicalInvocationId) return false
  return effectSlotEquals(left.effectSlot, right.effectSlot)
}

export function effectSlotEquals(left: EffectSlot, right: EffectSlot): boolean {
  if (left.nodeExecutionPath !== right.nodeExecutionPath) return false
  if (left.effectOrdinal !== right.effectOrdinal) return false
  if (left.iterationCoordinates.length !== right.iterationCoordinates.length) return false
  return left.iterationCoordinates.every((coordinate, index) => {
    const other = right.iterationCoordinates[index] as IterationCoordinate
    if (coordinate.kind !== other.kind) return false
    return coordinate.kind === "key"
      ? coordinate.key === (other as { key: string }).key
      : coordinate.ordinal === (other as { ordinal: number }).ordinal
  })
}

export class EffectKeyError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "EffectKeyError"
  }
}

/** Reject a slot that could not have been materialized before dispatch (§21). */
export function assertWellFormedEffectSlot(slot: EffectSlot): void {
  if (typeof slot.nodeExecutionPath !== "string" || slot.nodeExecutionPath.length === 0) {
    throw new EffectKeyError("effectSlot.nodeExecutionPath must be a non-empty string")
  }
  if (!Number.isInteger(slot.effectOrdinal) || slot.effectOrdinal < 0) {
    throw new EffectKeyError(
      `effectSlot.effectOrdinal must be a non-negative integer, got ${slot.effectOrdinal}`,
    )
  }
  for (const [index, coordinate] of slot.iterationCoordinates.entries()) {
    if (coordinate.kind === "key") {
      if (typeof coordinate.key !== "string" || coordinate.key.length === 0) {
        throw new EffectKeyError(`iterationCoordinates[${index}].key must be non-empty`)
      }
      continue
    }
    if (!Number.isInteger(coordinate.ordinal) || coordinate.ordinal < 0) {
      throw new EffectKeyError(
        `iterationCoordinates[${index}].ordinal must be a non-negative integer`,
      )
    }
  }
}

/**
 * Derives the opaque `EffectId` from an `EffectKey`.
 *
 * Injected rather than implemented: §20 sends the hash algorithm, the
 * encoding and the canonical serializer to ADR-001, which is not decided.
 * The harness supplies a deriver so the M0 comparison can run; whatever it
 * supplies is qualification-only and carries no compatibility promise
 * (plan §193).
 */
export interface EffectIdDeriver {
  derive(key: EffectKey): EffectId
}

/* ------------------------------------------------------------------ */
/* EffectPolicy (§22)                                                  */
/* ------------------------------------------------------------------ */

/**
 * The five canonical classes (§22). They describe what the *world* allows,
 * not what the engine wishes were true.
 *
 * - `PURE`           no observable external effect.
 * - `IDEMPOTENT`     repeating the same EffectKey adds no external mutation.
 * - `REPEATABLE`     the business contract permits repetition. §22 is
 *                    explicit that this does **not** imply idempotence.
 * - `RECONCILABLE`   the provider can be *asked* whether the effect happened.
 * - `NON_REPEATABLE` under uncertainty, no automatic replay at all.
 */
export const EFFECT_POLICIES = [
  "PURE",
  "IDEMPOTENT",
  "REPEATABLE",
  "RECONCILABLE",
  "NON_REPEATABLE",
] as const

export type EffectPolicy = (typeof EFFECT_POLICIES)[number]

/**
 * May an effect of this policy be automatically replayed when the previous
 * attempt's outcome is *unknown*?
 *
 * The honest answer is no for everything except the two classes that have
 * an external justification: `PURE` (nothing happened outside) and
 * `IDEMPOTENT` (repeating adds no mutation). `REPEATABLE` is deliberately
 * excluded — §22 separates it from idempotence, so replaying it under
 * uncertainty could double a real effect. `RECONCILABLE` must be *asked*
 * first, which is reconciliation, not replay. `NON_REPEATABLE` is never.
 *
 * §22 separates `REPEATABLE` from idempotence, so "the business says
 * repeating is fine" is a statement about intent, not about the provider.
 * Replaying a `REPEATABLE` effect under uncertainty can still double a
 * real effect. The most expensive way to learn this is in production.
 */
export function mayAutoReplayUnderUncertainty(policy: EffectPolicy): boolean {
  return policy === "PURE" || policy === "IDEMPOTENT"
}

/** Can the outcome be established by interrogating the provider? (§22) */
export function isReconcilable(policy: EffectPolicy): boolean {
  return policy === "RECONCILABLE"
}

/* ------------------------------------------------------------------ */
/* Effect outcome and record (§23, §24)                                */
/* ------------------------------------------------------------------ */

/**
 * `UNKNOWN_EXTERNAL_STATE` is a **first-class durable state** (§24), not an
 * error variant that gets swallowed. Every surface — API, CLI, Desktop UI,
 * audit, history — has to preserve the distinction between "it failed" and
 * "we cannot prove whether it happened".
 */
export const UNKNOWN_EXTERNAL_STATE = "UNKNOWN_EXTERNAL_STATE" as const

export type EffectOutcome =
  | { readonly kind: "SUCCEEDED"; readonly result: UnifiaValue }
  | { readonly kind: "FAILED"; readonly error: UnifiaValue }
  | {
      readonly kind: typeof UNKNOWN_EXTERNAL_STATE
      /** Why the outcome could not be established. Durable, human-readable. */
      readonly reason: string
    }

/**
 * How a run may leave `UNKNOWN_EXTERNAL_STATE` (§24). There are exactly
 * two doors, and neither is a retry.
 */
export type UncertaintyResolution =
  | {
      readonly kind: "RECONCILED"
      /** What the provider was asked, and what it answered. */
      readonly evidence: UnifiaValue
      readonly outcome: "SUCCEEDED" | "FAILED"
    }
  | {
      readonly kind: "OPERATOR_RESOLVED"
      readonly operator: string
      readonly justification: string
      readonly outcome: "SUCCEEDED" | "FAILED"
    }

export interface EffectRecord {
  readonly effectId: EffectId
  readonly key: EffectKey
  readonly policy: EffectPolicy
  readonly attemptId: AttemptId
  readonly outcome: EffectOutcome
  /** Set only once the run has left UNKNOWN_EXTERNAL_STATE. */
  readonly resolution?: UncertaintyResolution
}

export class EffectSemanticsError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "EffectSemanticsError"
  }
}

/**
 * The §23/§24 guard, in one place.
 *
 * Given an effect whose last attempt ended in `UNKNOWN_EXTERNAL_STATE`,
 * decide what the engine is allowed to do next. Returning a value rather
 * than a boolean keeps the three outcomes distinguishable at the call
 * site — "retry", "go ask", and "stop and surface it" are three different
 * behaviors, and collapsing them into a boolean is how a blind retry gets
 * written by accident.
 *
 * Retry, go-ask, and stop-and-surface are three different behaviors.
 * Collapsing them is how a blind retry gets written by accident. The
 * values are distinct strings on purpose: a `boolean` return would let a
 * reviewer miss a `?? false` somewhere and silently turn
 * `RECONCILE`/`SURFACE_UNCERTAINTY` into `AUTO_REPLAY`.
 */
export type UncertaintyAction = "AUTO_REPLAY" | "RECONCILE" | "SURFACE_UNCERTAINTY"

export function actionUnderUncertainty(policy: EffectPolicy): UncertaintyAction {
  if (mayAutoReplayUnderUncertainty(policy)) return "AUTO_REPLAY"
  if (isReconcilable(policy)) return "RECONCILE"
  return "SURFACE_UNCERTAINTY"
}

/**
 * Assert that a retry preserves identity (§19): same logical invocation,
 * same key, **new** attempt.
 *
 * §82 lists "substrate-local identity replacing EffectKey" among the
 * absolute prohibitions — a candidate that quietly re-derives a key on
 * retry from its own internal notion of a step would pass a naive test and
 * fail this one.
 */
export function assertRetryPreservesIdentity(
  previous: EffectRecord,
  retried: { readonly key: EffectKey; readonly attemptId: AttemptId },
): void {
  if (!effectKeyEquals(previous.key, retried.key)) {
    throw new EffectSemanticsError(
      "a retry of the same logical effect must preserve its EffectKey (§19, §82)",
    )
  }
  if (previous.attemptId === retried.attemptId) {
    throw new EffectSemanticsError("a retry must carry a new AttemptId (§19)")
  }
}

/* ------------------------------------------------------------------ */
/* EffectKeyDeriver port (M3-02)                                       */
/* ------------------------------------------------------------------ */

/**
 * Port that turns a sample effect payload into an `EffectKey`.
 *
 * This sits one level below `EffectIdDeriver` (§20). The existing
 * `EffectIdDeriver` already injects the hash algorithm, encoding and
 * canonical serializer (ADR-001 deferred). `EffectKeyDeriver` injects the
 * step that maps a user-visible effect payload to a structural
 * `EffectKey`. Both must be deterministic, and a non-deterministic
 * `EffectKeyDeriver` is the exact failure mode §82 lists under
 * "substrate-local identity replacing EffectKey" — the candidate
 * re-derives a different key on retry and silently dispatches a second
 * real effect.
 */
export interface EffectKeyDeriver {
  deriveKey(payload: unknown): EffectKey
}

/**
 * Assert that a candidate `EffectKeyDeriver` produces the same `EffectKey`
 * for the same effect payload across multiple calls.
 *
 * This is the M3-02 reinforcement of `assertRetryPreservesIdentity`: that
 * existing function catches a runtime-level slip (the `EffectRecord`
 * handed to the runtime has the same key and a new attempt). This one
 * catches the contract-level slip that would let the slip reach the
 * runtime in the first place: a deriver that hashes the payload
 * deterministically. ADR-001 (PROPOSED), ADR-007.
 *
 * The failure mode the assertion catches: a substrate re-deriving
 * identity from its own internal step counter (e.g. "step 3" → key 3 on
 * first attempt, "step 4" → key 4 on retry after crash) — the EffectKey
 * MUST be derived from the user-visible effect payload, not from runtime
 * counters. Without this guard, at-least-once becomes a structural
 * promise, not a behavioral one.
 *
 * Throws an `Error` with a clear message if the keys differ. Returns the
 * derived `EffectKey` so callers can chain it into further assertions
 * without recomputing.
 */
export function assertEffectKeyDeriverIsDeterministic(
  deriver: EffectKeyDeriver,
  payload: unknown,
): EffectKey {
  const first = deriver.deriveKey(payload)
  const second = deriver.deriveKey(payload)
  if (!effectKeyEquals(first, second)) {
    throw new EffectSemanticsError(
      "EffectKeyDeriver must produce the same EffectKey for the same payload across calls — " +
        "a non-deterministic deriver would dispatch a second real effect on retry (§19, §82)",
    )
  }
  return first
}

/* ------------------------------------------------------------------ */
/* Effect attempt configuration (M3-01)                                */
/* ------------------------------------------------------------------ */

/** Hard upper bound on `maxAttempts` (resource protection, M3-01 / ADR-007). */
export const EFFECT_MAX_MAX_ATTEMPTS = 1000

/** Hard upper bound on `minIntervalMs` (defense against hot retry loops). */
export const EFFECT_MAX_MIN_INTERVAL_MS = 60_000

/** Default minimum wall-clock interval between two attempts. */
export const EFFECT_DEFAULT_MIN_INTERVAL_MS = 1000

/**
 * Configuration of an effect's attempt budget. The runtime uses this
 * to decide how many times to retry a side effect before giving up.
 * ADR-007.
 *
 * `maxAttempts` is the **hard upper bound** on retries. A value of 1
 * means "no retry, single attempt" (the default for non-idempotent
 * effects). A value of 0 is rejected.
 *
 * `minIntervalMs` is the minimum wall-clock time between two attempts.
 * The runtime MUST NOT attempt faster than this (defense against
 * tight retry loops that hammer an external provider).
 *
 * `maxAttempts` × `minIntervalMs` gives a lower bound on the total
 * time the effect will take (assuming each attempt fails). The runtime
 * is free to back off further (M3-04 retry policy is the place to
 * express jitter / exponential backoff).
 */
export interface EffectAttemptConfig {
  readonly maxAttempts: number
  readonly minIntervalMs: number
}

export class EffectAttemptConfigError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "EffectAttemptConfigError"
  }
}

/**
 * Runtime validator for `EffectAttemptConfig` (M3-01).
 *
 * Hand-rolled rather than zod: the package has no zod dependency, and
 * introducing one for a single schema would be the wrong scale. The
 * error messages mirror the constraint and include the `effect.attempt:`
 * prefix that the M3-01 spec prescribes, so callers can route them.
 */
export function parseEffectAttemptConfig(input: unknown): EffectAttemptConfig {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw new EffectAttemptConfigError(
      "effect.attempt: payload must be a non-array object",
    )
  }
  const candidate = input as Record<string, unknown>

  const maxAttemptsRaw = candidate.maxAttempts
  if (typeof maxAttemptsRaw !== "number" || !Number.isInteger(maxAttemptsRaw)) {
    throw new EffectAttemptConfigError(
      "effect.attempt: maxAttempts must be an integer",
    )
  }
  if (maxAttemptsRaw < 1) {
    throw new EffectAttemptConfigError(
      "effect.attempt: maxAttempts must be ≥ 1",
    )
  }
  if (maxAttemptsRaw > EFFECT_MAX_MAX_ATTEMPTS) {
    throw new EffectAttemptConfigError(
      `effect.attempt: maxAttempts must be ≤ ${EFFECT_MAX_MAX_ATTEMPTS} (resource bound)`,
    )
  }

  const minIntervalRaw = candidate.minIntervalMs
  let minIntervalMs: number
  if (minIntervalRaw === undefined) {
    minIntervalMs = EFFECT_DEFAULT_MIN_INTERVAL_MS
  } else if (
    typeof minIntervalRaw !== "number" ||
    !Number.isInteger(minIntervalRaw)
  ) {
    throw new EffectAttemptConfigError(
      "effect.attempt: minIntervalMs must be an integer when provided",
    )
  } else if (minIntervalRaw < 0) {
    throw new EffectAttemptConfigError(
      "effect.attempt: minIntervalMs must be ≥ 0",
    )
  } else if (minIntervalRaw > EFFECT_MAX_MIN_INTERVAL_MS) {
    throw new EffectAttemptConfigError(
      `effect.attempt: minIntervalMs must be ≤ ${EFFECT_MAX_MIN_INTERVAL_MS}ms (defense vs hot-loop)`,
    )
  } else {
    minIntervalMs = minIntervalRaw
  }

  return { maxAttempts: maxAttemptsRaw, minIntervalMs }
}
