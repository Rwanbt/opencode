/* SPDX-License-Identifier: MIT */
/**
 * Retrieval contracts.
 *
 * See ADR-KNOW-0007 (NativeKnowledgePort) and ADR-KNOW-0008
 * (Search strategy). All retrieval is bounded: maxCandidates,
 * maxPayloadBytes, maxSnippetBytes, deadlineMs.
 *
 * The TypeScript layer decides WHAT to retrieve; the Rust layer
 * guarantees that the operation is correctly bounded.
 */

import { z } from "zod"
import {
  KnowledgeIdSchema,
  KnowledgeLocatorSchema,
  type KnowledgeId,
  type KnowledgeLocator,
} from "./identity.js"
import {
  KnowledgeSpaceKindSchema,
  type KnowledgeSpaceKind,
} from "./space.js"
import { MemoryTypeSchema, type MemoryType } from "./lifecycle.js"
import { RestrictionLevelSchema, type RestrictionLevel } from "./restrictions.js"

/** Restriction level applied to a candidate. */
export type CandidateRestriction = RestrictionLevel

/** A single retrieval candidate. */
export interface RetrievalCandidate {
  /** Reference to the note. */
  id: KnowledgeId
  /** Normalised path. */
  locator: KnowledgeLocator
  /** Memory type. */
  type: MemoryType
  /** Space the candidate comes from. */
  space: KnowledgeSpaceKind
  /** Trust level: provenance resolved or unverified. */
  trust: "verified" | "unverified"
  /** Authority: who can modify the candidate. */
  authority: "user" | "project" | "agent" | "external"
  /** Effective restriction (intersection of portable and local). */
  restriction: CandidateRestriction
  /** Relevance score, 0..1. */
  relevance: number
  /** Snippet, bounded by maxSnippetBytes. */
  snippet: string
  /** Snippet byte length, for budget accounting. */
  snippetBytes: number
  /** Hash of the snippet content, for audit. */
  snippetHash: string
  /** Optional: source origin (e.g. "decision-gemma4-bash"). */
  sourceTag?: string
}

export const RetrievalCandidateSchema = z
  .object({
    id: KnowledgeIdSchema,
    locator: KnowledgeLocatorSchema,
    type: MemoryTypeSchema,
    space: KnowledgeSpaceKindSchema,
    trust: z.enum(["verified", "unverified"]),
    authority: z.enum(["user", "project", "agent", "external"]),
    restriction: RestrictionLevelSchema,
    relevance: z.number().min(0).max(1),
    snippet: z.string(),
    snippetBytes: z.number().int().nonnegative(),
    snippetHash: z.string().regex(/^[0-9a-f]{64}$/),
    sourceTag: z.string().optional(),
  })
  .strict()

/** Retrieval request. All fields are bounded. */
export interface RetrievalRequest {
  /** Free-text query (CommonMark/GFM). */
  query: string
  /** Restrict to specific spaces. Empty = all V1 spaces. */
  spaces: KnowledgeSpaceKind[]
  /** Restrict to memory types. Empty = all. */
  types: MemoryType[]
  /** Restrict to tags (intersection). Empty = all. */
  tags: string[]
  /** Hard upper bound on number of candidates. */
  maxCandidates: number
  /** Hard upper bound on total payload bytes. */
  maxPayloadBytes: number
  /** Hard upper bound on a single snippet. */
  maxSnippetBytes: number
  /** Deadline in milliseconds. */
  deadlineMs: number
}

export const RetrievalRequestSchema = z
  .object({
    query: z.string().min(1),
    spaces: z.array(KnowledgeSpaceKindSchema).default([]),
    types: z.array(MemoryTypeSchema).default([]),
    tags: z.array(z.string()).default([]),
    maxCandidates: z.number().int().positive().max(1_000),
    maxPayloadBytes: z.number().int().positive().max(16 * 1024 * 1024),
    maxSnippetBytes: z.number().int().positive().max(1024 * 1024),
    deadlineMs: z.number().int().positive().max(60_000),
  })
  .strict()

export interface RetrievalDiagnostics {
  /** Which sources were queried. */
  sourcesQueried: KnowledgeSpaceKind[]
  /** Total candidates scanned. */
  candidatesScanned: number
  /** Candidates dropped by restriction filter. */
  candidatesDroppedByRestriction: number
  /** Wall-clock duration in ms. */
  durationMs: number
  /** Index version used. */
  indexVersion: string
}

export const RetrievalDiagnosticsSchema = z
  .object({
    sourcesQueried: z.array(KnowledgeSpaceKindSchema),
    candidatesScanned: z.number().int().nonnegative(),
    candidatesDroppedByRestriction: z.number().int().nonnegative(),
    durationMs: z.number().int().nonnegative(),
    indexVersion: z.string(),
  })
  .strict()

/** Retrieval response. */
export interface RetrievalResponse {
  /** Ordered candidates, highest relevance first. */
  candidates: RetrievalCandidate[]
  /** Total payload bytes returned. */
  payloadBytes: number
  /** True if the deadline was reached before completion. */
  truncated: boolean
  /** Diagnostics for the Context Inspector. */
  diagnostics: RetrievalDiagnostics
}

export const RetrievalResponseSchema = z
  .object({
    candidates: z.array(RetrievalCandidateSchema),
    payloadBytes: z.number().int().nonnegative(),
    truncated: z.boolean(),
    diagnostics: RetrievalDiagnosticsSchema,
  })
  .strict()

/** Default retrieval bounds (runbook §8.4). */
export const DEFAULT_MAX_CANDIDATES = 50
export const DEFAULT_MAX_PAYLOAD_BYTES = 1024 * 1024
export const DEFAULT_MAX_SNIPPET_BYTES = 64 * 1024
export const DEFAULT_DEADLINE_MS_DESKTOP = 2_000
export const DEFAULT_DEADLINE_MS_ANDROID = 4_000
