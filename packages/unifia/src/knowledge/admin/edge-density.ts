/* SPDX-License-Identifier: MIT */
/**
 * Edge density (P11.55).
 *
 * Walks the vault and counts the number of wikilink edges per
 * note (in + out). Returns a histogram of total degree per note:
 *
 *   0   1   2-5   6-10   11-20   20+
 *
 * plus a per-bucket count and the totals. Useful as a quick
 * "how connected is the graph?" overview.
 *
 * Pure / read-only.
 */

import { listMarkdownLocators } from "../classb/reachability.js"
import { parseDocument } from "../parser/parser.js"
import { readFileSync } from "node:fs"
import { join, isAbsolute } from "node:path"
import type { KnowledgeLocator } from "@unifia/contracts/knowledge"

const BUCKETS: ReadonlyArray<{ label: string; test: (n: number) => boolean }> = [
  { label: "0", test: (n) => n === 0 },
  { label: "1", test: (n) => n === 1 },
  { label: "2-5", test: (n) => n >= 2 && n <= 5 },
  { label: "6-10", test: (n) => n >= 6 && n <= 10 },
  { label: "11-20", test: (n) => n >= 11 && n <= 20 },
  { label: "20+", test: (n) => n > 20 },
]

export interface EdgeDensityReport {
  vaultRoot: string
  scanned: number
  /** Per-bucket count. */
  buckets: Record<string, number>
  /** Average degree (in + out) per note. */
  meanDegree: number
  /** Max degree. */
  maxDegree: number
  /** Number of isolated notes (degree 0). */
  isolatedCount: number
  totalMs: number
}

export interface EdgeDensityInput {
  vaultRoot: string
}

function normaliseTarget(t: string): string {
  const lower = t.toLowerCase().trim()
  const noExt = lower.endsWith(".md") ? lower.slice(0, -3) : lower
  const parts = noExt.split("/")
  return parts[parts.length - 1] ?? noExt
}

interface ParsedNote {
  locator: KnowledgeLocator
  out: KnowledgeLocator[]
  inCount: number
}

function loadAndParse(
  vaultRoot: string,
  locator: KnowledgeLocator,
): ParsedNote | null {
  const absPath = join(vaultRoot, locator)
  let text: string
  try {
    text = readFileSync(absPath, "utf8")
  } catch {
    return null
  }
  try {
    parseDocument(text)
  } catch {
    return null
  }
  return { locator, out: [], inCount: 0 }
}

export function edgeDensity(input: EdgeDensityInput): EdgeDensityReport {
  if (!isAbsolute(input.vaultRoot)) {
    throw new Error(`vaultRoot must be absolute, got ${input.vaultRoot}`)
  }
  const t0 = Date.now()
  const locators = listMarkdownLocators(input.vaultRoot)
  // 1st pass: parse all and collect outbound targets (as bare slugs).
  const notes = new Map<KnowledgeLocator, ParsedNote>()
  for (const locator of locators) {
    const note = loadAndParse(input.vaultRoot, locator)
    if (!note) continue
    // Re-parse to extract wikilinks
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
    for (const wl of doc.wikilinks ?? []) {
      note.out.push(wl.target as KnowledgeLocator)
    }
    notes.set(locator, note)
  }

  // Build a slug->locator map for inbound resolution.
  const slugToLocator = new Map<string, KnowledgeLocator>()
  for (const locator of notes.keys()) {
    slugToLocator.set(normaliseTarget(locator), locator)
  }

  // 2nd pass: count inbound edges.
  for (const note of notes.values()) {
    for (const target of note.out) {
      const resolved = slugToLocator.get(normaliseTarget(target))
      if (!resolved) continue
      if (resolved === note.locator) continue // self-link ignored
      const targetNote = notes.get(resolved)
      if (targetNote) targetNote.inCount += 1
    }
  }

  // 3rd pass: build the histogram.
  const buckets: Record<string, number> = {}
  for (const b of BUCKETS) buckets[b.label] = 0
  let scanned = 0
  let totalDegree = 0
  let maxDegree = 0
  let isolatedCount = 0

  for (const note of notes.values()) {
    scanned += 1
    const degree = note.out.length + note.inCount
    totalDegree += degree
    if (degree > maxDegree) maxDegree = degree
    if (degree === 0) isolatedCount += 1
    for (const b of BUCKETS) {
      if (b.test(degree)) {
        buckets[b.label] = (buckets[b.label] ?? 0) + 1
        break
      }
    }
  }

  return {
    vaultRoot: input.vaultRoot,
    scanned,
    buckets,
    meanDegree: scanned === 0 ? 0 : Math.round((totalDegree / scanned) * 100) / 100,
    maxDegree,
    isolatedCount,
    totalMs: Date.now() - t0,
  }
}
