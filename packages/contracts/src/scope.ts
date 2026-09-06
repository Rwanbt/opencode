/* SPDX-License-Identifier: MIT */
/**
 * Ownership + Deployment scopes — Plan V2.3.1 §44-§45, ADR-020.
 *
 * OwnershipScope is the durable ownership of a logical entity
 * (workflow, artifact, credential, …) by an org / project / workspace
 * triple. DeploymentScope extends it with the environment in which a
 * concrete deployment lives. The two are the canonical address forms
 * used by every other contract in this package: a digest is bound to
 * a deployment, an artifact is owned by an org/project/workspace, a
 * credential is scoped to an ownership triple.
 *
 * The fields are intentionally narrow — the rules around who can mint,
 * move, or delete a scope are owned by ADR-020 and not duplicated
 * here. This module is a *contract*, not a policy.
 */
import { z } from "zod"

/**
 * Durable ownership of a logical entity. The triple is the smallest
 * unit the platform can address; downstream layers (RBAC, billing,
 * multi-tenant isolation) derive their rules from this shape.
 *
 * - `organizationId` is mandatory: nothing is addressable below an org.
 * - `projectId` is optional: many orgs run a single flat workspace pool.
 * - `workspaceId` is mandatory and the leaf: every owned entity is in
 *   exactly one workspace.
 */
export const OwnershipScopeSchema = z.object({
  organizationId: z
    .string()
    .min(1)
    .regex(/^\S(.*\S)?$/, "organizationId must not be empty or whitespace"),
  workspaceId: z
    .string()
    .min(1)
    .regex(/^\S(.*\S)?$/, "workspaceId must not be empty or whitespace"),
  projectId: z
    .string()
    .min(1)
    .regex(/^\S(.*\S)?$/, "projectId must not be empty or whitespace")
    .optional(),
})

export type OwnershipScope = z.infer<typeof OwnershipScopeSchema>

/**
 * A concrete deployment of an owned entity. The ownership triple is
 * nested rather than spread so the two never drift apart — a
 * deployment without an owner is rejected at the type level.
 *
 * `environmentId` is the canonical name of the environment
 * (e.g. "prod", "staging", "dev-laptop"). The rules around
 * environment names, allowed transitions, and isolation
 * guarantees are defined in ADR-020, not here.
 */
export const DeploymentScopeSchema = z.object({
  ownershipScope: OwnershipScopeSchema,
  environmentId: z.string(),
})

export type DeploymentScope = z.infer<typeof DeploymentScopeSchema>
