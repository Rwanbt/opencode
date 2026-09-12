/* SPDX-License-Identifier: MIT */
/**
 * By-project listing (P11.36).
 *
 * Lists all notes belonging to a given `unifia_project_ref`. The
 * result is sorted by locator, paginated, and includes the note's
 * id, locator, type, lifecycle, and updatedAt timestamp.
 *
 * Mirrors `by-type.ts` and `by-lifecycle.ts` but filters on the
 * project reference. A project is a logical namespace; notes
 * from different projects are isolated from each other.
 *
 * Pure / read-only.
 */

import { listMarkdownLocators } from "../classb/reachability.js"
import { parseDocument } from "../parser/parser.js"
import { readFileSync } from "node:fs"
import { join, isAbsolute } from "node:path"
import type { KnowledgeId, KnowledgeLocator, KnowledgeLifecycleState } from "@unifia/contracts/knowledge"

export interface ByProjectHit {
  id: KnowledgeId
  locator: KnowledgeLocator
  type: string
  lifecycle: KnowledgeLifecycleState
  projectRef: string
  updatedAt: string
}

export interface ByProjectInput {
  vaultRoot: string
  projectRef: string
  limit?: number
}

export interface ByProjectReport {
  vaultRoot: string
  projectRef: string
  scanned: number
  hits: ByProjectHit[]
  totalMs: number
}

export function listByProject(input: ByProjectInput): ByProjectReport {
  if (!isAbsolute(input.vaultRoot)) {
    throw new Error(`vaultRoot must be absolute, got ${input.vaultRoot}`)
  }
  if (!input.projectRef || input.projectRef.length === 0) {
    throw new Error(`projectRef must be a non-empty string`)
  }
  const t0 = Date.now()
  const limit = input.limit ?? 50
  const locators = listMarkdownLocators(input.vaultRoot)
  const hits: ByProjectHit[] = []
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
    if (fm.unifia_project_ref !== input.projectRef) continue
    hits.push({
      id: fm.unifia_id as KnowledgeId,
      locator: locator as KnowledgeLocator,
      type: fm.unifia_type,
      lifecycle: fm.unifia_lifecycle as KnowledgeLifecycleState,
      projectRef: fm.unifia_project_ref,
      updatedAt: fm.unifia_updated_at,
    })
    if (hits.length >= limit) break
  }

  hits.sort((a, b) => a.locator.localeCompare(b.locator))

  return {
    vaultRoot: input.vaultRoot,
    projectRef: input.projectRef,
    scanned,
    hits,
    totalMs: Date.now() - t0,
  }
}
