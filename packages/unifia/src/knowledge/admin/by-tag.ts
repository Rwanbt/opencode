/* SPDX-License-Identifier: MIT */
/**
 * By-tag listing (P11.42).
 *
 * Lists all notes whose `unifia_tags` array contains a given tag
 * (case-insensitive). Mirrors `by-type`, `by-lifecycle`, and
 * `by-project` but filters on a single tag. The single-tag
 * version is the most common operation; for multi-tag AND
 * queries, use `tagSearch`.
 *
 * Pure / read-only.
 */

import { listMarkdownLocators } from "../classb/reachability.js"
import { parseDocument } from "../parser/parser.js"
import { readFileSync } from "node:fs"
import { join, isAbsolute } from "node:path"
import type { KnowledgeId, KnowledgeLocator, KnowledgeLifecycleState } from "@unifia/contracts/knowledge"

export interface ByTagHit {
  id: KnowledgeId
  locator: KnowledgeLocator
  type: string
  lifecycle: KnowledgeLifecycleState
  tags: string[]
}

export interface ByTagInput {
  vaultRoot: string
  tag: string
  limit?: number
}

export interface ByTagReport {
  vaultRoot: string
  tag: string
  scanned: number
  hits: ByTagHit[]
  totalMs: number
}

export function listByTag(input: ByTagInput): ByTagReport {
  if (!isAbsolute(input.vaultRoot)) {
    throw new Error(`vaultRoot must be absolute, got ${input.vaultRoot}`)
  }
  if (!input.tag || input.tag.length === 0) {
    throw new Error(`tag must be a non-empty string`)
  }
  const t0 = Date.now()
  const limit = input.limit ?? 50
  const locators = listMarkdownLocators(input.vaultRoot)
  const wanted = input.tag.toLowerCase()
  const hits: ByTagHit[] = []
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
    const have = fm.unifia_tags.map((t) => t.toLowerCase())
    if (!have.includes(wanted)) continue
    hits.push({
      id: fm.unifia_id as KnowledgeId,
      locator: locator as KnowledgeLocator,
      type: fm.unifia_type,
      lifecycle: fm.unifia_lifecycle as KnowledgeLifecycleState,
      tags: fm.unifia_tags,
    })
    if (hits.length >= limit) break
  }

  hits.sort((a, b) => a.locator.localeCompare(b.locator))

  return {
    vaultRoot: input.vaultRoot,
    tag: input.tag,
    scanned,
    hits,
    totalMs: Date.now() - t0,
  }
}
