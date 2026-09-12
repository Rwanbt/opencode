/* SPDX-License-Identifier: MIT */
/**
 * Knowledge error types.
 *
 * See ADR-KNOW-0007 §"Erreurs". All errors are typed and serialised
 * via Zod schemas. No panic Rust crosses the boundary; no
 * `unknown` is propagated from TS to Rust.
 */

import { z } from "zod"

export const KnowledgeErrorKindSchema = z.enum([
  /** Egress denied by policy. */
  "egress_denied",
  /** Path resolution failed (symlink, junction, UNC, case). */
  "path_unresolved",
  /** CAS precondition failed (expected vs observed version hash). */
  "cas_mismatch",
  /** Native call exceeded its bound. */
  "bound_exceeded",
  /** Native call exceeded its deadline. */
  "deadline_exceeded",
  /** Cancellation requested before completion. */
  "cancelled",
  /** Mutation refused by policy (e.g. delete of an active note). */
  "mutation_refused",
  /** Index not built; cold start degraded mode. */
  "index_unavailable",
  /** Source registry returned an inconsistency. */
  "source_inconsistent",
  /**
   * The operation requires a capability the space was not granted (e.g.
   * reading an ExternalSource mounted without `read`). The backend is not
   * reached; this is a refusal, not a failure.
   */
  "capability_unavailable",
  /** An invariant was violated; the system is in a degraded state. */
  "invariant_violated",
  /** Internal error; the message is opaque to the user. */
  "internal",
])
export type KnowledgeErrorKind = z.infer<typeof KnowledgeErrorKindSchema>

export interface KnowledgeError {
  kind: KnowledgeErrorKind
  message: string
  /** Optional context. Never contains tokens, paths, or note bodies. */
  context?: Record<string, string | number | boolean>
}

export const KnowledgeErrorSchema = z
  .object({
    kind: KnowledgeErrorKindSchema,
    message: z.string(),
    context: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).optional(),
  })
  .strict()

/** Type guard for KnowledgeError. */
export function isKnowledgeError(value: unknown): value is KnowledgeError {
  return KnowledgeErrorSchema.safeParse(value).success
}
