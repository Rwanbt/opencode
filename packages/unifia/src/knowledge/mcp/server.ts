/* SPDX-License-Identifier: MIT */
/**
 * MCP Knowledge server (P9).
 *
 * Per runbook §19: six capabilities, token scoped to a workspace, read by
 * default, write disabled if no secure storage, quotas and rate limits
 * mandatory, payload and deadline bounded.
 *
 * V1 hardening (card C8). Before it, this dispatcher:
 * - never consulted `McpTokenRegistry`, so every method was anonymous;
 * - checked the workspace only on `propose`, so `search`/`get`/`backlinks`/
 *   `trace` accepted any workspace;
 * - threw away the real search results and returned `candidates: []`, and
 *   returned hardcoded empties from `get`/`backlinks`/`trace`;
 * - never used `maxResponseBytes`;
 * - measured request size with `string.length` rather than UTF-8 bytes;
 * - did not rate-limit `status`.
 *
 * Every method now takes an `McpCallContext` carrying the token, and every
 * method authenticates, authorises the workspace, checks the method
 * allowlist, and is rate-limited and byte-bounded.
 */

import type {
  McpKnowledgeSearchRequest,
  McpKnowledgeSearchResponse,
  McpKnowledgeGetRequest,
  McpKnowledgeGetResponse,
  McpKnowledgeBacklinksRequest,
  McpKnowledgeBacklinksResponse,
  McpKnowledgeTraceRequest,
  McpKnowledgeTraceResponse,
  McpKnowledgeStatusResponse,
  McpKnowledgeProposeRequest,
  McpKnowledgeCapability,
  KnowledgeId,
  KnowledgeLocator,
} from "@unifia/contracts/knowledge"
import type { KnowledgeService } from "../facade/service.js"
import type { McpTokenRegistry } from "./token.js"
import { utf8Bytes, truncateUtf8 } from "../context/lexical.js"

export interface McpKnowledgeConfig {
  /** Hard cap on requests per minute. */
  rateLimitPerMinute: number
  /** Hard cap on request body bytes (UTF-8). */
  maxRequestBytes: number
  /** Hard cap on response body bytes (UTF-8). */
  maxResponseBytes: number
  /** Workspace this server serves. */
  workspace: string
}

/** Who is calling. There is no anonymous access in V1. */
export interface McpCallContext {
  tokenId: string
}

export class McpRateLimitExceeded extends Error {
  constructor() {
    super("rate limit exceeded")
    this.name = "McpRateLimitExceeded"
  }
}

export class McpOversizedPayload extends Error {
  constructor(reason: string) {
    super(reason)
    this.name = "McpOversizedPayload"
  }
}

export class McpUnauthorized extends Error {
  constructor(reason: string) {
    super(reason)
    this.name = "McpUnauthorized"
  }
}

export class McpKnowledgeServer {
  private requestCount = 0
  private windowStart = Date.now()

  constructor(
    private readonly service: KnowledgeService,
    private readonly config: McpKnowledgeConfig,
    private readonly tokens: McpTokenRegistry,
  ) {}

  /**
   * Authenticate, authorise, rate-limit and size-check one call.
   * Order matters: an unauthenticated caller must not be able to consume
   * another workspace's rate-limit budget, so authorisation comes first.
   */
  private guard(
    ctx: McpCallContext,
    method: McpKnowledgeCapability,
    request: unknown,
  ): void {
    if (ctx === undefined || typeof ctx.tokenId !== "string" || ctx.tokenId.length === 0) {
      throw new McpUnauthorized("no token supplied")
    }
    // Every request carries its own workspace; it must match the one this
    // server serves. This was checked on `propose` alone, so the four read
    // methods accepted a request naming any workspace.
    const claimed = (request as { workspace?: unknown } | null)?.workspace
    if (typeof claimed === "string" && claimed !== this.config.workspace) {
      throw new McpUnauthorized("workspace mismatch")
    }
    const token = this.tokens.authorize(ctx.tokenId, this.config.workspace, method)
    if (token === null) {
      // Deliberately undifferentiated: unknown, revoked, expired, wrong
      // workspace and out-of-scope all look alike to the caller.
      throw new McpUnauthorized(`token is not authorised for ${method}`)
    }

    const now = Date.now()
    if (now - this.windowStart > 60_000) {
      this.requestCount = 0
      this.windowStart = now
    }
    this.requestCount += 1
    if (this.requestCount > this.config.rateLimitPerMinute) {
      throw new McpRateLimitExceeded()
    }

    const bytes = utf8Bytes(JSON.stringify(request ?? null))
    if (bytes > this.config.maxRequestBytes) {
      throw new McpOversizedPayload(`request body ${bytes} > ${this.config.maxRequestBytes}`)
    }
  }

  /** Enforce the response cap. A truncated answer is never returned silently. */
  private guardResponse<T>(response: T): T {
    const bytes = utf8Bytes(JSON.stringify(response ?? null))
    if (bytes > this.config.maxResponseBytes) {
      throw new McpOversizedPayload(`response body ${bytes} > ${this.config.maxResponseBytes}`)
    }
    return response
  }

  async search(
    req: McpKnowledgeSearchRequest,
    ctx: McpCallContext,
  ): Promise<McpKnowledgeSearchResponse> {
    this.guard(ctx, "knowledge_search", req)
    const out = await this.service.search({
      query: req.query,
      spaces: req.spaces,
      types: req.types,
      tags: req.tags,
      maxCandidates: req.maxCandidates,
      maxPayloadBytes: req.maxPayloadBytes,
      maxSnippetBytes: req.maxSnippetBytes,
      deadlineMs: req.deadlineMs,
    })

    // Return what the router actually found. This used to be `[]`.
    const candidates = out.pack.items.map((item) => ({
      id: item.ref.id,
      locator: item.ref.locator,
      type: item.type,
      space: item.source,
      trust: item.trust,
      authority: item.authority,
      restriction: item.restriction,
      relevance: item.relevance,
      snippet: item.snippet,
      snippetBytes: utf8Bytes(item.snippet),
      snippetHash: item.contentHash,
    }))

    return this.guardResponse({
      candidates,
      payloadBytes: candidates.reduce((n, c) => n + c.snippetBytes, 0),
      truncated: out.truncated,
      diagnostics: {
        sourcesQueried: out.pack.diagnostics.sourcesQueried,
        candidatesScanned: out.pack.diagnostics.candidatesScanned,
        candidatesDroppedByRestriction: out.pack.diagnostics.candidatesDroppedByRestriction,
        durationMs: out.pack.diagnostics.durationMs,
        indexVersion: "v1",
      },
    })
  }

  async get(req: McpKnowledgeGetRequest, ctx: McpCallContext): Promise<McpKnowledgeGetResponse> {
    this.guard(ctx, "knowledge_get", req)
    const found = await this.service.get(
      req.id as KnowledgeId | undefined,
      req.locator as KnowledgeLocator | undefined,
    )
    if (found === null) return this.guardResponse({ found: false, bodyBytes: 0 })

    const candidate = found.candidates[0]
    if (candidate === undefined) return this.guardResponse({ found: false, bodyBytes: 0 })

    // The contract declares body, id, locator and versionHash; only `found`
    // and `bodyBytes` were ever returned, so the caller got a note that
    // exists and no way to read it. `maxBytes` was accepted and ignored.
    const body = truncateUtf8(candidate.snippet, req.maxBytes)
    return this.guardResponse({
      found: true,
      id: candidate.id,
      locator: candidate.locator,
      body,
      bodyBytes: utf8Bytes(body),
      versionHash: candidate.snippetHash,
    })
  }

  async backlinks(
    req: McpKnowledgeBacklinksRequest,
    ctx: McpCallContext,
  ): Promise<McpKnowledgeBacklinksResponse> {
    this.guard(ctx, "knowledge_backlinks", req)
    const ids = await this.service.backlinks({
      id: req.targetId as KnowledgeId | undefined,
      locator: req.targetLocator as KnowledgeLocator | undefined,
    })
    const sources: McpKnowledgeBacklinksResponse["sources"] = []
    for (const id of ids.slice(0, req.limit)) {
      const found = await this.service.get(id)
      const candidate = found?.candidates[0]
      if (candidate === undefined) continue
      sources.push({
        id: candidate.id,
        locator: candidate.locator,
        snippet: candidate.snippet.slice(0, 200),
      })
    }
    return this.guardResponse({ sources })
  }

  async trace(
    req: McpKnowledgeTraceRequest,
    ctx: McpCallContext,
  ): Promise<McpKnowledgeTraceResponse> {
    this.guard(ctx, "knowledge_trace", req)
    // Walk the `unifia_supersedes` lineage Class A actually carries. This
    // used `backlinks()`, which mixes ordinary wikilinks with supersession
    // and reported every hop as "supersedes" whatever its real direction.
    const nodes: McpKnowledgeTraceResponse["nodes"] = []
    const seen = new Set<string>([req.id])
    let frontier: string[] = [req.id]

    for (let depth = 1; depth <= req.maxDepth && frontier.length > 0; depth++) {
      const next: string[] = []
      for (const id of frontier) {
        for (const superseded of await this.service.lineage(id as KnowledgeId)) {
          if (seen.has(superseded)) continue
          seen.add(superseded)
          const found = await this.service.get(superseded as KnowledgeId)
          const candidate = found?.candidates[0]
          if (candidate === undefined) continue
          nodes.push({
            id: candidate.id,
            locator: candidate.locator,
            depth,
            // The walk runs from the newer note toward what it replaced.
            relation: "supersedes",
          })
          next.push(superseded)
        }
      }
      frontier = next
    }
    return this.guardResponse({ nodes })
  }

  async status(ctx: McpCallContext): Promise<McpKnowledgeStatusResponse> {
    // status is authenticated and rate-limited like every other method: it
    // was the one free probe into a workspace.
    this.guard(ctx, "knowledge_status", null)
    return this.guardResponse(await this.service.status())
  }

  async propose(
    req: McpKnowledgeProposeRequest,
    ctx: McpCallContext,
  ): Promise<{ applied: boolean; auditId: string }> {
    this.guard(ctx, "knowledge_propose", req)
    if (req.workspace !== this.config.workspace) {
      throw new McpUnauthorized("workspace mismatch")
    }
    return this.guardResponse(
      await this.service.propose({ intent: req.intent, reason: "mcp", source: "mcp" }),
    )
  }

  capabilities(): McpKnowledgeCapability[] {
    return [
      "knowledge_search",
      "knowledge_get",
      "knowledge_backlinks",
      "knowledge_trace",
      "knowledge_status",
      "knowledge_propose",
    ]
  }
}
