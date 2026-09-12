/* SPDX-License-Identifier: MIT */
/**
 * Recent notes (P11.44).
 *
 * Lists notes updated within the last N days (default 7).
 * This is the natural complement of `stale.ts`: one finds
 * candidates for archival, the other finds candidates for
 * review. Both together cover the freshness spectrum.
 *
 * Pure / read-only.
 */

import { listMarkdownLocators } from "../classb/reachability.js"
import { parseDocument } from "../parser/parser.js"
import { readFileSync } from "node:fs"
import { join, isAbsolute } from "node:path"
import type { KnowledgeId, KnowledgeLocator, KnowledgeLifecycleState } from "@unifia/contracts/knowledge"

export interface RecentHit {
  id: KnowledgeId
  locator: KnowledgeLocator
  type: string
  lifecycle: KnowledgeLifecycleState
  updatedAt: string
  ageDays: number
}

export interface RecentInput {
  vaultRoot: string
  /** Window in days. Notes updated within `windowDays` days are returned. Default 7. */
  windowDays?: number
  /** If true, only consider active notes (default false = all). */
  onlyActive?: boolean
  /** Optional cap on the number of hits. Default 50. */
  limit?: number
}

export interface RecentReport {
  vaultRoot: string
  windowDays: number
  referenceDate: string
  scanned: number
  hits: RecentHit[]
  totalMs: number
}

const MS_PER_DAY = 24 * 60 * 60 * 1000

export function findRecent(input: RecentInput): RecentReport {
  if (!isAbsolute(input.vaultRoot)) {
    throw new Error(`vaultRoot must be absolute, got ${input.vaultRoot}`)
  }
  const windowDays = input.windowDays ?? 7
  if (windowDays < 0) {
    throw new Error(`windowDays must be >= 0, got ${windowDays}`)
  }
  const t0 = Date.now()
  const limit = input.limit ?? 50
  const locators = listMarkdownLocators(input.vaultRoot)
  const now = new Date()
  // windowDays=0 means "no time filter" (return all). windowDays>0 means
  // "notes updated within the last N days" (inclusive).
  const hasFilter = windowDays > 0
  const hits: RecentHit[] = []
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
    if (input.onlyActive && fm.unifia_lifecycle !== "active") continue
    const updated = Date.parse(fm.unifia_updated_at)
    if (Number.isNaN(updated)) continue
    const ageMs = now.getTime() - updated
    const ageDays = Math.floor(ageMs / MS_PER_DAY)
    if (hasFilter && ageDays > windowDays) continue
    hits.push({
      id: fm.unifia_id as KnowledgeId,
      locator: locator as KnowledgeLocator,
      type: fm.unifia_type,
      lifecycle: fm.unifia_lifecycle as KnowledgeLifecycleState,
      updatedAt: fm.unifia_updated_at,
      ageDays,
    })
    if (hits.length >= limit) break
  }

  // Sort by age ascending (most recent first), then by locator.
  hits.sort((a, b) => a.ageDays - b.ageDays || a.locator.localeCompare(b.locator))

  return {
    vaultRoot: input.vaultRoot,
    windowDays,
    referenceDate: now.toISOString(),
    scanned,
    hits,
    totalMs: Date.now() - t0,
  }
}
