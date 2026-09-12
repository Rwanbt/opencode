/* SPDX-License-Identifier: MIT */
/**
 * By-lifecycle listing (P11.35).
 *
 * Lists all notes in a given `unifia_lifecycle` state. The result
 * is sorted by locator, paginated, and includes the note's id,
 * locator, type, lifecycle, and updatedAt timestamp.
 *
 * Mirrors `by-type.ts` but filters on the lifecycle field. The
 * V1 lifecycle set is `candidate | active | superseded | archived`.
 *
 * Pure / read-only.
 */

import { listMarkdownLocators } from "../classb/reachability.js"
import { parseDocument } from "../parser/parser.js"
import { readFileSync } from "node:fs"
import { join, isAbsolute } from "node:path"
import type { KnowledgeId, KnowledgeLocator, KnowledgeLifecycleState } from "@unifia/contracts/knowledge"

export interface ByLifecycleHit {
  id: KnowledgeId
  locator: KnowledgeLocator
  type: string
  lifecycle: KnowledgeLifecycleState
  updatedAt: string
}

export interface ByLifecycleInput {
  vaultRoot: string
  lifecycle: KnowledgeLifecycleState
  limit?: number
}

export interface ByLifecycleReport {
  vaultRoot: string
  lifecycle: KnowledgeLifecycleState
  scanned: number
  hits: ByLifecycleHit[]
  totalMs: number
}

const VALID_LIFECYCLES: ReadonlySet<KnowledgeLifecycleState> = new Set([
  "candidate",
  "active",
  "superseded",
  "archived",
])

export function listByLifecycle(input: ByLifecycleInput): ByLifecycleReport {
  if (!isAbsolute(input.vaultRoot)) {
    throw new Error(`vaultRoot must be absolute, got ${input.vaultRoot}`)
  }
  if (!VALID_LIFECYCLES.has(input.lifecycle)) {
    throw new Error(
      `lifecycle must be one of candidate|active|superseded|archived, got ${input.lifecycle}`,
    )
  }
  const t0 = Date.now()
  const limit = input.limit ?? 50
  const locators = listMarkdownLocators(input.vaultRoot)
  const hits: ByLifecycleHit[] = []
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
    if (fm.unifia_lifecycle !== input.lifecycle) continue
    hits.push({
      id: fm.unifia_id as KnowledgeId,
      locator: locator as KnowledgeLocator,
      type: fm.unifia_type,
      lifecycle: fm.unifia_lifecycle as KnowledgeLifecycleState,
      updatedAt: fm.unifia_updated_at,
    })
    if (hits.length >= limit) break
  }

  hits.sort((a, b) => a.locator.localeCompare(b.locator))

  return {
    vaultRoot: input.vaultRoot,
    lifecycle: input.lifecycle,
    scanned,
    hits,
    totalMs: Date.now() - t0,
  }
}
