/* SPDX-License-Identifier: MIT */
/**
 * Capability Authority enforcer contracts — Plan V2.3.1 §114, ADR-002, ADR-020, ADR-024.
 *
 * Production lift of the M1-05 spike design
 * (docs/automation-v2/spikes/m1-05-capability-enforcer.ts). The
 * `EnforcementResult` discriminated union lets callers write an
 * exhaustive `switch (result.kind) { case "grant": ...; case "deny": ... }`
 * that TypeScript can statically check. The spike used `{allow: true|false}`
 * as a literal test contract; this is the canonical Zod-backed form
 * the rest of `@unifia/capability-runtime` should depend on.
 *
 * The trust matrix (CAPABILITY_MIN_TRUST) and the `enforce()` function
 * live in `@unifia/capability-runtime` — this file is contract only.
 */
import { z } from "zod"
import { DeploymentScopeSchema } from "./scope.js"

/**
 * The four trust classes recognized by the Capability Authority.
 *
 * Ordered high → low (rank 3, 2, 1, 0). A capability demands a *minimum*
 * trust class; if the principal's trust class is below the floor, the
 * enforcer refuses with `TRUSTCLASS_TOO_LOW`.
 *
 * See M1-05 EVIDENCE §6 for the full rationale (substrate isolation
 * gradient: native → WASM/container → container+seccomp → gVisor).
 */
export const TrustClassSchema = z.enum([
  "CORE",
  "REVIEWED_EXTENSION",
  "UNTRUSTED_THIRD_PARTY",
  "UNTRUSTED_RUNTIME",
])

export type TrustClass = z.infer<typeof TrustClassSchema>

/**
 * The deny reasons the enforcer may return. Closed enum — adding
 * a new reason requires updating every `switch (result.kind)` site.
 *
 * `MANIFEST_REVOKED` is the registry-level denial (C-M1-08, TM-CP-01):
 * the enforcer's own check would have granted, but the registry has
 * since marked the `bindingDigest` as revoked via
 * `createSecureCapabilityRegistry().revoke()`. The reason is in this
 * file (not in `registry.ts`) because callers should treat it as a
 * first-class `deny` variant in the same discriminated union.
 */
export const DenialReasonSchema = z.enum([
  "MANIFEST_UNSIGNED",
  "TRUSTCLASS_TOO_LOW",
  "CAPABILITY_NOT_IN_SCOPE",
  "SCOPE_CHAIN_BROKEN",
  "MANIFEST_REVOKED",
])

export type DenialReason = z.infer<typeof DenialReasonSchema>

/**
 * A short-lived grant issued by the enforcer on a successful
 * authorization decision. The executor must verify the grant is
 * not expired (`now() < expiresAt`) and that the `bindingDigest`
 * matches a recomputation over its inputs (replay protection —
 * M1-05 EVIDENCE §4.3).
 */
export const CapabilityGrantSchema = z.object({
  /** The capability granted (may differ from `manifest.capability` after policy). */
  capability: z.string(),
  /** The exact scope granted — a grant is not generalizable. */
  scope: DeploymentScopeSchema,
  /** ms epoch, base of the TTL. */
  grantedAt: z.number().int().nonnegative(),
  /** ms epoch, `grantedAt + ttlMs`. */
  expiresAt: z.number().int().nonnegative(),
  /** SHA-256(workerId|capability|scope|grantedAt) hex (64 chars). */
  bindingDigest: z.string(),
})

export type CapabilityGrant = z.infer<typeof CapabilityGrantSchema>

/**
 * The result of an `enforce()` call. Discriminated by `kind` for
 * exhaustive caller-side `switch`:
 *
 *   switch (result.kind) {
 *     case "grant": // result.grant is set
 *     case "deny":  // result.reason (and optional detail) are set
 *   }
 */
export const EnforcementResultSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("grant"), grant: CapabilityGrantSchema }),
  z.object({ kind: z.literal("deny"), reason: DenialReasonSchema, detail: z.string().optional() }),
])

export type EnforcementResult = z.infer<typeof EnforcementResultSchema>

/**
 * The minimum trust level required for each capability. Source: M1-05
 * EVIDENCE §6.2 (6 representative capabilities out of the 20
 * P3_CAPABILITIES from M0-06). Capabilities not in the map fall back
 * to `REVIEWED_EXTENSION` (the conservative default — read-class
 * capabilities). Unknown capabilities (not in the map and not a
 * recognized P3 id) yield `TRUSTCLASS_TOO_LOW`.
 *
 * A capability with a higher required trust class cannot be exercised
 * by a principal with a lower trust class.
 */
export const CapabilityTrustRequirementSchema = z.record(z.string(), TrustClassSchema)

export type CapabilityTrustRequirement = z.infer<typeof CapabilityTrustRequirementSchema>
