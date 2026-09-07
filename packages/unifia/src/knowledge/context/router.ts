/* SPDX-License-Identifier: MIT */
/**
 * ContextRouter — produces a `ContextPack` from a `RetrievalRequest` and a
 * `SourceRegistry`.
 *
 * Per ADR-KNOW-0007 (bounds) and ADR-KNOW-0008 (search), the router:
 * 1. validates the request against its schema,
 * 2. fans out to the requested spaces,
 * 3. reads real note content and scores it lexically,
 * 4. applies the egress policy (policy/egress.ts),
 * 5. enforces every bound — candidates, snippet bytes, payload bytes,
 *    deadline — and reports truncation,
 * 6. ranks deterministically and emits diagnostics.
 *
 * V1 has no FTS5 runtime: ranking is the bounded linear scan in
 * `lexical.ts`, and `knowledge status` reports `fts: false`. The router never
 * fabricates a candidate — a note that cannot be read is dropped with a
 * reason, not padded with an empty snippet.
 */

import type {
  ContextItem,
  ContextPack,
  ContextDiagnostics,
  ProviderDestinationPlan,
  RetrievalRequest,
  KnowledgeSpaceKind,
  PortableRestrictions,
} from "@unifia/contracts/knowledge"
import {
  ProviderDestinationPlanSchema,
  RetrievalRequestSchema,
  portableRestrictionsFromFrontmatter,
} from "@unifia/contracts/knowledge"
import { createHash } from "node:crypto"
import type { KnowledgeSource, SourceRegistry, ListedNote } from "../source/source.js"
import { clearForEgress, type ClearedItem, type GrantConsumer } from "../policy/egress.js"
import { egressAuditEntry, type EgressAudit } from "../policy/audit.js"
import { KnowledgeFailure } from "../domain/errors.js"
import { bestSnippet, scoreNote, tokenize, utf8Bytes } from "./lexical.js"
import { withDeadline, remainingMs, DeadlineExceeded } from "./deadline.js"

/** Heuristic token cost: ~4 chars per token. */
function estimateTokens(s: string): number {
  return s.length === 0 ? 0 : Math.max(1, Math.ceil(s.length / 4))
}

const DEFAULT_TOKEN_BUDGET = 8_000
const DEFAULT_MAX_PER_TYPE = 8

/** Lifecycles excluded from active retrieval (ADR-KNOW-0009 §3, §4). */
const NON_RETRIEVABLE_LIFECYCLES = new Set(["superseded", "archived"])

export interface ContextRouterConfig {
  providerPlan: ProviderDestinationPlan
  tokenBudget?: number
  maxPerType?: number
  /**
   * Include superseded and archived notes. Off by default: a superseded note
   * stays reachable through `knowledge_get`, not through retrieval.
   */
  includeInactive?: boolean
  /**
   * Records every egress decision (ADR-KNOW-0006 §6). Supplied by the
   * composition root; omitted only in unit tests that assert routing itself.
   */
  audit?: EgressAudit
  /**
   * Declassification grants (ADR-KNOW-0006 §3). Consulted only after a deny;
   * omitted means nothing can widen a refusal.
   */
  grants?: GrantConsumer
}

export interface RouterOutput {
  pack: ContextPack
  /** Items dropped by policy or bounds, with reasons (for the Inspector). */
  excluded: Array<{ locator: string; reason: string }>
  /** True when a bound or the deadline stopped the scan early. */
  truncated: boolean
}

/** A note that survived filtering, with its real content resolved. */
interface Resolved {
  note: ListedNote
  space: KnowledgeSpaceKind
  relevance: number
  snippet: string
  snippetBytes: number
  contentHash: string
  restrictions: PortableRestrictions
  tags: string[]
}

export class ContextRouter {
  constructor(
    private readonly registry: SourceRegistry,
    private readonly config: ContextRouterConfig,
  ) {
    const r = ProviderDestinationPlanSchema.safeParse(config.providerPlan)
    if (!r.success) {
      throw KnowledgeFailure.sourceInconsistent(`invalid providerPlan: ${r.error.message}`)
    }
  }

  async route(request: RetrievalRequest): Promise<RouterOutput> {
    const parsed = RetrievalRequestSchema.safeParse(request)
    if (!parsed.success) {
      throw KnowledgeFailure.sourceInconsistent(
        `invalid retrieval request: ${parsed.error.issues[0]?.message ?? "unknown"}`,
      )
    }
    const req = parsed.data

    const budget = this.config.tokenBudget ?? DEFAULT_TOKEN_BUDGET
    const maxPerType = this.config.maxPerType ?? DEFAULT_MAX_PER_TYPE
    const startedAt = Date.now()
    const deadlineAt = startedAt + req.deadlineMs
    const terms = tokenize(req.query)

    const excluded: Array<{ locator: string; reason: string }> = []
    let truncated = false
    let scanned = 0
    let droppedByRestriction = 0

    const spaces = this.resolveSpaces(req)
    const sources = spaces
      .map((kind) => this.registry.byKind(kind))
      .filter((s): s is KnowledgeSource => s !== undefined)

    const resolved: Resolved[] = []
    // Spaces that actually produced a listing, not the ones asked for. A
    // space whose `list()` blew the deadline contributed nothing, and saying
    // it was queried turns "I searched nothing" into "I searched and found
    // nothing" — the difference between a bounded answer and a wrong one.
    const queried: KnowledgeSpaceKind[] = []

    outer: for (const source of sources) {
      let listed: ListedNote[]
      try {
        // Bound the call itself, not just the gap between two notes.
        listed = await withDeadline(
          source.list({}),
          remainingMs(deadlineAt),
          `list(${source.space.kind})`,
        )
      } catch (e) {
        if (e instanceof DeadlineExceeded) {
          // Directly inside the source loop, so a plain break leaves it.
          truncated = true
          excluded.push({ locator: `space:${source.space.kind}`, reason: e.message })
          break
        }
        excluded.push({
          locator: `space:${source.space.kind}`,
          reason: `source unavailable: ${(e as Error).message}`,
        })
        continue
      }
      queried.push(source.space.kind)

      for (const note of listed) {
        if (Date.now() >= deadlineAt) {
          truncated = true
          break outer
        }
        scanned += 1

        if (!this.config.includeInactive && NON_RETRIEVABLE_LIFECYCLES.has(note.lifecycle)) {
          excluded.push({ locator: note.ref.locator, reason: `lifecycle is ${note.lifecycle}` })
          continue
        }
        if (req.types.length > 0 && !req.types.includes(note.type)) {
          excluded.push({ locator: note.ref.locator, reason: `type ${note.type} not requested` })
          continue
        }

        let doc: Awaited<ReturnType<KnowledgeSource["read"]>>
        try {
          doc = await withDeadline(
            source.read(note.ref.locator, note.ref.id),
            remainingMs(deadlineAt),
            `read(${note.ref.locator})`,
          )
        } catch (e) {
          if (e instanceof DeadlineExceeded) {
            truncated = true
            excluded.push({ locator: note.ref.locator, reason: e.message })
            break outer
          }
          excluded.push({
            locator: note.ref.locator,
            reason: `unreadable: ${(e as Error).message}`,
          })
          continue
        }
        if (doc === null) {
          excluded.push({ locator: note.ref.locator, reason: "unreadable" })
          continue
        }

        const fm = doc.note.frontmatter
        const tags = fm.unifia_tags ?? []
        if (req.tags.length > 0 && !req.tags.every((t) => tags.includes(t))) {
          excluded.push({ locator: note.ref.locator, reason: "tag filter not satisfied" })
          continue
        }

        const relevance = scoreNote(terms, {
          locator: note.ref.locator,
          body: doc.note.body,
          tags,
        })
        if (relevance <= 0) {
          excluded.push({ locator: note.ref.locator, reason: "no lexical match" })
          continue
        }

        const snippet = bestSnippet(doc.note.body, terms, req.maxSnippetBytes)
        resolved.push({
          note,
          space: source.space.kind,
          relevance,
          snippet,
          snippetBytes: utf8Bytes(snippet),
          // Hash the note content, not the snippet: the audit trail must
          // identify what was read, independent of how it was windowed.
          contentHash: createHash("sha256").update(doc.note.body, "utf8").digest("hex"),
          restrictions: portableRestrictionsFromFrontmatter(fm.unifia_restrictions),
          tags: [...tags],
        })
      }
    }

    // Deterministic ranking: relevance desc, then newest, then locator.
    resolved.sort(
      (a, b) =>
        b.relevance - a.relevance ||
        b.note.updatedAt.localeCompare(a.note.updatedAt) ||
        a.note.ref.locator.localeCompare(b.note.ref.locator),
    )

    // Typed as cleared, not as ContextItem: the pack is the emission point.
    const items: ClearedItem[] = []
    const perType = new Map<ContextItem["type"], number>()
    // Defence in depth against a note reachable from two mounted spaces.
    // Composition already keeps the project vault out of the personal
    // subdirectory; this guarantees the pack holds each note once even if a
    // future mount overlaps.
    const seenIds = new Set<string>()
    let payloadBytes = 0
    let totalTokenCost = 0

    for (const r of resolved) {
      // maxCandidates is a global cap, not a per-source one.
      if (items.length >= req.maxCandidates) {
        truncated = true
        excluded.push({ locator: r.note.ref.locator, reason: "maxCandidates reached" })
        continue
      }

      if (seenIds.has(r.note.ref.id)) {
        excluded.push({ locator: r.note.ref.locator, reason: "duplicate of a higher-ranked copy" })
        continue
      }

      const verdict = clearForEgress({
        item: this.toContextItem(r),
        plan: this.config.providerPlan,
        ...(this.config.grants !== undefined ? { grants: this.config.grants } : {}),
      })
      // Allow and deny alike: the ADR traces both, and a trail that only
      // records refusals cannot show what actually left.
      this.config.audit?.record(
        egressAuditEntry(verdict.item, this.config.providerPlan, verdict.result),
      )
      if (!verdict.cleared) {
        excluded.push({ locator: r.note.ref.locator, reason: verdict.result.reason })
        droppedByRestriction += 1
        continue
      }
      // From here `item` carries the guard's brand: `items` accepts nothing
      // else, so a future edit cannot add an unchecked candidate.
      const item: ClearedItem = verdict.item

      const count = perType.get(item.type) ?? 0
      if (count >= maxPerType) {
        excluded.push({ locator: r.note.ref.locator, reason: "per-type cap reached" })
        continue
      }
      if (payloadBytes + r.snippetBytes > req.maxPayloadBytes) {
        truncated = true
        excluded.push({ locator: r.note.ref.locator, reason: "maxPayloadBytes reached" })
        continue
      }
      const cost = estimateTokens(item.snippet)
      if (totalTokenCost + cost > budget) {
        truncated = true
        excluded.push({ locator: r.note.ref.locator, reason: "token budget exhausted" })
        continue
      }

      items.push(item)
      seenIds.add(r.note.ref.id)
      payloadBytes += r.snippetBytes
      totalTokenCost += cost
      perType.set(item.type, count + 1)
    }

    const diagnostics: ContextDiagnostics = {
      sourcesQueried: queried,
      candidatesScanned: scanned,
      candidatesDroppedByRestriction: droppedByRestriction,
      totalTokenCost,
      durationMs: Date.now() - startedAt,
      excludedReasons: Object.fromEntries(excluded.map((e) => [e.locator, e.reason])),
    }

    return {
      pack: { providerPlan: this.config.providerPlan, tokenBudget: budget, items, diagnostics },
      excluded,
      truncated,
    }
  }

  private toContextItem(r: Resolved): ContextItem {
    return {
      ref: { id: r.note.ref.id, locator: r.note.ref.locator },
      source: r.space,
      type: r.note.type,
      // Provenance is verified when the note comes from a space the user
      // owns; an external mount is not self-certifying.
      trust: r.space === "external" ? "unverified" : "verified",
      authority:
        r.space === "personal" ? "user" : r.space === "project" ? "project" : r.space === "session" ? "agent" : "external",
      // Match the note against the restriction for where this pack is going.
      // A plan that does not declare itself local is treated as remote.
      restriction:
        this.config.providerPlan.destinationKind === "local"
          ? r.restrictions.localModel
          : r.restrictions.remoteModel,
      relevance: r.relevance,
      tokenCost: estimateTokens(r.snippet),
      contentHash: r.contentHash,
      snippet: r.snippet,
      reason: `lexical match in ${r.space} (score ${r.relevance.toFixed(2)})`,
      temporalState: r.note.lifecycle,
    }
  }

  private resolveSpaces(request: RetrievalRequest): KnowledgeSpaceKind[] {
    if (request.spaces.length > 0) return [...request.spaces]
    return ["personal", "project", "session", "external"]
  }
}
