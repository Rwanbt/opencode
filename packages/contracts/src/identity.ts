/* SPDX-License-Identifier: MIT */
import { z } from "zod"
import { OwnershipScopeSchema } from "./scope.js"

export const WorkerIdSchema = z.object({
  workerId: z.string(),
  identityProof: z.string(),
  version: z.string(),
  platform: z.string(),
  capabilities: z.array(z.string()).readonly(),
  executionProfiles: z.array(z.string()).readonly(),
  resourceClass: z.string(),
  scopes: z.array(OwnershipScopeSchema).readonly().default([]),
})
export type WorkerId = z.infer<typeof WorkerIdSchema>
