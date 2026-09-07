/* SPDX-License-Identifier: MIT */
/**
 * Knowledge service facade (P7.1).
 *
 * Single façade shared by Code, Work, and Design modes. No mode has its own
 * DB or cache.
 *
 * Every method here either does the work or refuses with a typed
 * `capability_unavailable`. It never returns an empty success: `get`
 * returning null and `backlinks` returning [] used to mean "not implemented",
 * which is indistinguishable from "nothing found" at the call site.
 */

import type {
  McpKnowledgeStatusResponse,
  RetrievalResponse,
  MutationResult,
  KnowledgeId,
  KnowledgeLocator,
  KnowledgeSpaceKind,
  KnowledgeVersionHash,
  RetrievalCandidate,
  ContextItem,
} from "@unifia/contracts/knowledge"
import { portableRestrictionsFromFrontmatter } from "@unifia/contracts/knowledge"
import { clearForEgress, type EgressResult } from "../policy/egress.js"
import { egressAuditEntry, type EgressAudit } from "../policy/audit.js"
import type { KnowledgeSource, SourceRegistry } from "../source/source.js"
import { ContextRouter, type ContextRouterConfig, type RouterOutput } from "../context/router.js"
import { doctor, type DoctorInput, type DoctorReport } from "../admin/doctor.js"
import { extractWikilinks } from "../parser/wikilinks.js"
import { KnowledgeFailure } from "../domain/errors.js"
import { utf8Bytes } from "../context/lexical.js"
import { createHash } from "node:crypto"

export interface SearchRequest {
  query: string
  spaces: string[]
  types: string[]
  tags: string[]
  maxCandidates: number
  maxPayloadBytes: number
  maxSnippetBytes: number
  deadlineMs: number
}

/**
 * Writes Class A. Injected rather than assumed: V1 refuses to propose a
 * mutation when no writer is configured instead of reporting
 * `applied: false` as though it had tried.
 */
export interface MutationWriter {
  apply(input: { intent: unknown; reason: string; source: string }): Promise<MutationResult>
}

export interface KnowledgeService {
  search(req: SearchRequest): Promise<RouterOutput>
  get(id?: KnowledgeId, locator?: KnowledgeLocator): Promise<RetrievalResponse | null>
  /**
   * The hash a compare-and-swap update must present, or null.
   *
   * `get` cannot answer this: a `RetrievalCandidate` carries `snippetHash`,
   * the hash of the body it serves, while the writer compares against the
   * hash of the whole file — frontmatter included. Deriving one from the
   * other is impossible, and reading the file behind the service's back to
   * obtain it would step around the egress guard. So the service answers it,
   * under the same clearance as any other disclosure.
   */
  versionHash(id?: KnowledgeId, locator?: KnowledgeLocator): Promise<KnowledgeVersionHash | null>
  backlinks(target: { id?: KnowledgeId; locator?: KnowledgeLocator }): Promise<KnowledgeId[]>
  /** Ids this note declares it supersedes, from its own frontmatter. */
  lineage(id: KnowledgeId): Promise<KnowledgeId[]>
  propose(input: { intent: unknown; reason: string; source: string }): Promise<MutationResult>
  doctor(input: DoctorInput): Promise<DoctorReport>
  status(): Promise<McpKnowledgeStatusResponse>
}

export interface DefaultKnowledgeServiceOptions {
  /** Present only when Class A writes are configured. */
  writer?: MutationWriter
  /** True when a real FTS runtime backs retrieval. V1: false. */
  ftsEnabled?: boolean
  /** True when an embedding model is loaded. V1: false. */
  vectorEnabled?: boolean
  /** Records every egress decision taken by get/backlinks/lineage. */
  audit?: EgressAudit
}

export class DefaultKnowledgeService implements KnowledgeService {
  private readonly options: DefaultKnowledgeServiceOptions

  constructor(
    private readonly registry: SourceRegistry,
    private readonly routerConfig: ContextRouterConfig,
    options: DefaultKnowledgeServiceOptions = {},
  ) {
    this.options = options
  }

  async search(req: SearchRequest): Promise<RouterOutput> {
    const router = new ContextRouter(this.registry, this.routerConfig)
    return router.route({
      query: req.query,
      spaces: req.spaces as never,
      types: req.types as never,
      tags: req.tags,
      maxCandidates: req.maxCandidates,
      maxPayloadBytes: req.maxPayloadBytes,
      maxSnippetBytes: req.maxSnippetBytes,
      deadlineMs: req.deadlineMs,
    })
  }

  /**
   * Resolve one note into a candidate and decide whether it may be served.
   *
   * Single hydration path for every capability. `get` used to build its
   * candidate inline with `restriction: "allow"` hardcoded and never call
   * `decideEgress`, so a note carrying `remote_model: deny` was served in
   * full toward a remote destination — and `backlinks`, which hydrates
   * through `get`, leaked it too. Search denied it correctly; the other
   * capabilities were a way around the guard.
   */
  private hydrate(
    source: KnowledgeSource,
    doc: NonNullable<Awaited<ReturnType<KnowledgeSource["read"]>>>,
    locator?: KnowledgeLocator,
  ): {
    candidate: RetrievalCandidate
    item: ContextItem
    decision: EgressResult
    /** False means the guard refused; callers must not serve the candidate. */
    cleared: boolean
  } {
    const fm = doc.note.frontmatter
    const body = doc.note.body
    const space = source.space.kind
    const restrictions = portableRestrictionsFromFrontmatter(fm.unifia_restrictions)
    const plan = this.routerConfig.providerPlan

    const candidate: RetrievalCandidate = {
      id: fm.unifia_id as KnowledgeId,
      locator: (locator ?? fm.unifia_id) as KnowledgeLocator,
      type: fm.unifia_type,
      space,
      trust: space === "external" ? "unverified" : "verified",
      authority:
        space === "personal"
          ? "user"
          : space === "project"
            ? "project"
            : space === "session"
              ? "agent"
              : "external",
      // The effective restriction for this destination, never a constant.
      restriction:
        plan.destinationKind === "local" ? restrictions.localModel : restrictions.remoteModel,
      relevance: 1,
      snippet: body,
      snippetBytes: utf8Bytes(body),
      snippetHash: createHash("sha256").update(body, "utf8").digest("hex"),
    }

    const item: ContextItem = {
      ref: { id: candidate.id, locator: candidate.locator },
      source: space,
      type: candidate.type,
      trust: candidate.trust,
      authority: candidate.authority,
      restriction: candidate.restriction,
      relevance: 1,
      tokenCost: 0,
      contentHash: candidate.snippetHash,
      snippet: candidate.snippet,
      reason: "id-addressed read",
      temporalState: fm.unifia_lifecycle,
    }

    // Same brand as the router: `get`, `backlinks` and `lineage` obtain a
    // cleared item or nothing. The defect this closes was `get()` building
    // its candidate inline with `restriction: "allow"` and never asking.
    const grants = this.routerConfig.grants
    const verdict = clearForEgress({ item, plan, ...(grants !== undefined ? { grants } : {}) })
    // Their decisions belong in the same trail as the router's.
    this.options.audit?.record(egressAuditEntry(item, plan, verdict.result))
    return { candidate, item, decision: verdict.result, cleared: verdict.cleared }
  }

  async get(id?: KnowledgeId, locator?: KnowledgeLocator): Promise<RetrievalResponse | null> {
    if (id === undefined && locator === undefined) {
      throw KnowledgeFailure.sourceInconsistent("get requires an id or a locator")
    }
    const startedAt = Date.now()

    for (const source of this.registry.all()) {
      let doc: Awaited<ReturnType<KnowledgeSource["read"]>>
      try {
        doc = await source.read(locator, id)
      } catch {
        continue
      }
      if (doc === null) continue

      const { candidate, cleared } = this.hydrate(source, doc, locator)
      if (!cleared) {
        // Answer exactly as for a note that does not exist: confirming that a
        // denied note exists is itself a disclosure.
        return null
      }

      return {
        candidates: [candidate],
        payloadBytes: candidate.snippetBytes,
        truncated: false,
        diagnostics: {
          sourcesQueried: [source.space.kind],
          candidatesScanned: 1,
          candidatesDroppedByRestriction: 0,
          durationMs: Date.now() - startedAt,
          indexVersion: "v1",
        },
      }
    }
    return null
  }

  async versionHash(
    id?: KnowledgeId,
    locator?: KnowledgeLocator,
  ): Promise<KnowledgeVersionHash | null> {
    if (id === undefined && locator === undefined) {
      throw KnowledgeFailure.sourceInconsistent("versionHash requires an id or a locator")
    }
    for (const source of this.registry.all()) {
      let doc: Awaited<ReturnType<KnowledgeSource["read"]>>
      try {
        doc = await source.read(locator, id)
      } catch {
        continue
      }
      if (doc === null) continue
      // A note the guard withholds does not hand out its version hash: the
      // hash is a fact about content the caller may not read, and it is the
      // key that would let them overwrite it.
      if (!this.hydrate(source, doc, locator).cleared) return null
      return createHash("sha256")
        .update(doc.note.raw, "utf8")
        .digest("hex") as KnowledgeVersionHash
    }
    return null
  }

  async backlinks(target: {
    id?: KnowledgeId
    locator?: KnowledgeLocator
  }): Promise<KnowledgeId[]> {
    if (target.id === undefined && target.locator === undefined) {
      throw KnowledgeFailure.sourceInconsistent("backlinks requires an id or a locator")
    }
    // Class A is the source of truth: resolve links by reading it, since V1
    // ships no persisted graph index.
    const wanted = new Set<string>()
    if (target.locator !== undefined) {
      wanted.add(target.locator)
      wanted.add(target.locator.replace(/\.md$/, ""))
    }
    if (target.id !== undefined) wanted.add(target.id)

    const out: KnowledgeId[] = []
    for (const source of this.registry.all()) {
      let listed: Awaited<ReturnType<KnowledgeSource["list"]>>
      try {
        listed = await source.list({})
      } catch {
        continue
      }
      for (const note of listed) {
        let doc: Awaited<ReturnType<KnowledgeSource["read"]>>
        try {
          doc = await source.read(note.ref.locator, note.ref.id)
        } catch {
          continue
        }
        if (doc === null) continue
        // A note the policy refuses is not a backlink we may disclose: its id
        // alone tells the caller the note exists, and MCP hydrates each id
        // back into a snippet.
        if (!this.hydrate(source, doc, note.ref.locator).cleared) continue
        const links = extractWikilinks(doc.note.body).map((w) => w.target)
        const supersedes = doc.note.frontmatter.unifia_supersedes ?? []
        if (links.some((l) => wanted.has(l)) || supersedes.some((s) => wanted.has(s))) {
          out.push(note.ref.id)
        }
      }
    }
    return out
  }

  /**
   * The `unifia_supersedes` list a note carries.
   *
   * `trace` used `backlinks()` as a stand-in for this, which conflated
   * ordinary wikilinks with supersession and reported every edge as
   * `relation: "supersedes"` regardless of direction. Lineage is a
   * frontmatter fact and is read as one.
   */
  async lineage(id: KnowledgeId): Promise<KnowledgeId[]> {
    for (const source of this.registry.all()) {
      let doc: Awaited<ReturnType<KnowledgeSource["read"]>>
      try {
        doc = await source.read(undefined, id)
      } catch {
        continue
      }
      if (doc === null) continue
      // A note the policy withholds does not disclose its lineage either.
      if (!this.hydrate(source, doc).cleared) return []
      return (doc.note.frontmatter.unifia_supersedes ?? []) as KnowledgeId[]
    }
    return []
  }

  async propose(input: {
    intent: unknown
    reason: string
    source: string
  }): Promise<MutationResult> {
    const writer = this.options.writer
    if (writer === undefined) {
      // Refuse loudly. Returning `applied: false` here read as "the mutation
      // was attempted and declined", which was never true.
      throw KnowledgeFailure.mutationRefused(
        "knowledge_propose is unavailable: no Class A writer is configured",
      )
    }
    return writer.apply(input)
  }

  async doctor(input: DoctorInput): Promise<DoctorReport> {
    return doctor(input)
  }

  async status(): Promise<McpKnowledgeStatusResponse> {
    // Report what is actually mounted and actually enabled, not a constant.
    const spaces: KnowledgeSpaceKind[] = []
    let candidatesCount = 0
    for (const source of this.registry.all()) {
      spaces.push(source.space.kind)
      try {
        candidatesCount += (await source.list({})).length
      } catch {
        // A source that cannot be listed contributes nothing rather than
        // inflating the count.
      }
    }

    return {
      indexVersion: "v1",
      rebuiltAt: new Date().toISOString(),
      candidatesCount,
      spaces,
      capabilities: [
        { name: "knowledge_search", readOnly: true },
        { name: "knowledge_get", readOnly: true },
        { name: "knowledge_backlinks", readOnly: true },
        { name: "knowledge_trace", readOnly: true },
        { name: "knowledge_status", readOnly: true },
        { name: "knowledge_propose", readOnly: this.options.writer === undefined },
      ],
      enabled: {
        // V1 has no FTS5 runtime and no embedding model; the graph is
        // answered by scanning Class A, which is genuinely available.
        fts: this.options.ftsEnabled === true,
        vector: this.options.vectorEnabled === true,
        graph: true,
      },
    }
  }
}
