/* SPDX-License-Identifier: MIT */
/**
 * By-type listing (P11.27).
 *
 * Lists all notes of a given `unifia_type`. The result is sorted
 * by locator, paginated, and includes the note's id, locator,
 * type, lifecycle, and updatedAt timestamp.
 *
 * Pure / read-only.
 */

import { listMarkdownLocators } from "../classb/reachability.js"
import { parseDocument } from "../parser/parser.js"
import { readFileSync } from "node:fs"
import { join, isAbsolute } from "node:path"
import type { KnowledgeId, KnowledgeLocator } from "@unifia/contracts/knowledge"

export interface ByTypeHit {
  id: KnowledgeId
  locator: KnowledgeLocator
  type: string
  lifecycle: string
  updatedAt: string
}

export interface ByTypeInput {
  vaultRoot: string
  type: string
  limit?: number
  /** If true, include only active notes (default false = all). */
  onlyActive?: boolean
}

export interface ByTypeReport {
  vaultRoot: string
  type: string
  scanned: number
  hits: ByTypeHit[]
  totalMs: number
}

export function listByType(input: ByTypeInput): ByTypeReport {
  if (!isAbsolute(input.vaultRoot)) {
    throw new Error(`vaultRoot must be absolute, got ${input.vaultRoot}`)
  }
  const t0 = Date.now()
  const limit = input.limit ?? 50
  const locators = listMarkdownLocators(input.vaultRoot)
  const hits: ByTypeHit[] = []
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
    if (fm.unifia_type !== input.type) continue
    if (input.onlyActive && fm.unifia_lifecycle !== "active") continue
    hits.push({
      id: fm.unifia_id as KnowledgeId,
      locator: locator as KnowledgeLocator,
      type: fm.unifia_type,
      lifecycle: fm.unifia_lifecycle,
      updatedAt: fm.unifia_updated_at,
    })
    if (hits.length >= limit) break
  }

  // Sort by locator.
  hits.sort((a, b) => a.locator.localeCompare(b.locator))

  return {
    vaultRoot: input.vaultRoot,
    type: input.type,
    scanned,
    hits,
    totalMs: Date.now() - t0,
  }
}
