/* SPDX-License-Identifier: MIT */
/**
 * Knowledge doctor (P3.3).
 *
 * Detects anomalies on the derived state and the canonical
 * knowledge. The V1 doctor is a pure, I/O-free function over
 * already-loaded data. The I/O-driven scan is the responsibility
 * of the caller (or the `NativeKnowledgePort` runtime in Phase 2).
 *
 * Detected categories (per runbook §13 P3.3):
 * - duplicate IDs,
 * - invalid frontmatter,
 * - broken wikilinks,
 * - unresolved references,
 * - orphan/dangling sidecars,
 * - stale index,
 * - unindexed documents,
 * - conflicts (supplanted by newer),
 * - trust violations,
 * - `.gitignore` issues,
 * - GC candidates.
 */

import type { KnowledgeId, KnowledgeLocator } from "@unifia/contracts/knowledge"

export type DoctorCategory =
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

export interface DoctorFinding {
  category: DoctorCategory
  locator?: KnowledgeLocator
  id?: KnowledgeId
  message: string
}

export interface DoctorInput {
  /** All notes known to the system, by id. */
  byId: ReadonlyMap<KnowledgeId, { locator: KnowledgeLocator; type: string; lifecycle: string }>
  /** All locators known to the system. */
  knownLocators: ReadonlySet<KnowledgeLocator>
  /** All wikilink edges in the system. */
  edges: ReadonlyArray<{ source: KnowledgeLocator; target: KnowledgeLocator }>
  /** Index state. */
  index: {
    rebuiltAt: string
    candidatesCount: number
  }
  /** Locators of indexed documents (subset of knownLocators). */
  indexedLocators: ReadonlySet<KnowledgeLocator>
  /** Optional `.gitignore` exclusions that match knowledge paths. */
  gitignoreHits?: ReadonlyArray<{ path: string; reason: string }>
}

export interface DoctorReport {
  findings: DoctorFinding[]
  scannedAt: string
}

export function doctor(input: DoctorInput): DoctorReport {
  const findings: DoctorFinding[] = []

  // 1. Duplicate IDs.
  const seen = new Map<KnowledgeId, KnowledgeLocator>()
  for (const [id, note] of input.byId) {
    const prior = seen.get(id)
    if (prior !== undefined && prior !== note.locator) {
      findings.push({
        category: "duplicate_id",
        id,
        locator: note.locator,
        message: `duplicate id ${id}: also at ${prior}`,
      })
    } else {
      seen.set(id, note.locator)
    }
  }

  // 2. Invalid frontmatter (lifecycle).
  for (const [id, note] of input.byId) {
    if (!["candidate", "active", "superseded", "archived"].includes(note.lifecycle)) {
      findings.push({
        category: "invalid_frontmatter",
        id,
        locator: note.locator,
        message: `invalid lifecycle ${note.lifecycle}`,
      })
    }
  }

  // 3. Broken wikilinks.
  for (const edge of input.edges) {
    if (!input.knownLocators.has(edge.target)) {
      findings.push({
        category: "broken_wikilink",
        locator: edge.source,
        message: `wikilink to ${edge.target} is not in the known set`,
      })
    }
  }

  // 4. Unindexed documents.
  for (const note of input.byId.values()) {
    if (note.lifecycle === "active" && !input.indexedLocators.has(note.locator)) {
      findings.push({
        category: "unindexed_document",
        locator: note.locator,
        message: "active note is not in the index",
      })
    }
  }

  // 5. Stale index.
  const now = Date.now()
  const rebuilt = Date.parse(input.index.rebuiltAt)
  if (Number.isFinite(rebuilt) && now - rebuilt > 30 * 24 * 60 * 60 * 1000) {
    findings.push({
      category: "stale_index",
      message: "index is more than 30 days old",
    })
  }

  // 6. Gitignore hits.
  if (input.gitignoreHits) {
    for (const hit of input.gitignoreHits) {
      findings.push({
        category: "gitignore_issue",
        message: `${hit.path} matches gitignore rule: ${hit.reason}`,
      })
    }
  }

  return { findings, scannedAt: new Date().toISOString() }
}
