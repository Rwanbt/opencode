/* SPDX-License-Identifier: MIT */
/**
 * All-projects listing (P11.33).
 *
 * Walks the vault and reports the unique `unifia_project_ref` values
 * used across all notes, with their counts. Sorted by count
 * descending, then alphabetical.
 *
 * Pure / read-only. Mirrors `tags.ts` but operates on the project
 * reference instead of the tag set.
 */

import { listMarkdownLocators } from "../classb/reachability.js"
import { parseDocument } from "../parser/parser.js"
import { readFileSync } from "node:fs"
import { join, isAbsolute } from "node:path"

export interface ProjectCount {
  projectRef: string
  count: number
}

export interface AllProjectsInput {
  vaultRoot: string
}

export interface AllProjectsReport {
  vaultRoot: string
  scanned: number
  projects: ProjectCount[]
  totalMs: number
}

export function allProjects(input: AllProjectsInput): AllProjectsReport {
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
    const ref = doc.note.frontmatter.unifia_project_ref
    counts.set(ref, (counts.get(ref) ?? 0) + 1)
  }

  const projects: ProjectCount[] = Array.from(counts.entries()).map(([projectRef, count]) => ({
    projectRef,
    count,
  }))
  projects.sort((a, b) => b.count - a.count || a.projectRef.localeCompare(b.projectRef))

  return {
    vaultRoot: input.vaultRoot,
    scanned,
    projects,
    totalMs: Date.now() - t0,
  }
}
