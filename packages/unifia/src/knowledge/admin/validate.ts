/* SPDX-License-Identifier: MIT */
/**
 * Workspace validation (P11.22).
 *
 * Extends the doctor with type-specific required-fields checks.
 * Each `MemoryType` declares a list of optional frontmatter fields
 * it should carry. V1 ships conservative defaults; the operator
 * can override the rules via the policy file.
 *
 * The validation is read-only: it parses each note, checks the
 * frontmatter, and reports findings. It never mutates state.
 */

import { listMarkdownLocators } from "../classb/reachability.js"
import { parseDocument } from "../parser/parser.js"
import { readFileSync } from "node:fs"
import { join, isAbsolute } from "node:path"
import { doctor, type DoctorFinding, type DoctorInput } from "./doctor.js"
import type { KnowledgeId, KnowledgeLocator } from "@unifia/contracts/knowledge"

/** Per-type required field rules (conservative defaults). */
export const TYPE_REQUIRED_FIELDS: Record<string, readonly string[]> = {
  decision: ["unifia_project_ref"],
  constraint: ["unifia_project_ref"],
  failure: ["unifia_project_ref"],
  reference: ["unifia_project_ref"],
  episodic: ["unifia_project_ref"],
  semantic: ["unifia_project_ref"],
  preference: ["unifia_project_ref"],
  semantic_fr: ["unifia_project_ref"],
  supersedes_ref: ["unifia_project_ref"],
  other: [],
}

export type ValidationCategory =
  | "duplicate_id"
  | "invalid_frontmatter"
  | "broken_wikilink"
  | "unresolved_reference"
  | "orphan_sidecar"
  | "stale_index"
  | "unindexed_document"
  | "conflict"
  | "trust_violation"
  | "gitignore_issue"
  | "gc_candidate"
  | "type_missing_field"

export interface ValidationResult {
  vaultRoot: string
  notesParsed: number
  notesFailed: number
  findings: DoctorFinding[]
  byCategory: Record<string, number>
  durationMs: number
}

export interface ValidateInput {
  vaultRoot: string
  /** Optional override of the per-type rules. */
  rules?: Record<string, readonly string[]>
}

export function validate(input: ValidateInput): ValidationResult {
  if (!isAbsolute(input.vaultRoot)) {
    throw new Error(`vaultRoot must be absolute, got ${input.vaultRoot}`)
  }
  const t0 = Date.now()
  const rules = input.rules ?? TYPE_REQUIRED_FIELDS
  const locators = listMarkdownLocators(input.vaultRoot)
  const indexed: Array<{ id: KnowledgeId; locator: KnowledgeLocator; type: string; lifecycle: string }> = []
  const byId = new Map<KnowledgeId, { id: KnowledgeId; locator: KnowledgeLocator; type: string; lifecycle: string }>()
  const edges: Array<{ source: KnowledgeLocator; target: KnowledgeLocator }> = []
  const indexedLocators = new Set<KnowledgeLocator>()
  const findings: DoctorFinding[] = []
  let notesFailed = 0

  for (const locator of locators) {
    let text: string
    try {
      text = readFileSync(join(input.vaultRoot, locator), "utf8")
    } catch {
      notesFailed += 1
      continue
    }
    let doc: ReturnType<typeof parseDocument>
    try {
      doc = parseDocument(text)
    } catch {
      notesFailed += 1
      continue
    }
    const fm = doc.note.frontmatter
    const id = fm.unifia_id as KnowledgeId
    const loc = locator as KnowledgeLocator
    // Wikilink edge extraction (already in parser result).
    for (const wl of doc.wikilinks) {
      // Strip the optional heading anchor from the target to match
      // what the doctor expects.
      const target = wl.target.includes("#") ? wl.target.split("#")[0]! : wl.target
      edges.push({ source: loc, target: target as KnowledgeLocator })
    }
    const entry = { id, locator: loc, type: fm.unifia_type, lifecycle: fm.unifia_lifecycle }
    indexed.push(entry)
    byId.set(id, entry)
    indexedLocators.add(loc)
    // Per-type field check.
    const required = rules[fm.unifia_type] ?? []
    const present = new Set(Object.keys(fm))
    const missing = required.filter((f) => !present.has(f))
    if (missing.length > 0) {
      findings.push({
        category: "invalid_frontmatter",
        id,
        locator: loc,
        message: `type ${fm.unifia_type} is missing required field(s): ${missing.join(", ")}`,
      })
    }
  }

  // Hand off to the existing doctor for the rest of the categories.
  const docInput: DoctorInput = {
    byId,
    knownLocators: new Set(indexed.map((e) => e.locator)),
    edges,
    index: { rebuiltAt: new Date().toISOString(), candidatesCount: indexed.length },
    indexedLocators,
  }
  const r = doctor(docInput)
  findings.push(...r.findings)

  const byCategory: Record<string, number> = {}
  for (const f of findings) {
    byCategory[f.category] = (byCategory[f.category] ?? 0) + 1
  }

  return {
    vaultRoot: input.vaultRoot,
    notesParsed: indexed.length,
    notesFailed,
    findings,
    byCategory,
    durationMs: Date.now() - t0,
  }
}
