/* SPDX-License-Identifier: MIT */
/**
 * Real corpus classification (P11.10).
 *
 * Per runbook §21 P11: "fuzz parsers/frontmatter/wikilinks, path
 * attacks, crash matrices, large vault" — and the implicit
 * requirement that the doctor + indexer can run on the real
 * golden dataset.
 *
 * This module wires the existing primitives (parser, indexer,
 * doctor) into a single `classifyCorpus` function that:
 *  - walks a directory of `.md` files (via reachability.listMarkdownLocators);
 *  - parses each into a Note + chunks + edges;
 *  - runs the doctor over the result;
 *  - returns a `CorpusReport` with counts, durations, and
 *    findings.
 *
 * No mutation: read-only. Safe to call on any vault.
 */

import { parseDocument } from "../parser/parser.js"
import { indexNote } from "../derived/indexer.js"
import { doctor, type DoctorInput, type DoctorFinding } from "./doctor.js"
import { listMarkdownLocators } from "../classb/reachability.js"
import { readFileSync } from "node:fs"
import { createHash } from "node:crypto"
import { join } from "node:path"
import type { KnowledgeId, KnowledgeLocator, KnowledgeVersionHash } from "@unifia/contracts/knowledge"

export interface CorpusReport {
  vaultRoot: string
  notesParsed: number
  notesFailed: number
  /** Which notes failed, so an operator can act on a count of 1. */
  failedLocators: string[]
  totalChunks: number
  totalEdges: number
  durationMs: number
  findings: DoctorFinding[]
}

/**
 * Version hash of a note's raw text.
 *
 * This was a 32-bit djb2 whose hexadecimal was repeated eight times to fill
 * 64 characters and then cast to `KnowledgeVersionHash`. Thirty-two bits
 * collide readily, and the value fed identity, idempotence and cache
 * decisions — a placeholder cast to a contract type is worse than no value,
 * because nothing downstream can tell the difference.
 */
function versionHash(input: string): string {
  return createHash("sha256").update(input, "utf8").digest("hex")
}

export function classifyCorpus(vaultRoot: string): CorpusReport {
  const t0 = Date.now()
  const locators = listMarkdownLocators(vaultRoot)
  const indexed: Array<{ id: KnowledgeId; locator: KnowledgeLocator; type: string; lifecycle: string }> = []
  const byId = new Map<KnowledgeId, { id: KnowledgeId; locator: KnowledgeLocator; type: string; lifecycle: string }>()
  const edges: Array<{ source: KnowledgeLocator; target: KnowledgeLocator }> = []
  const indexedLocators = new Set<KnowledgeLocator>()
  let notesFailed = 0
  const failedLocators: string[] = []
  let totalChunks = 0
  let totalEdges = 0

  for (const locator of locators) {
    const full = join(vaultRoot, locator)
    let text: string
    try {
      text = readFileSync(full, "utf8")
    } catch {
      notesFailed += 1
      failedLocators.push(locator)
      continue
    }

    let doc: ReturnType<typeof parseDocument>
    try {
      doc = parseDocument(text)
    } catch {
      notesFailed += 1
      failedLocators.push(locator)
      continue
    }

    const fm = doc.note.frontmatter
    const id = fm.unifia_id as KnowledgeId
    const loc = locator as KnowledgeLocator
    const noteVersionHash = versionHash(doc.note.raw) as KnowledgeVersionHash
    // The indexer needs an id/locator/versionHash/body/chunkSize.
    const { chunks, edges: chunkEdges } = indexNote({
      id,
      locator: loc,
      versionHash: noteVersionHash,
      body: doc.note.body,
      chunkSize: 1024,
    })
    totalChunks += chunks.length
    for (const e of chunkEdges) {
      edges.push({ source: loc, target: e.target as KnowledgeLocator })
      totalEdges += 1
    }

    const entry = {
      id,
      locator: loc,
      type: fm.unifia_type,
      lifecycle: fm.unifia_lifecycle,
    }
    indexed.push(entry)
    byId.set(id, entry)
    indexedLocators.add(loc)
  }

  const input: DoctorInput = {
    byId,
    knownLocators: new Set(indexed.map((e) => e.locator)),
    edges,
    index: { rebuiltAt: new Date().toISOString(), candidatesCount: indexed.length },
    indexedLocators,
  }
  const r = doctor(input)

  return {
    vaultRoot,
    notesParsed: indexed.length,
    notesFailed,
    failedLocators,
    totalChunks,
    totalEdges,
    durationMs: Date.now() - t0,
    findings: r.findings,
  }
}
