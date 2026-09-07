/* SPDX-License-Identifier: MIT */
/**
 * Full notes list (P11.30).
 *
 * Lists every note in the vault with its id, locator, type,
 * lifecycle, and updatedAt timestamp. The result is paginated
 * and sorted by locator.
 *
 * Pure / read-only.
 */

import { listMarkdownLocators } from "../classb/reachability.js"
import { parseDocument } from "../parser/parser.js"
import { readFileSync } from "node:fs"
import { join, isAbsolute } from "node:path"
import type { KnowledgeId, KnowledgeLocator } from "@unifia/contracts/knowledge"

export interface ListHit {
  id: KnowledgeId
  locator: KnowledgeLocator
  type: string
  lifecycle: string
  updatedAt: string
}

export interface ListNotesInput {
  vaultRoot: string
  limit?: number
  offset?: number
}

export interface ListNotesReport {
  vaultRoot: string
  scanned: number
  hits: ListHit[]
  totalMs: number
}

export function listNotes(input: ListNotesInput): ListNotesReport {
  if (!isAbsolute(input.vaultRoot)) {
    throw new Error(`vaultRoot must be absolute, got ${input.vaultRoot}`)
  }
  const t0 = Date.now()
  const limit = input.limit ?? 100
  const offset = input.offset ?? 0
  const locators = listMarkdownLocators(input.vaultRoot).sort()
  const hits: ListHit[] = []
  let scanned = 0
  let i = 0

  for (const locator of locators) {
    if (i < offset) {
      i += 1
      continue
    }
    let text: string
    try {
      text = readFileSync(join(input.vaultRoot, locator), "utf8")
    } catch {
      i += 1
      continue
    }
    let doc: ReturnType<typeof parseDocument>
    try {
      doc = parseDocument(text)
    } catch {
      i += 1
      continue
    }
    scanned += 1
    const fm = doc.note.frontmatter
    hits.push({
      id: fm.unifia_id as KnowledgeId,
      locator: locator as KnowledgeLocator,
      type: fm.unifia_type,
      lifecycle: fm.unifia_lifecycle,
      updatedAt: fm.unifia_updated_at,
    })
    i += 1
    if (hits.length >= limit) break
  }

  return {
    vaultRoot: input.vaultRoot,
    scanned,
    hits,
    totalMs: Date.now() - t0,
  }
}
