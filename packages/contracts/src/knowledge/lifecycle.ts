/* SPDX-License-Identifier: MIT */
/**
 * Memory lifecycle and types.
 *
 * See ADR-KNOW-0009 (Memory lifecycle), plan gelé §28-33.
 *
 * - Memory types: decision, constraint, preference, failure, learning,
 *   procedure, reference, semantic, episodic.
 * - Lifecycle: candidate, active, superseded, archived.
 */

import { z } from "zod"
import {
  PortableRestrictionsFrontmatterSchema,
  type PortableRestrictionsFrontmatter,
} from "./restrictions.js"

/** V1 memory types. */
export const MemoryTypeSchema = z.enum([
  "decision",
  "constraint",
  "preference",
  "failure",
  "learning",
  "procedure",
  "reference",
  "semantic",
  "episodic",
])
export type MemoryType = z.infer<typeof MemoryTypeSchema>

/** V1 lifecycle states. */
export const KnowledgeLifecycleStateSchema = z.enum([
  "candidate",
  "active",
  "superseded",
  "archived",
])
export type KnowledgeLifecycleState = z.infer<typeof KnowledgeLifecycleStateSchema>

/** A note frontmatter (the Class A metadata). */
export interface NoteFrontmatter {
  /** Schema version, always 1 in V1. */
  unifia_schema: 1
  /** UUIDv7. Stable for the lifetime of the note. */
  unifia_id: string
  /** Memory type. */
  unifia_type: MemoryType
  /** Lifecycle state. */
  unifia_lifecycle: KnowledgeLifecycleState
  /** ISO-8601 UTC timestamp. */
  unifia_created_at: string
  /** ISO-8601 UTC timestamp. */
  unifia_updated_at: string
  /** Logical project ref. */
  unifia_project_ref: string
  /** Notes superseded by this one (UUIDv7 list). */
  unifia_supersedes: string[]
  /** Free-form tags for retrieval. */
  unifia_tags: string[]
  /**
   * Portable egress restrictions. Absent means UNCLASSIFIED, which resolves
   * to `DEFAULT_PORTABLE_RESTRICTIONS` (deny remote, deny export).
   * See ADR-KNOW-0006 and its 2026-08-29 amendment.
   */
  unifia_restrictions?: PortableRestrictionsFrontmatter
}

export const NoteFrontmatterSchema = z
  .object({
    unifia_schema: z.literal(1),
    unifia_id: z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[0-9a-f]{4}-[0-9a-f]{12}$/),
    unifia_type: MemoryTypeSchema,
    unifia_lifecycle: KnowledgeLifecycleStateSchema,
    unifia_created_at: z.string().datetime({ offset: true }),
    unifia_updated_at: z.string().datetime({ offset: true }),
    unifia_project_ref: z.string().min(1),
    unifia_supersedes: z.array(z.string()).default([]),
    unifia_tags: z.array(z.string()).default([]),
    unifia_restrictions: PortableRestrictionsFrontmatterSchema.optional(),
  })
  .strict()
