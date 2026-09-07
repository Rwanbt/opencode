/* SPDX-License-Identifier: MIT */
/**
 * Large-vault simulation (P11.2).
 *
 * V1: synthesize N notes in memory and measure parse + index time.
 * Real disk is the next step; in this session we operate on a
 * Map of documents to keep it memory-only.
 */

import { parseDocument } from "../parser/parser.js"
import { indexNote } from "../derived/indexer.js"
import type { KnowledgeId, KnowledgeLocator, KnowledgeVersionHash } from "@unifia/contracts/knowledge"

const VALID_UUID = (i: number) =>
  `0190d2c0-7b00-7000-8000-${String(i).padStart(12, "0")}`

export interface LargeVaultReport {
  count: number
  totalParseMs: number
  totalIndexMs: number
  meanParseMs: number
  meanIndexMs: number
  /** Peak heap estimate (bytes) — coarse, from Buffer.byteLength. */
  peakBodyBytes: number
}

export function simulateLargeVault(
  count: number,
  bodySize: number,
  chunkSize: number,
): LargeVaultReport {
  const start = Date.now()
  const t0Parse = start
  let peakBody = 0
  for (let i = 0; i < count; i++) {
    const body = `Title ${i}\n\n` + "x".repeat(bodySize) + `\n\n## Section\nMore text.\n`
    peakBody = Math.max(peakBody, Buffer.byteLength(body, "utf8"))
    const text = [
      "---",
      "unifia_schema: 1",
      `unifia_id: "${VALID_UUID(i)}"`,
      "unifia_type: decision",
      "unifia_lifecycle: active",
      'unifia_created_at: "2026-08-29T00:00:00Z"',
      'unifia_updated_at: "2026-08-29T00:00:00Z"',
      "unifia_project_ref: unifia",
      "unifia_supersedes: []",
      "unifia_tags: []",
      "---",
      "",
      body,
    ].join("\n")
    parseDocument(text)
  }
  const totalParseMs = Date.now() - t0Parse
  const t0Index = Date.now()
  for (let i = 0; i < count; i++) {
    const body = `Title ${i}\n\n` + "x".repeat(bodySize)
    indexNote({
      id: VALID_UUID(i) as KnowledgeId,
      locator: `m/${i}.md` as KnowledgeLocator,
      versionHash: "0".repeat(64) as KnowledgeVersionHash,
      body,
      chunkSize,
    })
  }
  const totalIndexMs = Date.now() - t0Index
  return {
    count,
    totalParseMs,
    totalIndexMs,
    meanParseMs: totalParseMs / count,
    meanIndexMs: totalIndexMs / count,
    peakBodyBytes: peakBody,
  }
}
