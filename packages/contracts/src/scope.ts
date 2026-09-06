/* SPDX-License-Identifier: MIT */
/**
 * Canonical ownership and deployment addresses.
 *
 * Policy decides who may act on a scope; this contract only validates
 * the durable address shape shared by later Automate modules.
 */
import { z } from "zod"

function nonBlankIdentifierSchema(fieldName: string) {
  return z
    .string()
    .min(1)
    .regex(/^\S(.*\S)?$/, `${fieldName} must not be empty or whitespace`)
}

export const OwnershipScopeSchema = z.object({
  organizationId: nonBlankIdentifierSchema("organizationId"),
  workspaceId: nonBlankIdentifierSchema("workspaceId"),
  projectId: nonBlankIdentifierSchema("projectId").optional(),
})

export type OwnershipScope = z.infer<typeof OwnershipScopeSchema>

export const DeploymentScopeSchema = z.object({
  ownershipScope: OwnershipScopeSchema,
  environmentId: z.string(),
})

export type DeploymentScope = z.infer<typeof DeploymentScopeSchema>
