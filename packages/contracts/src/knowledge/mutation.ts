/* SPDX-License-Identifier: MIT */
/**
 * Mutation contracts.
 *
 * See ADR-KNOW-0002 (Markdown canonical) and runbook §13 Phase 2.3
 * (Mutation WAL). All mutations are explicit, intent-based, and
 * produce an audit record. No silent mutation, no silent delete.
 */

import { z } from "zod"
import {
  KnowledgeIdSchema,
  KnowledgeLocatorSchema,
  KnowledgeVersionHashSchema,
  type KnowledgeId,
  type KnowledgeLocator,
  type KnowledgeVersionHash,
} from "./identity.js"
import { MemoryTypeSchema, KnowledgeLifecycleStateSchema } from "./lifecycle.js"
import {
  PortableRestrictionsSchema,
  type PortableRestrictions,
} from "./restrictions.js"

export type MutationKind =
  | "create"
  | "update"
  | "delete"
  | "move"
  | "promote"
  | "supersede"
  | "archive"
  | "restore"

export const MutationKindSchema = z.enum([
  "create",
  "update",
  "delete",
  "move",
  "promote",
  "supersede",
  "archive",
  "restore",
])

/** Intent to mutate a knowledge document. */
export interface MutationIntent {
  kind: MutationKind
  /** Target document identifier (for update/delete/move/supersede/archive/restore). */
  targetId?: KnowledgeId
  /** Target document locator (for create/move). */
  targetLocator?: KnowledgeLocator
  /** Observed version hash (CAS). Required for update/delete/move. */
  expectedVersionHash?: KnowledgeVersionHash
  /** For supersede: the new note's id, which becomes active. */
  successorId?: KnowledgeId
  /** New content (for create/update). */
  newContent?: {
    type: z.infer<typeof MemoryTypeSchema>
    restrictions: PortableRestrictions
    body: string
  }
  /** New tags (for create/update). */
  tags?: string[]
  /** Reason, for audit. Free-form but required. */
  reason: string
  /** Source agent / user identifier. */
  source: string
}

export const MutationIntentSchema = z
  .object({
    kind: MutationKindSchema,
    targetId: KnowledgeIdSchema.optional(),
    targetLocator: KnowledgeLocatorSchema.optional(),
    expectedVersionHash: KnowledgeVersionHashSchema.optional(),
    successorId: KnowledgeIdSchema.optional(),
    newContent: z
      .object({
        type: MemoryTypeSchema,
        restrictions: PortableRestrictionsSchema,
        body: z.string(),
      })
      .strict()
      .optional(),
    tags: z.array(z.string()).optional(),
    reason: z.string().min(1),
    source: z.string().min(1),
  })
  .strict()
  .refine(
    (m: MutationIntent) =>
      (m.kind === "create" && m.targetLocator !== undefined) ||
      (m.kind === "update" &&
        m.targetId !== undefined &&
        m.expectedVersionHash !== undefined) ||
      (m.kind === "delete" &&
        m.targetId !== undefined &&
        m.expectedVersionHash !== undefined) ||
      (m.kind === "move" &&
        m.targetId !== undefined &&
        m.targetLocator !== undefined &&
        m.expectedVersionHash !== undefined) ||
      // Every mutation of an existing document is compare-and-swap protected.
      // The lifecycle transitions used to be exempt here while the writer
      // required a hash anyway, so a schema-valid intent could still be
      // refused downstream.
      (m.kind === "promote" &&
        m.targetId !== undefined &&
        m.expectedVersionHash !== undefined) ||
      (m.kind === "supersede" &&
        m.targetId !== undefined &&
        m.successorId !== undefined &&
        m.expectedVersionHash !== undefined) ||
      (m.kind === "archive" &&
        m.targetId !== undefined &&
        m.expectedVersionHash !== undefined) ||
      (m.kind === "restore" &&
        m.targetId !== undefined &&
        m.expectedVersionHash !== undefined),
    {
      message:
        "Mutation intent missing required fields (e.g. targetId for update, targetLocator for create, expectedVersionHash for any mutation of an existing note).",
    },
  )

/** Result of a mutation. */
export interface MutationResult {
  /** True if the mutation was applied. */
  applied: boolean
  /** The new state of the document (or its absence on delete). */
  ref?: {
    id: KnowledgeId
    locator: KnowledgeLocator
    versionHash: KnowledgeVersionHash
  }
  /** New lifecycle state, if changed. */
  newLifecycle?: z.infer<typeof KnowledgeLifecycleStateSchema>
  /** Audit record. */
  auditId: string
}

export const MutationResultSchema = z
  .object({
    applied: z.boolean(),
    ref: z
      .object({
        id: KnowledgeIdSchema,
        locator: KnowledgeLocatorSchema,
        versionHash: KnowledgeVersionHashSchema,
      })
      .strict()
      .optional(),
    newLifecycle: KnowledgeLifecycleStateSchema.optional(),
    auditId: z.string().min(1),
  })
  .strict()
