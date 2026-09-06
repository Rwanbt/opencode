/* SPDX-License-Identifier: MIT */
import { z } from "zod"

/* Effect node config — M3-03 (idempotency, ADR-007)                   */
/* ------------------------------------------------------------------ */

/**
 * Maximum length of an `idempotencyKey` carried by an effect node.
 * 256 chars is generous for content-derived hashes (sha-256 hex is 64
 * chars; a UUIDv7 is 36) and for provider-issued keys
 * (Stripe-style keys are ≤ 255 chars). Longer values almost always
 * indicate misuse (e.g. an inline payload).
 */
export const EFFECT_IDEMPOTENCY_KEY_MAX_CHARS = 256

/**
 * Maximum length of the free-form `description` on an effect node.
 * Matches `CONTROL_*_DESCRIPTION_MAX_CHARS` (280 chars) so every
 * family's inspector text shares the same ceiling.
 */
export const EFFECT_DESCRIPTION_MAX_CHARS = 280

/**
 * Idempotency classification of a side effect. The runtime uses
 * this to decide whether a retry is safe. ADR-007.
 *
 * - `NONE`: the effect is not idempotent at any layer. A retry is
 *   dangerous — it would dispatch a second real effect. The runtime
 *   will refuse to auto-retry; the workflow author must provide
 *   explicit `reconciliation` (M3-05) or accept failure.
 * - `PROVIDER`: the underlying provider (HTTP, gRPC, queue) gives
 *   the runtime an idempotency key (e.g. `Idempotency-Key` header,
 *   Stripe's `Idempotency-Key`). The runtime will retry with the
 *   same key — the provider deduplicates. Requires an
 *   `idempotencyKey` in the node config.
 * - `USER`: the workflow author provides a custom idempotency key
 *   (e.g. a content hash of the effect payload). Same semantics as
 *   `PROVIDER` but the key is computed at workflow authoring time.
 * - `BUSINESS`: the business logic of the effect is naturally
 *   idempotent (e.g. "set this user's email to X" — running twice
 *   has the same effect as running once). The runtime can retry
 *   without a key.
 *
 * Cross-reference: M3-04 retry policy uses this to decide whether
 * automatic retry is safe. M3-05 reconciliation uses this to decide
 * whether a probe is necessary before retry. M3-06 UNKNOWN_EXTERNAL_STATE
 * routes to RECONCILE_REPLAY iff `idempotency != NONE`.
 */
export const IdempotencyClassSchema = z.enum(["NONE", "PROVIDER", "USER", "BUSINESS"])
export type IdempotencyClass = z.infer<typeof IdempotencyClassSchema>

/**
 * The shared shape every effect node carries. Distinct from
 * `NodeSchema` (which is for the IR tree) — `EffectNodeConfig` is
 * the family-specific config that effector nodes like `tool.http`
 * and `human.approval` carry inside their `config` opaque record.
 * ADR-007.
 *
 * The IR's `NodeSchema` keeps `config` as `z.record(z.string(),
 * z.unknown())` so a new effector cannot break the IR (a new
 * effector is a new family + version + ADR, not a free-form
 * field). This schema is what effector families validate against
 * at parse time.
 *
 * The `refine` rule encodes the contract that ties the
 * `idempotency` class to the presence of `idempotencyKey`:
 *   - `PROVIDER` / `USER` REQUIRE a non-empty `idempotencyKey`
 *     (the key is what makes retry safe).
 *   - `NONE` / `BUSINESS` FORBID an `idempotencyKey` (the absence
 *     of a key is the signal: either no retry will happen, or the
 *     effect is naturally safe to re-run). A redundant key on a
 *     `NONE` effect would mislead the runtime into thinking the
 *     effect is dedupable when it is not.
 */
export const EffectNodeConfigSchema = z
  .object({
    /**
     * Idempotency class. Required (no default) — a non-idempotent
     * effect without explicit reconciliation is a contract violation.
     * The runtime refuses to auto-retry `NONE` effects.
     */
    idempotency: IdempotencyClassSchema,
    /**
     * The idempotency key. Required when `idempotency` is
     * `PROVIDER` or `USER`; forbidden when `idempotency` is `NONE`
     * or `BUSINESS`. The key is a non-empty string ≤ 256 chars.
     */
    idempotencyKey: z
      .string()
      .min(1, "effect: idempotencyKey is required when idempotency is 'PROVIDER' or 'USER'")
      .max(
        EFFECT_IDEMPOTENCY_KEY_MAX_CHARS,
        `effect: idempotencyKey must be ≤ ${EFFECT_IDEMPOTENCY_KEY_MAX_CHARS} chars`,
      )
      .optional(),
    /**
     * Optional human-readable description of the effect for
     * inspector UIs and audit logs. Capped at 280 chars.
     */
    description: z
      .string()
      .max(
        EFFECT_DESCRIPTION_MAX_CHARS,
        `effect: description must be ≤ ${EFFECT_DESCRIPTION_MAX_CHARS} chars`,
      )
      .optional(),
  })
  .refine(
    (cfg) => {
      if (cfg.idempotency === "PROVIDER" || cfg.idempotency === "USER") {
        return typeof cfg.idempotencyKey === "string" && cfg.idempotencyKey.length > 0
      }
      // NONE or BUSINESS: key forbidden (the absence is the signal)
      return cfg.idempotencyKey === undefined
    },
    {
      message:
        "effect: idempotencyKey is required when idempotency is 'PROVIDER' or 'USER', and forbidden when idempotency is 'NONE' or 'BUSINESS'",
    },
  )
export type EffectNodeConfig = z.infer<typeof EffectNodeConfigSchema>

/**
 * Validate the opaque `config` record of an effect node (e.g.
 * `tool.http`, `human.approval`) against `EffectNodeConfigSchema`.
 * Throws `z.ZodError` on failure. Same trust-boundary contract as
 * the `parseControl*Config` helpers: the IR keeps `Node.config`
 * opaque, so each effector family validates its own shape at the
 * trust boundary.
 */
export function parseEffectNodeConfig(config: unknown): EffectNodeConfig {
  return EffectNodeConfigSchema.parse(config)
}

/* ------------------------------------------------------------------ */
