/* SPDX-License-Identifier: MIT */
/**
 * Knowledge document identity.
 *
 * See ADR-KNOW-0001 (`docs/knowledge/adr/0001-knowledge-identity.md`).
 * Three fields cohabit, each with a distinct role:
 *
 * - `KnowledgeId` (UUIDv7) — stable identity of the note.
 * - `KnowledgeLocator` — normalised path relative to the Knowledge Root.
 * - `KnowledgeVersionHash` — BLAKE3 or SHA-256 of the content.
 *
 * No field is derived from another, and no field leaks the content.
 */

import { z } from "zod"

/** Canonical UUIDv7 representation: lowercase hex with hyphens. */
export const KNOWLEDGE_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[0-9a-f]{4}-[0-9a-f]{12}$/

export const KnowledgeIdSchema = z
  .string()
  .regex(
    KNOWLEDGE_ID_PATTERN,
    "KnowledgeId must be a canonical UUIDv7 (RFC 9562, lowercase, hyphenated).",
  )

export type KnowledgeId = z.infer<typeof KnowledgeIdSchema>

/**
 * Locator = normalised path relative to the Knowledge Root.
 *
 * Must not contain `..`, must use `/` as separator, must be
 * relative (no leading `/`). On Windows, the locator is stored with
 * `/`; resolution to a physical path is the responsibility of
 * `ResolvedKnowledgePath` in the Rust core.
 */
export const KnowledgeLocatorSchema = z
  .string()
  .min(1)
  .refine((s: string) => !s.includes(".."), "Locator must not contain '..'")
  .refine((s: string) => !s.startsWith("/"), "Locator must be relative (no leading '/')")
  .refine(
    (s: string) => !/^[a-zA-Z]:[\\/]/.test(s),
    "Locator must not be an absolute path",
  )
  .refine(
    (s: string) => !s.includes("\\"),
    "Locator must use '/' separator, not '\\\\'",
  )

export type KnowledgeLocator = z.infer<typeof KnowledgeLocatorSchema>

/**
 * Version hash of the content. BLAKE3 hex (64 chars) if available
 * in the runtime; SHA-256 hex (64 chars) otherwise. We use a single
 * pattern that accepts both formats because they share the same
 * length and character set.
 */
export const KNOWLEDGE_VERSION_HASH_PATTERN = /^[0-9a-f]{64}$/

export const KnowledgeVersionHashSchema = z
  .string()
  .regex(
    KNOWLEDGE_VERSION_HASH_PATTERN,
    "KnowledgeVersionHash must be a 64-char hex string (BLAKE3 or SHA-256).",
  )

export type KnowledgeVersionHash = z.infer<typeof KnowledgeVersionHashSchema>

/** Hash algorithm used for `KnowledgeVersionHash`. */
export const KnowledgeHashAlgorithmSchema = z.enum(["blake3", "sha256"])
export type KnowledgeHashAlgorithm = z.infer<typeof KnowledgeHashAlgorithmSchema>

/**
 * Identity triple: a Knowledge document is identified by its ID,
 * located by its locator, and versioned by its content hash.
 *
 * - `id` is assigned once at promotion and never changes.
 * - `locator` is rewritten on file move (with a `file.moved` event).
 * - `versionHash` changes on every successful write (post-fsync).
 */
export interface KnowledgeRef {
  /** UUIDv7. Stable for the lifetime of the note. */
  id: KnowledgeId
  /** Normalised path relative to the Knowledge Root. */
  locator: KnowledgeLocator
  /** Hash of the current content. */
  versionHash: KnowledgeVersionHash
  /** Hash algorithm used to produce `versionHash`. */
  hashAlgorithm: KnowledgeHashAlgorithm
}

export const KnowledgeRefSchema = z.object({
  id: KnowledgeIdSchema,
  locator: KnowledgeLocatorSchema,
  versionHash: KnowledgeVersionHashSchema,
  hashAlgorithm: KnowledgeHashAlgorithmSchema,
})
  .strict()
export type KnowledgeRefInput = z.infer<typeof KnowledgeRefSchema>
