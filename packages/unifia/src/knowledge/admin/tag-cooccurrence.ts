/* SPDX-License-Identifier: MIT */
/**
 * Tag co-occurrence (P11.48).
 *
 * Walks the canonical vault and builds a co-occurrence matrix:
 * for every pair of tags that appear together in at least one
 * note's `unifia_tags` array, reports the number of notes
 * that contain both. Pairs with low co-occurrence (< minCount)
 * are filtered out.
 *
 * The matrix is symmetric: `(A, B)` and `(B, A)` are merged
 * into a single entry. The output is sorted by co-occurrence
 * count descending, then by tag pair alphabetical.
 *
 * Use cases:
 *  - identify tag clusters (often-used-together tags);
 *  - find candidates for tag consolidation;
 *  - visualise the tag taxonomy.
 *
 * Pure / read-only.
 */

import { listMarkdownLocators } from "../classb/reachability.js"
import { parseDocument } from "../parser/parser.js"
import { readFileSync } from "node:fs"
import { join, isAbsolute } from "node:path"

export interface TagPair {
  /** Tags are sorted alphabetically inside the pair. */
  a: string
  b: string
  /** Number of notes that contain both tags. */
  count: number
}

export interface TagCooccurrenceInput {
  vaultRoot: string
  /** Minimum co-occurrence count to keep. Default 2. */
  minCount?: number
  /** Optional cap on the number of pairs returned. Default 100. */
  limit?: number
}

export interface TagCooccurrenceReport {
  vaultRoot: string
  scanned: number
  uniqueTags: number
  pairs: TagPair[]
  totalMs: number
}

function pairKey(a: string, b: string): string {
  return a < b ? `${a}\u0000${b}` : `${b}\u0000${a}`
}

function pairFromKey(k: string): { a: string; b: string } {
  const [a, b] = k.split("\u0000")
  return { a: a ?? "", b: b ?? "" }
}

export function tagCooccurrence(input: TagCooccurrenceInput): TagCooccurrenceReport {
  if (!isAbsolute(input.vaultRoot)) {
    throw new Error(`vaultRoot must be absolute, got ${input.vaultRoot}`)
  }
  const minCount = input.minCount ?? 2
  if (minCount < 1) {
    throw new Error(`minCount must be >= 1, got ${minCount}`)
  }
  const t0 = Date.now()
  const limit = input.limit ?? 100
  const locators = listMarkdownLocators(input.vaultRoot)
  const allTags = new Set<string>()
  const pairCounts = new Map<string, number>()
  let scanned = 0
  for (const loc of locators) {
    let text: string
    try {
      text = readFileSync(join(input.vaultRoot, loc), "utf8")
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
    const tags = doc.note.frontmatter.unifia_tags
    for (const t of tags) allTags.add(t)
    // Generate all unique pairs of tags for this note.
    const lower = tags.map((t) => t.toLowerCase())
    const uniq = Array.from(new Set(lower)).sort()
    for (let i = 0; i < uniq.length; i++) {
      for (let j = i + 1; j < uniq.length; j++) {
        const k = pairKey(uniq[i] as string, uniq[j] as string)
        pairCounts.set(k, (pairCounts.get(k) ?? 0) + 1)
      }
    }
  }
  const pairs: TagPair[] = []
  for (const [k, count] of pairCounts) {
    if (count < minCount) continue
    const { a, b } = pairFromKey(k)
    pairs.push({ a, b, count })
  }
  pairs.sort((a, b) => b.count - a.count || a.a.localeCompare(b.a) || a.b.localeCompare(b.b))
  if (pairs.length > limit) pairs.length = limit
  return {
    vaultRoot: input.vaultRoot,
    scanned,
    uniqueTags: allTags.size,
    pairs,
    totalMs: Date.now() - t0,
  }
}
