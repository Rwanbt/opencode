/* SPDX-License-Identifier: MIT */
/**
 * Duplicates detector (P11.46).
 *
 * Walks the canonical vault and groups notes by their SHA-256
 * content hash. Any group with more than one entry represents
 * duplicate content (same bytes, possibly different locators).
 * The tool reports:
 *  - the list of duplicate groups (hash + locators + bytes);
 *  - the total number of duplicate files (sum of `groupSize - 1`
 *    across groups);
 *  - the wasted bytes (duplicate files that could be removed).
 *
 * Pure / read-only. No filesystem writes, no remote calls.
 *
 * Note: "duplicate" here means byte-identical. Near-duplicates
 * (different content, same meaning) are out of scope.
 */

import { listMarkdownLocators } from "../classb/reachability.js"
import { readFileSync } from "node:fs"
import { join, isAbsolute } from "node:path"
import { createHash } from "node:crypto"

export interface DuplicateGroup {
  hash: string
  locators: string[]
  bytes: number
}

export interface DuplicatesInput {
  vaultRoot: string
}

export interface DuplicatesReport {
  vaultRoot: string
  groups: DuplicateGroup[]
  /** Total number of files that are duplicates (sum of (size-1) per group). */
  duplicateCount: number
  /** Total bytes that could be reclaimed. */
  wastedBytes: number
  totalMs: number
}

export function findDuplicates(input: DuplicatesInput): DuplicatesReport {
  if (!isAbsolute(input.vaultRoot)) {
    throw new Error(`vaultRoot must be absolute, got ${input.vaultRoot}`)
  }
  const t0 = Date.now()
  const locators = listMarkdownLocators(input.vaultRoot)
  const byHash = new Map<string, { locators: string[]; bytes: number }>()
  for (const loc of locators) {
    let buf: Buffer
    try {
      buf = readFileSync(join(input.vaultRoot, loc))
    } catch {
      continue
    }
    const h = createHash("sha256").update(buf).digest("hex")
    const existing = byHash.get(h)
    if (existing) {
      existing.locators.push(loc)
    } else {
      byHash.set(h, { locators: [loc], bytes: buf.byteLength })
    }
  }
  const groups: DuplicateGroup[] = []
  let duplicateCount = 0
  let wastedBytes = 0
  for (const [hash, { locators: locs, bytes }] of byHash) {
    if (locs.length > 1) {
      locs.sort()
      groups.push({ hash, locators: locs, bytes })
      duplicateCount += locs.length - 1
      wastedBytes += bytes * (locs.length - 1)
    }
  }
  groups.sort((a, b) => b.locators.length - a.locators.length || a.hash.localeCompare(b.hash))
  return {
    vaultRoot: input.vaultRoot,
    groups,
    duplicateCount,
    wastedBytes,
    totalMs: Date.now() - t0,
  }
}
