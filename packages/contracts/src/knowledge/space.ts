/* SPDX-License-Identifier: MIT */
/**
 * Knowledge spaces.
 *
 * See plan gelé §13 (Target Knowledge Spaces) and runbook §10 P2.5
 * (Phase 0 — gel de la réalité). Four V1 spaces, each with its own
 * role, scope, and authority model.
 *
 * - `personal` — the user's own vault (UnifiaVault/, lives on the
 *   user's machine, full read/write).
 * - `project` — the project repository (`AGENTS.md`, `docs/adr/`,
 *   `KNOWN_FAILURE_PATTERNS.md`, etc.). Read+write in the project
 *   repo.
 * - `session` — ephemeral state attached to a runtime session.
 *   Survives compaction, dies with the session unless explicitly
 *   promoted to personal.
 * - `external` — vault or documentation mounted from outside.
 *   Default: READ ONLY. Capabilities: read, watch, write,
 *   metadata-write. Permissions are explicit.
 */

import { z } from "zod"
import { KnowledgeLocatorSchema, type KnowledgeLocator } from "./identity.js"

/** A space identifier. Stable, opaque, lowercase. */
export const KnowledgeSpaceKindSchema = z.enum([
  "personal",
  "project",
  "session",
  "external",
])
export type KnowledgeSpaceKind = z.infer<typeof KnowledgeSpaceKindSchema>

/** A capability on an External space. `write` requires `read`. */
export const ExternalSpaceCapabilitySchema = z.enum([
  "read",
  "watch",
  "write",
  "metadata-write",
])
export type ExternalSpaceCapability = z.infer<typeof ExternalSpaceCapabilitySchema>

/** A knowledge space. */
export interface KnowledgeSpace {
  /** Discriminator. */
  kind: KnowledgeSpaceKind
  /** Stable identifier of the space. Format is space-specific. */
  id: string
  /** Human-readable label. */
  label: string
  /**
   * For `project` and `personal` spaces, the root locator under
   * which all documents live. Undefined for `session` (session
   * state is not addressable by path) and `external` (resolved
   * per-mount).
   */
  rootLocator?: KnowledgeLocator
  /**
   * For `external` spaces, the explicit capabilities granted by
   * the user. Empty for `personal`, `project`, `session`.
   */
  capabilities?: ExternalSpaceCapability[]
}

export const KnowledgeSpaceSchema = z
  .object({
    kind: KnowledgeSpaceKindSchema,
    id: z.string().min(1),
    label: z.string().min(1),
    rootLocator: KnowledgeLocatorSchema.optional(),
    capabilities: z.array(ExternalSpaceCapabilitySchema).optional(),
  })
  .strict()

/**
 * For project and personal spaces, the canonical roots.
 * - `personalRoot` is `{vaultRoot}/UnifiaVault/` by default.
 * - `projectRoot` is the repository root of the current project.
 */
export const PERSONAL_ROOT_LOCATOR: KnowledgeLocator = "UnifiaVault/"
export const PROJECT_ROOT_LOCATOR: KnowledgeLocator = "./"
