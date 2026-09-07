/* SPDX-License-Identifier: MIT */
/**
 * MCP Knowledge contracts.
 *
 * See runbook §19 Phase 9 (MCP). Six capabilities are exposed:
 * `knowledge_search`, `knowledge_get`, `knowledge_backlinks`,
 * `knowledge_trace`, `knowledge_status`, `knowledge_propose`.
 *
 * Read by default, write disabled if no secure storage.
 */

import { z } from "zod"
import {
  KnowledgeIdSchema,
  KnowledgeLocatorSchema,
  type KnowledgeId,
  type KnowledgeLocator,
} from "./identity.js"
import {
  RetrievalResponseSchema,
  type RetrievalResponse,
} from "./retrieval.js"
import { MutationIntentSchema } from "./mutation.js"

/** Capability name. */
export const McpKnowledgeCapabilitySchema = z.enum([
  "knowledge_search",
  "knowledge_get",
  "knowledge_backlinks",
  "knowledge_trace",
  "knowledge_status",
  "knowledge_propose",
])
export type McpKnowledgeCapability = z.infer<typeof McpKnowledgeCapabilitySchema>

/** `knowledge_search` request. */
export interface McpKnowledgeSearchRequest {
  workspace: string
  query: string
  maxCandidates: number
  maxPayloadBytes: number
  maxSnippetBytes: number
  deadlineMs: number
  spaces: string[]
  types: string[]
  tags: string[]
}

export const McpKnowledgeSearchRequestSchema = z
  .object({
    workspace: z.string().min(1),
    query: z.string().min(1),
    maxCandidates: z.number().int().positive().max(1_000),
    maxPayloadBytes: z.number().int().positive().max(16 * 1024 * 1024),
    maxSnippetBytes: z.number().int().positive().max(1024 * 1024),
    deadlineMs: z.number().int().positive().max(60_000),
    spaces: z.array(z.string()),
    types: z.array(z.string()),
    tags: z.array(z.string()),
  })
  .strict()

/** `knowledge_search` response wraps a `RetrievalResponse`. */
export type McpKnowledgeSearchResponse = RetrievalResponse
export const McpKnowledgeSearchResponseSchema = RetrievalResponseSchema

/** `knowledge_get` request. */
export interface McpKnowledgeGetRequest {
  workspace: string
  id?: KnowledgeId
  locator?: KnowledgeLocator
  maxBytes: number
  deadlineMs: number
}

export const McpKnowledgeGetRequestSchema = z
  .object({
    workspace: z.string().min(1),
    id: KnowledgeIdSchema.optional(),
    locator: KnowledgeLocatorSchema.optional(),
    maxBytes: z.number().int().positive().max(1024 * 1024),
    deadlineMs: z.number().int().positive().max(60_000),
  })
  .strict()

export interface McpKnowledgeGetResponse {
  found: boolean
  id?: KnowledgeId
  locator?: KnowledgeLocator
  body?: string
  bodyBytes: number
  versionHash?: string
}

export const McpKnowledgeGetResponseSchema = z
  .object({
    found: z.boolean(),
    id: KnowledgeIdSchema.optional(),
    locator: KnowledgeLocatorSchema.optional(),
    body: z.string().optional(),
    bodyBytes: z.number().int().nonnegative(),
    versionHash: z.string().regex(/^[0-9a-f]{64}$/).optional(),
  })
  .strict()

/** `knowledge_backlinks` request. */
export const McpKnowledgeBacklinksRequestSchema = z
  .object({
    workspace: z.string().min(1),
    targetId: KnowledgeIdSchema.optional(),
    targetLocator: KnowledgeLocatorSchema.optional(),
    limit: z.number().int().positive().max(1_000),
    cursor: z.string().optional(),
    deadlineMs: z.number().int().positive().max(60_000),
  })
  .strict()

export interface McpKnowledgeBacklinksRequest {
  workspace: string
  targetId?: KnowledgeId
  targetLocator?: KnowledgeLocator
  limit: number
  cursor?: string
  deadlineMs: number
}

export interface McpKnowledgeBacklinksResponse {
  sources: Array<{
    id: KnowledgeId
    locator: KnowledgeLocator
    snippet: string
  }>
  nextCursor?: string
}

export const McpKnowledgeBacklinksResponseSchema = z
  .object({
    sources: z.array(
      z
        .object({
          id: KnowledgeIdSchema,
          locator: KnowledgeLocatorSchema,
          snippet: z.string(),
        })
        .strict(),
    ),
    nextCursor: z.string().optional(),
  })
  .strict()

/** `knowledge_trace` request — walks the provenance graph. */
export const McpKnowledgeTraceRequestSchema = z
  .object({
    workspace: z.string().min(1),
    id: KnowledgeIdSchema,
    maxDepth: z.number().int().positive().max(16),
    deadlineMs: z.number().int().positive().max(60_000),
  })
  .strict()

export interface McpKnowledgeTraceRequest {
  workspace: string
  id: KnowledgeId
  maxDepth: number
  deadlineMs: number
}

export interface McpKnowledgeTraceResponse {
  nodes: Array<{
    id: KnowledgeId
    locator: KnowledgeLocator
    depth: number
    relation: "supersedes" | "superseded-by" | "references" | "cited-by" | "derived-from"
  }>
}

export const McpKnowledgeTraceResponseSchema = z
  .object({
    nodes: z.array(
      z
        .object({
          id: KnowledgeIdSchema,
          locator: KnowledgeLocatorSchema,
          depth: z.number().int().nonnegative(),
          relation: z.enum([
            "supersedes",
            "superseded-by",
            "references",
            "cited-by",
            "derived-from",
          ]),
        })
        .strict(),
    ),
  })
  .strict()

/** `knowledge_status` response. */
export interface McpKnowledgeStatusResponse {
  indexVersion: string
  rebuiltAt: string
  candidatesCount: number
  spaces: string[]
  capabilities: {
    name: McpKnowledgeCapability
    readOnly: boolean
  }[]
  enabled: { fts: boolean; vector: boolean; graph: boolean }
}

export const McpKnowledgeStatusResponseSchema = z
  .object({
    indexVersion: z.string(),
    rebuiltAt: z.string().datetime({ offset: true }),
    candidatesCount: z.number().int().nonnegative(),
    spaces: z.array(z.string()),
    capabilities: z.array(
      z
        .object({
          name: McpKnowledgeCapabilitySchema,
          readOnly: z.boolean(),
        })
        .strict(),
    ),
    enabled: z
      .object({
        fts: z.boolean(),
        vector: z.boolean(),
        graph: z.boolean(),
      })
      .strict(),
  })
  .strict()

/** `knowledge_propose` request — write a candidate. */
export const McpKnowledgeProposeRequestSchema = z
  .object({
    workspace: z.string().min(1),
    intent: MutationIntentSchema,
  })
  .strict()

export type McpKnowledgeProposeRequest = z.infer<typeof McpKnowledgeProposeRequestSchema>

/** The six MCP capability method names. */
export const MCP_KNOWLEDGE_METHODS = [
  "knowledge_search",
  "knowledge_get",
  "knowledge_backlinks",
  "knowledge_trace",
  "knowledge_status",
  "knowledge_propose",
] as const
