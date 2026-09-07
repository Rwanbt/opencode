/* SPDX-License-Identifier: MIT */
/**
 * Tag-based search (P11.24).
 *
 * Searches the canonical vault for notes whose `unifia_tags` array
 * contains every requested tag (AND semantics). Returns one hit
 * per matching note with the note's id, locator, type, and
 * lifecycle.
 *
 * Pure / read-only. No mutation, no network.
 */

import { listMarkdownLocators } from "../classb/reachability.js"
import { parseDocument } from "../parser/parser.js"
import { readFileSync } from "node:fs"
import { join, isAbsolute } from "node:path"
import type { KnowledgeId, KnowledgeLocator } from "@unifia/contracts/knowledge"

export interface TagSearchHit {
  id: KnowledgeId
  locator: KnowledgeLocator
  type: string
  lifecycle: string
  tags: string[]
}

export interface TagSearchInput {
  vaultRoot: string
  /** Tags the note must contain (AND). Empty array returns all notes. */
  tags: readonly string[]
  /** Optional cap on the number of hits. Default 50. */
  limit?: number
}

export interface TagSearchReport {
  vaultRoot: string
  query: readonly string[]
  scanned: number
  hits: TagSearchHit[]
  totalMs: number
}

export function tagSearch(input: TagSearchInput): TagSearchReport {
  if (!isAbsolute(input.vaultRoot)) {
    throw new Error(`vaultRoot must be absolute, got ${input.vaultRoot}`)
  }
  const t0 = Date.now()
  const limit = input.limit ?? 50
  const locators = listMarkdownLocators(input.vaultRoot)
  const wanted = new Set(input.tags.map((t) => t.toLowerCase()))
  const hits: TagSearchHit[] = []
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
    const fm = doc.note.frontmatter
    const have = new Set(fm.unifia_tags.map((t) => t.toLowerCase()))
    let ok = true
    for (const w of wanted) {
      if (!have.has(w)) {
        ok = false
        break
      }
    }
    if (ok) {
      hits.push({
        id: fm.unifia_id as KnowledgeId,
        locator: locator as KnowledgeLocator,
        type: fm.unifia_type,
        lifecycle: fm.unifia_lifecycle,
        tags: fm.unifia_tags,
      })
      if (hits.length >= limit) break
    }
  }

  return {
    vaultRoot: input.vaultRoot,
    query: input.tags,
    scanned,
    hits,
    totalMs: Date.now() - t0,
  }
}
