/* SPDX-License-Identifier: MIT */
/**
 * Orphans scan (P11.37).
 *
 * Lists notes with **zero outbound wikilinks** (and optionally
 * notes with very few outbound links, controlled by the
 * `maxLinks` threshold). Such notes are "orphans" in the sense
 * that they do not link out to any other note — they are
 * disconnected leaves of the knowledge graph.
 *
 * Notes with very few outbound links (below `maxLinks`) may also
 * be candidates for cleanup or re-wiring. Defaults to `maxLinks=0`
 * which returns only fully-disconnected notes.
 *
 * Pure / read-only.
 */

import { listMarkdownLocators } from "../classb/reachability.js"
import { parseDocument } from "../parser/parser.js"
import { readFileSync } from "node:fs"
import { join, isAbsolute } from "node:path"
import type { KnowledgeId, KnowledgeLocator, KnowledgeLifecycleState } from "@unifia/contracts/knowledge"

export interface OrphanHit {
  id: KnowledgeId
  locator: KnowledgeLocator
  type: string
  lifecycle: KnowledgeLifecycleState
  outboundCount: number
}

export interface OrphansInput {
  vaultRoot: string
  /** Maximum outbound links before a note is NOT an orphan. Default 0. */
  maxLinks?: number
  /** Optional cap on the number of hits. Default 50. */
  limit?: number
}

export interface OrphansReport {
  vaultRoot: string
  maxLinks: number
  scanned: number
  hits: OrphanHit[]
  totalMs: number
}

export function findOrphans(input: OrphansInput): OrphansReport {
  if (!isAbsolute(input.vaultRoot)) {
    throw new Error(`vaultRoot must be absolute, got ${input.vaultRoot}`)
  }
  const t0 = Date.now()
  const maxLinks = input.maxLinks ?? 0
  const limit = input.limit ?? 50
  const locators = listMarkdownLocators(input.vaultRoot)
  const hits: OrphanHit[] = []
  let scanned = 0

  for (const locator of locators) {
    let text: string
    try {
      text = readFileSync(join(input.vaultRoot, locator), "utf8")
    } catch {
      continue
    }
    let doc: ReturnType<typeof parseDocument>
    try {
      doc = parseDocument(text)
    } catch {
      continue
    }
    scanned += 1
    // Use the parser's precomputed `wikilinks` field to avoid re-running
    // the regex. The `doc.body` field is on `doc.note`, not on `doc`.
    const links = doc.wikilinks
    if (links.length > maxLinks) continue
    const fm = doc.note.frontmatter
    hits.push({
      id: fm.unifia_id as KnowledgeId,
      locator: locator as KnowledgeLocator,
      type: fm.unifia_type,
      lifecycle: fm.unifia_lifecycle as KnowledgeLifecycleState,
      outboundCount: links.length,
    })
    if (hits.length >= limit) break
  }

  hits.sort((a, b) => a.outboundCount - b.outboundCount || a.locator.localeCompare(b.locator))

  return {
    vaultRoot: input.vaultRoot,
    maxLinks,
    scanned,
    hits,
    totalMs: Date.now() - t0,
  }
}
