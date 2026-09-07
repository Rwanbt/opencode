/* SPDX-License-Identifier: MIT */
/**
 * Stale-notes scan (P11.39).
 *
 * Lists notes whose `unifia_updated_at` timestamp is older than
 * a given threshold (default 90 days). Such notes are candidates
 * for review: the world may have moved on but the note hasn't.
 *
 * The threshold is expressed in days. The scan reports both
 * the age (in days) and the absolute timestamp so the operator
 * can decide whether to refresh, archive, or supersede.
 *
 * Pure / read-only.
 */

import { listMarkdownLocators } from "../classb/reachability.js"
import { parseDocument } from "../parser/parser.js"
import { readFileSync } from "node:fs"
import { join, isAbsolute } from "node:path"
import type { KnowledgeId, KnowledgeLocator, KnowledgeLifecycleState } from "@unifia/contracts/knowledge"

export interface StaleHit {
  id: KnowledgeId
  locator: KnowledgeLocator
  type: string
  lifecycle: KnowledgeLifecycleState
  updatedAt: string
  ageDays: number
}

export interface StaleInput {
  vaultRoot: string
  /** Threshold in days. Notes whose age (today - updatedAt) > this are stale. */
  thresholdDays?: number
  /** If true, only consider active notes (default false = all). */
  onlyActive?: boolean
  /** Optional cap on the number of hits. Default 50. */
  limit?: number
}

export interface StaleReport {
  vaultRoot: string
  thresholdDays: number
  referenceDate: string
  scanned: number
  hits: StaleHit[]
  totalMs: number
}

const MS_PER_DAY = 24 * 60 * 60 * 1000

export function findStale(input: StaleInput): StaleReport {
  if (!isAbsolute(input.vaultRoot)) {
    throw new Error(`vaultRoot must be absolute, got ${input.vaultRoot}`)
  }
  const thresholdDays = input.thresholdDays ?? 90
  if (thresholdDays < 0) {
    throw new Error(`thresholdDays must be >= 0, got ${thresholdDays}`)
  }
  const t0 = Date.now()
  const limit = input.limit ?? 50
  const locators = listMarkdownLocators(input.vaultRoot)
  const now = new Date()
  const hits: StaleHit[] = []
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
    if (ageDays < thresholdDays) continue
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

  // Sort by age (oldest first) then by locator.
  hits.sort((a, b) => b.ageDays - a.ageDays || a.locator.localeCompare(b.locator))

  return {
    vaultRoot: input.vaultRoot,
    thresholdDays,
    referenceDate: now.toISOString(),
    scanned,
    hits,
    totalMs: Date.now() - t0,
  }
}
