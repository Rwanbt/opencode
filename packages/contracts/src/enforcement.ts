/* SPDX-License-Identifier: MIT */
import { z } from "zod"
import { DeploymentScopeSchema } from "./scope.js"

export const TrustClassSchema = z.enum([
  "CORE",
  "REVIEWED_EXTENSION",
  "UNTRUSTED_THIRD_PARTY",
  "UNTRUSTED_RUNTIME",
])
export type TrustClass = z.infer<typeof TrustClassSchema>

export const DenialReasonSchema = z.enum([
  "MANIFEST_UNSIGNED",
  "TRUSTCLASS_TOO_LOW",
  "CAPABILITY_NOT_IN_SCOPE",
  "SCOPE_CHAIN_BROKEN",
  "MANIFEST_REVOKED",
])
export type DenialReason = z.infer<typeof DenialReasonSchema>

export const CapabilityGrantSchema = z.object({
  capability: z.string(),
  scope: DeploymentScopeSchema,
  grantedAt: z.number().int().nonnegative(),
  expiresAt: z.number().int().nonnegative(),
  bindingDigest: z.string(),
})
export type CapabilityGrant = z.infer<typeof CapabilityGrantSchema>

export const EnforcementResultSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("grant"), grant: CapabilityGrantSchema }),
  z.object({ kind: z.literal("deny"), reason: DenialReasonSchema, detail: z.string().optional() }),
])
export type EnforcementResult = z.infer<typeof EnforcementResultSchema>

export const CapabilityTrustRequirementSchema = z.record(z.string(), TrustClassSchema)
export type CapabilityTrustRequirement = z.infer<typeof CapabilityTrustRequirementSchema>
