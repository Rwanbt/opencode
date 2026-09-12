/* SPDX-License-Identifier: MIT */
/**
 * Vault compare (P11.43).
 *
 * Compares two canonical vaults and reports the differences:
 * - files present in A but not in B (`onlyA`)
 * - files present in B but not in A (`onlyB`)
 * - files present in both with different content (`changed`)
 * - files present in both with identical content (`identical`)
 *
 * Uses the SHA-256 per-file hashes (same algorithm as
 * `fingerprint.ts`) for content equality.
 *
 * Pure / read-only. No filesystem writes, no remote calls.
 */

import { listMarkdownLocators } from "../classb/reachability.js"
import { readFileSync } from "node:fs"
import { join, isAbsolute } from "node:path"
import { createHash } from "node:crypto"

export interface VaultCompareInput {
  vaultA: string
  vaultB: string
}

export interface VaultCompareReport {
  vaultA: string
  vaultB: string
  /** Locators present in A but not in B. */
  onlyA: string[]
  /** Locators present in B but not in A. */
  onlyB: string[]
  /** Locators present in both but with different content. */
  changed: string[]
  /** Locators present in both with identical content. */
  identical: string[]
  /** Per-vault file count. */
  fileCountA: number
  fileCountB: number
  totalMs: number
}

function hashFile(root: string, locator: string): string | null {
  try {
    const buf = readFileSync(join(root, locator))
    return createHash("sha256").update(buf).digest("hex")
  } catch {
    return null
  }
}

export function compareVaults(input: VaultCompareInput): VaultCompareReport {
  if (!isAbsolute(input.vaultA)) {
    throw new Error(`vaultA must be absolute, got ${input.vaultA}`)
  }
  if (!isAbsolute(input.vaultB)) {
    throw new Error(`vaultB must be absolute, got ${input.vaultB}`)
  }
  const t0 = Date.now()
  const aLocators = [...listMarkdownLocators(input.vaultA)].sort()
  const bLocators = [...listMarkdownLocators(input.vaultB)].sort()
  const aSet = new Set(aLocators)
  const bSet = new Set(bLocators)
  const onlyA: string[] = []
  const onlyB: string[] = []
  const changed: string[] = []
  const identical: string[] = []

  // Walk A: anything in A but not B goes to onlyA; otherwise compare.
  for (const loc of aLocators) {
    if (!bSet.has(loc)) {
      onlyA.push(loc)
      continue
    }
    const ha = hashFile(input.vaultA, loc)
    const hb = hashFile(input.vaultB, loc)
    if (ha === null || hb === null) {
      // Could not read one of the files: treat as changed.
      changed.push(loc)
      continue
    }
    if (ha === hb) identical.push(loc)
    else changed.push(loc)
  }
  // Anything in B but not A: onlyB.
  for (const loc of bLocators) {
    if (!aSet.has(loc)) onlyB.push(loc)
  }

  return {
    vaultA: input.vaultA,
    vaultB: input.vaultB,
    onlyA,
    onlyB,
    changed,
    identical,
    fileCountA: aLocators.length,
    fileCountB: bLocators.length,
    totalMs: Date.now() - t0,
  }
}
