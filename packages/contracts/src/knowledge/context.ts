/* SPDX-License-Identifier: MIT */
/**
 * Context router contracts.
 *
 * See plan gelé §35-36 (ContextRouter, ContextPack) and runbook §11
 * Phase 1 (ContextRouter baseline). A `ContextPack` is the
 * authoritative artifact the agent consumes; it is bounded, has a
 * per-item restriction, and a `ProviderDestinationPlan`.
 */

import { z } from "zod"
import {
  KnowledgeIdSchema,
  type KnowledgeId,
  type KnowledgeLocator,
  KnowledgeLocatorSchema,
} from "./identity.js"
import {
  KnowledgeSpaceKindSchema,
  type KnowledgeSpaceKind,
} from "./space.js"
import { MemoryTypeSchema, type MemoryType } from "./lifecycle.js"
import { RestrictionLevelSchema, type RestrictionLevel } from "./restrictions.js"

/** Trust level of a ContextItem. */
export const TrustSchema = z.enum(["verified", "unverified"])
export type Trust = z.infer<typeof TrustSchema>

/** Authority level of a ContextItem. */
export const AuthoritySchema = z.enum(["user", "project", "agent", "external"])
export type Authority = z.infer<typeof AuthoritySchema>

/** A single item in a ContextPack. */
export interface ContextItem {
  ref: {
    id: KnowledgeId
    locator: KnowledgeLocator
  }
  source: KnowledgeSpaceKind
  type: MemoryType
  trust: Trust
  authority: Authority
  /** Effective restriction for THIS context item. */
  restriction: RestrictionLevel
  /** Relevance score, 0..1. */
  relevance: number
  /** Token cost of the item (estimated). */
  tokenCost: number
  /** Hash of the item content. */
  contentHash: string
  /** Snippet, bounded. */
  snippet: string
  /** Why this item was included. */
  reason: string
  /** Optional temporal state (e.g. "active", "superseded"). */
  temporalState?: string
}

export const ContextItemSchema = z
  .object({
    ref: z
      .object({
        id: KnowledgeIdSchema,
        locator: KnowledgeLocatorSchema,
      })
      .strict(),
    source: KnowledgeSpaceKindSchema,
    type: MemoryTypeSchema,
    trust: TrustSchema,
    authority: AuthoritySchema,
    restriction: RestrictionLevelSchema,
    relevance: z.number().min(0).max(1),
    tokenCost: z.number().int().nonnegative(),
    contentHash: z.string().regex(/^[0-9a-f]{64}$/),
    snippet: z.string(),
    reason: z.string().min(1),
    temporalState: z.string().optional(),
  })
  .strict()

/**
 * Where a destination lives. ADR-KNOW-0006 §2 denies UNCLASSIFIED content
 * toward anything external, so the guard has to be able to tell the two
 * apart; PERMISSIONS.md §3 already draws this line (`provider:<id>` vs
 * `provider:<id>:remote`). Omitted means `remote`: a destination that does
 * not say it is local is treated as if it leaves the machine.
 */
export const DestinationKindSchema = z.enum(["local", "remote"])
export type DestinationKind = z.infer<typeof DestinationKindSchema>

/** Provider destination plan: per-item, where the item can be sent. */
export interface ProviderDestinationPlan {
  /** Provider identifier (e.g. "anthropic", "openai", "local-llm"). */
  providerId: string
  /**
   * Whether this destination stays on the machine. Defaults to `remote`.
   * A local destination is matched against a note's `local_model`
   * restriction, a remote one against `remote_model`.
   */
  destinationKind?: DestinationKind
  /** Per-item override. Missing = inherit from `defaultRestriction`. */
  overrides?: Record<string, RestrictionLevel>
  /** Default restriction for this provider. */
  defaultRestriction: RestrictionLevel
}

export const ProviderDestinationPlanSchema = z
  .object({
    providerId: z.string().min(1),
    destinationKind: DestinationKindSchema.optional(),
    overrides: z.record(z.string(), RestrictionLevelSchema).optional(),
    defaultRestriction: RestrictionLevelSchema,
  })
  .strict()

/** Diagnostics of a ContextPack. */
export interface ContextDiagnostics {
  /** Which spaces were queried. */
  sourcesQueried: KnowledgeSpaceKind[]
  /** Total candidates scanned. */
  candidatesScanned: number
  /** Candidates dropped by restriction. */
  candidatesDroppedByRestriction: number
  /** Total token cost of the pack. */
  totalTokenCost: number
  /** Wall-clock duration. */
  durationMs: number
  /** Reason an item was excluded (for the Context Inspector). */
  excludedReasons?: Record<string, string>
}

export const ContextDiagnosticsSchema = z
  .object({
    sourcesQueried: z.array(KnowledgeSpaceKindSchema),
    candidatesScanned: z.number().int().nonnegative(),
    candidatesDroppedByRestriction: z.number().int().nonnegative(),
    totalTokenCost: z.number().int().nonnegative(),
    durationMs: z.number().int().nonnegative(),
    excludedReasons: z.record(z.string(), z.string()).optional(),
  })
  .strict()

/** A ContextPack. The authoritative artifact the agent consumes. */
export interface ContextPack {
  providerPlan: ProviderDestinationPlan
  tokenBudget: number
  items: ContextItem[]
  diagnostics: ContextDiagnostics
}

export const ContextPackSchema = z
  .object({
    providerPlan: ProviderDestinationPlanSchema,
    tokenBudget: z.number().int().nonnegative(),
    items: z.array(ContextItemSchema),
    diagnostics: ContextDiagnosticsSchema,
  })
  .strict()
