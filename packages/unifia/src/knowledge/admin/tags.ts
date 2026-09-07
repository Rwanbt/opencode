/* SPDX-License-Identifier: MIT */
/**
 * All-tags listing (P11.32).
 *
 * Walks the vault and reports the unique tags used across all
 * notes, with their counts. Sorted by count descending.
 *
 * Pure / read-only.
 */

import { listMarkdownLocators } from "../classb/reachability.js"
import { parseDocument } from "../parser/parser.js"
import { readFileSync } from "node:fs"
import { join, isAbsolute } from "node:path"

export interface TagCount {
  tag: string
  count: number
}

export interface AllTagsInput {
  vaultRoot: string
}

export interface AllTagsReport {
  vaultRoot: string
  scanned: number
  tags: TagCount[]
  totalMs: number
}

export function allTags(input: AllTagsInput): AllTagsReport {
  if (!isAbsolute(input.vaultRoot)) {
    throw new Error(`vaultRoot must be absolute, got ${input.vaultRoot}`)
  }
  const t0 = Date.now()
  const locators = listMarkdownLocators(input.vaultRoot)
  const counts = new Map<string, number>()
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
    for (const tag of doc.note.frontmatter.unifia_tags) {
      const t = tag.toLowerCase()
      counts.set(t, (counts.get(t) ?? 0) + 1)
    }
  }

  const tags: TagCount[] = Array.from(counts.entries()).map(([tag, count]) => ({ tag, count }))
  tags.sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag))

  return {
    vaultRoot: input.vaultRoot,
    scanned,
    tags,
    totalMs: Date.now() - t0,
  }
}
