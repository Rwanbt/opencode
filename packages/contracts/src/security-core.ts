/* SPDX-License-Identifier: MIT */
/**
 * Security Core contracts (Plan V2.3.1 §203, ADR-008, ADR-009, ADR-010, ADR-022).
 *
 * The Security Core brings together the cross-cutting trust primitives
 * that the policy engine, the capability authority, and the secret
 * broker all rely on. SC-06 (Secret Broker) is already implemented
 * in `@unifia/secret-broker` and is *not* re-exported here; the
 * other 7 contracts are introduced for the first time.
 *
 * ADR-008 (scheduler/worker time authority) — the `WorkerIdentity`
 * and `ServiceIdentity` types here MUST be the same identifiers the
 * scheduler uses to grant leases (DS-02). Cross-file consistency
 * is enforced by `ServiceIdentity.brand` in M0 I2 ids.ts.
 *
 * ADR-009 (policy) — `PolicyRule` is the contract surface; the
 * runtime evaluates them. Policy compilation is out of scope.
 *
 * ADR-010 (secret / credential / key model) — `KeyAuthority` is
 * the interface the secret broker calls. The actual key
 * derivation is in `packages/secret-broker/`.
 *
 * ADR-022 (timer) — `Approval` carries an optional `expiresAt`
 * derived from the timer model.
 */
import { z } from "zod"

// =========================================================================
// SC-01 Capability Authority
// =========================================================================

/**
 * A capability grant: who can do what on which resource.
 * The runtime grants capabilities at trigger/approval time and
 * the capability-runtime package evaluates them. This is the
 * *contract* surface — runtime decision logic is elsewhere.
 */
export const CapabilitySubjectSchema = z.enum(["user", "service", "worker", "system"])
export const CapabilityActionSchema = z.enum(["read", "write", "execute", "approve", "admin"])
export const CapabilityResourceKindSchema = z.enum([
  "workflow",
  "workflow-run",
  "node",
  "secret",
  "artifact",
  "tenant",
  "policy",
  "capability",
])
export const CapabilitySchema = z.object({
  subject: CapabilitySubjectSchema,
  subjectId: z.string().min(1, "capability: subjectId must be non-empty"),
  action: CapabilityActionSchema,
  resourceKind: CapabilityResourceKindSchema,
  resourceId: z.string().min(1, "capability: resourceId must be non-empty").optional(),
  grantedAt: z.number().int().nonnegative(),
  expiresAt: z.number().int().nonnegative().optional(),
})
export type Capability = z.infer<typeof CapabilitySchema>

export function parseCapability(input: unknown): Capability {
  return CapabilitySchema.parse(input)
}

// =========================================================================
// SC-02 Policy
// =========================================================================

export const PolicyEffectSchema = z.enum(["allow", "deny", "require-approval"])
export type PolicyEffect = z.infer<typeof PolicyEffectSchema>

export const PolicyRuleSchema = z.object({
  id: z.string().min(1, "policy: rule id must be non-empty"),
  description: z.string().max(280).optional(),
  when: z.string().min(1, "policy: 'when' expression must be non-empty"),
  // biome-ignore lint/suspicious/noThenProperty: `then` is the domain field of a PolicyRule (when/then/else), not a thenable.
  then: PolicyEffectSchema,
  else: PolicyEffectSchema.optional(),
  priority: z.number().int().default(0),
})
export type PolicyRule = z.infer<typeof PolicyRuleSchema>

export const PolicySchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  rules: z.array(PolicyRuleSchema).readonly(),
})
export type Policy = z.infer<typeof PolicySchema>

export function parsePolicy(input: unknown): Policy {
  return PolicySchema.parse(input)
}

// =========================================================================
// SC-03 Approval
// =========================================================================

export const APPROVAL_MAX_APPROVERS = 32
export const APPROVAL_MAX_EXPIRY_MS = 90 * 24 * 60 * 60 * 1000  // 90 days

export const ApprovalBindingSchema = z.object({
  id: z.string().min(1),
  requiredApprovals: z.number().int().positive().max(APPROVAL_MAX_APPROVERS),
  approvers: z.array(z.string().min(1)).min(1).max(APPROVAL_MAX_APPROVERS),
  expiresAt: z.number().int().nonnegative().optional(),
  scope: z.string().min(1),
})
export type ApprovalBinding = z.infer<typeof ApprovalBindingSchema>

export function parseApprovalBinding(input: unknown): ApprovalBinding {
  return ApprovalBindingSchema.parse(input)
}

// =========================================================================
// SC-04 Tenant enforcement
// =========================================================================

export const TenantContextSchema = z.object({
  tenantId: z.string().min(1, "tenant: tenantId must be non-empty"),
  isolation: z.enum(["shared", "isolated", "dedicated"]),
  region: z.string().optional(),
})
export type TenantContext = z.infer<typeof TenantContextSchema>

export function parseTenantContext(input: unknown): TenantContext {
  return TenantContextSchema.parse(input)
}

// =========================================================================
// SC-05 Taint runtime
// =========================================================================

export const TAINT_LEVEL_MAX = 10
export const TaintLevelSchema = z.number().int().min(0).max(TAINT_LEVEL_MAX)
export type TaintLevel = z.infer<typeof TaintLevelSchema>

export const TaintMarkSchema = z.object({
  input: z.string().min(1),
  source: z.enum(["user", "external", "internal", "system"]),
  level: TaintLevelSchema,
  at: z.number().int().nonnegative(),
})
export type TaintMark = z.infer<typeof TaintMarkSchema>

export const TaintPropagationRuleSchema = z.object({
  fromLevel: TaintLevelSchema,
  toLevel: TaintLevelSchema,
  when: z.enum(["input", "output", "always"]),
})
export type TaintPropagationRule = z.infer<typeof TaintPropagationRuleSchema>

export const TaintPolicySchema = z.object({
  rules: z.array(TaintPropagationRuleSchema).readonly(),
  denyIfLevelExceeds: TaintLevelSchema.optional(),
})
export type TaintPolicy = z.infer<typeof TaintPolicySchema>

// =========================================================================
// SC-07 Key Authority integration
// =========================================================================

/**
 * Reference to a key managed by the Key Authority (ADR-015).
 * The actual key is never inlined — only the authority-id and a
 * version are carried. The runtime calls `KeyAuthority.lookup(id, version)`
 * to get the key material.
 */
export const KeyAuthorityReferenceSchema = z.object({
  authorityId: z.string().min(1, "key: authorityId must be non-empty"),
  version: z.string().min(1, "key: version must be non-empty"),
  purpose: z.enum(["encryption", "signing", "hmac", "kdf"]),
})
export type KeyAuthorityReference = z.infer<typeof KeyAuthorityReferenceSchema>

export function parseKeyAuthorityReference(input: unknown): KeyAuthorityReference {
  return KeyAuthorityReferenceSchema.parse(input)
}

// =========================================================================
// SC-08 Worker / service identities
// =========================================================================

export const WorkerIdSchema = z.string().min(1).max(256).regex(/^[a-zA-Z0-9_-]+$/, "worker: id must be alphanumeric + _ -")
export type WorkerId = z.infer<typeof WorkerIdSchema>

export const ServiceIdSchema = z.string().min(1).max(256).regex(/^[a-zA-Z0-9._-]+$/, "service: id must be a dotted name")
export type ServiceId = z.infer<typeof ServiceIdSchema>

export const WorkerIdentitySchema = z.object({
  workerId: WorkerIdSchema,
  serviceId: ServiceIdSchema,
  capabilities: z.array(z.string()).readonly(),
  lastHeartbeat: z.number().int().nonnegative().optional(),
})
export type WorkerIdentity = z.infer<typeof WorkerIdentitySchema>

export const ServiceIdentitySchema = z.object({
  serviceId: ServiceIdSchema,
  version: z.string().min(1),
  capabilities: z.array(z.string()).readonly(),
  registeredAt: z.number().int().nonnegative(),
})
export type ServiceIdentity = z.infer<typeof ServiceIdentitySchema>

export function parseWorkerIdentity(input: unknown): WorkerIdentity {
  return WorkerIdentitySchema.parse(input)
}
export function parseServiceIdentity(input: unknown): ServiceIdentity {
  return ServiceIdentitySchema.parse(input)
}
