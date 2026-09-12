/* SPDX-License-Identifier: MIT */
/**
 * Portable restrictions and provenance.
 *
 * See ADR-KNOW-0006 (Egress policy) and plan gelé §34 (Provenance).
 *
 * `PortableRestrictions` may only RESTRICT. They travel with the
 * note (Class A) and can be tightened by a local action
 * (Class C) but never loosened.
 */

import { z } from "zod"

/**
 * Restriction level. `deny` is the default for unclassified content
 * egressing to a remote model.
 */
export const RestrictionLevelSchema = z.enum(["allow", "deny"])
export type RestrictionLevel = z.infer<typeof RestrictionLevelSchema>

/**
 * Portable restrictions carried in a note's frontmatter. They
 * can only restrict; missing fields default to `deny` for egress
 * (see ADR-KNOW-0006 §1).
 */
export interface PortableRestrictions {
  /** Egress to a remote (cloud) LLM. Default: deny. */
  remoteModel: RestrictionLevel
  /** Egress to a local LLM. Default: allow. */
  localModel: RestrictionLevel
  /**
   * Whether the content may be embedded into the FTS / vector
   * index. Default: allow. Some notes (e.g. credentials) must
   * NOT be embedded.
   */
  embeddable: RestrictionLevel
  /**
   * Whether the content may be exported by an exporter
   * (Langfuse, etc.). Default: deny for UNCLASSIFIED.
   */
  exportable: RestrictionLevel
}

export const PortableRestrictionsSchema = z
  .object({
    remoteModel: RestrictionLevelSchema,
    localModel: RestrictionLevelSchema,
    embeddable: RestrictionLevelSchema,
    exportable: RestrictionLevelSchema,
  })
  .strict()

/**
 * Defaults for a note that carries no restrictions block.
 *
 * UNCLASSIFIED is treated as `deny` toward anything that leaves the machine
 * (ADR-KNOW-0006 §2) and `allow` toward local processing, so that adding a
 * note never silently widens what may leave.
 */
export const DEFAULT_PORTABLE_RESTRICTIONS: PortableRestrictions = {
  remoteModel: "deny",
  localModel: "allow",
  embeddable: "allow",
  exportable: "deny",
}

/**
 * The single frontmatter key carrying portable restrictions.
 *
 * There were three competing spellings before V1 shipped:
 * `unifia_restrictions` (ADR-KNOW-0002/0006), `portable_restrictions`
 * (PERMISSIONS.md) and the camelCase contracts type — and none was
 * implemented. This constant is the canonical one; see the ADR-KNOW-0006
 * amendment of 2026-08-29.
 */
export const RESTRICTIONS_FRONTMATTER_KEY = "unifia_restrictions"

/**
 * The on-disk shape. Frontmatter stays snake_case like every other
 * `unifia_*` key; the camelCase `PortableRestrictions` is the in-memory type.
 * Every field is optional and falls back to its fail-closed default.
 */
export const PortableRestrictionsFrontmatterSchema = z
  .object({
    remote_model: RestrictionLevelSchema.optional(),
    local_model: RestrictionLevelSchema.optional(),
    embeddable: RestrictionLevelSchema.optional(),
    exportable: RestrictionLevelSchema.optional(),
  })
  .strict()

export type PortableRestrictionsFrontmatter = z.infer<
  typeof PortableRestrictionsFrontmatterSchema
>

/** Read the on-disk shape into the canonical type, applying the defaults. */
export function portableRestrictionsFromFrontmatter(
  raw: PortableRestrictionsFrontmatter | undefined,
): PortableRestrictions {
  if (raw === undefined) return { ...DEFAULT_PORTABLE_RESTRICTIONS }
  return {
    remoteModel: raw.remote_model ?? DEFAULT_PORTABLE_RESTRICTIONS.remoteModel,
    localModel: raw.local_model ?? DEFAULT_PORTABLE_RESTRICTIONS.localModel,
    embeddable: raw.embeddable ?? DEFAULT_PORTABLE_RESTRICTIONS.embeddable,
    exportable: raw.exportable ?? DEFAULT_PORTABLE_RESTRICTIONS.exportable,
  }
}

/** Write the canonical type back to the on-disk shape, omitting defaults. */
export function portableRestrictionsToFrontmatter(
  r: PortableRestrictions,
): PortableRestrictionsFrontmatter {
  const out: PortableRestrictionsFrontmatter = {}
  if (r.remoteModel !== DEFAULT_PORTABLE_RESTRICTIONS.remoteModel) out.remote_model = r.remoteModel
  if (r.localModel !== DEFAULT_PORTABLE_RESTRICTIONS.localModel) out.local_model = r.localModel
  if (r.embeddable !== DEFAULT_PORTABLE_RESTRICTIONS.embeddable) out.embeddable = r.embeddable
  if (r.exportable !== DEFAULT_PORTABLE_RESTRICTIONS.exportable) out.exportable = r.exportable
  return out
}

/**
 * Combine restrictions so that the strictest wins (ADR-KNOW-0006 §3,
 * heritage). A transformation of several notes inherits every `deny`.
 */
export function mostRestrictive(
  ...all: readonly PortableRestrictions[]
): PortableRestrictions {
  const strictest = (a: RestrictionLevel, b: RestrictionLevel): RestrictionLevel =>
    a === "deny" || b === "deny" ? "deny" : "allow"
  return all.reduce(
    (acc, r) => ({
      remoteModel: strictest(acc.remoteModel, r.remoteModel),
      localModel: strictest(acc.localModel, r.localModel),
      embeddable: strictest(acc.embeddable, r.embeddable),
      exportable: strictest(acc.exportable, r.exportable),
    }),
    { remoteModel: "allow", localModel: "allow", embeddable: "allow", exportable: "allow" },
  )
}

/**
 * Minimal portable provenance. Carried in the note frontmatter.
 * Anything that is device- or session-specific belongs in Class C,
 * not here. See ADR-KNOW-0003 (Class B copy-on-write) for
 * portable aliases and external IDs.
 */
export interface PortableProvenance {
  /** When the note was first written (ISO-8601, UTC). */
  createdAt: string
  /** When the note was last updated (ISO-8601, UTC). */
  updatedAt: string
  /** Logical project ref, e.g. "unifia". Free-form string. */
  projectRef: string
  /** Source document path, if imported. */
  sourceDocument?: string
  /** Source commit SHA, if known. */
  sourceCommit?: string
}

export const PortableProvenanceSchema = z
  .object({
    createdAt: z.string().datetime({ offset: true }),
    updatedAt: z.string().datetime({ offset: true }),
    projectRef: z.string().min(1),
    sourceDocument: z.string().optional(),
    sourceCommit: z.string().regex(/^[0-9a-f]{7,64}$/i).optional(),
  })
  .strict()
