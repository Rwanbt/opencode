/* SPDX-License-Identifier: MIT */
import { z } from "zod"

export const OverlapPolicySchema = z.enum(["allow", "forbid", "queue", "replace"])
export type OverlapPolicy = z.infer<typeof OverlapPolicySchema>

export const CatchUpPolicySchema = z.enum(["skip", "fire-once", "fire-each-missed"])
export type CatchUpPolicy = z.infer<typeof CatchUpPolicySchema>
