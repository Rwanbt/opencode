/* SPDX-License-Identifier: MIT */
/**
 * Vault fingerprint (P11.41).
 *
 * Computes a deterministic SHA-256 fingerprint of the entire
 * canonical vault. The fingerprint is computed by:
 * 1. listing every markdown file in sorted order (locator sort),
 * 2. hashing the raw content of each file with SHA-256,
 * 3. concatenating the per-file hashes in order,
 * 4. hashing the concatenation with SHA-256.
 *
 * The result is a 64-char hex string that uniquely identifies
 * the vault's content (modulo file ordering, which is sorted).
 *
 * Use cases:
 * - detect changes between two snapshots
 * - assert two vaults are equivalent
 * - sign a vault for transport (the fingerprint is the
 *   "manifest hash" of the corpus)
 *
 * Pure / read-only. No filesystem writes, no remote calls.
 */

import { listMarkdownLocators } from "../classb/reachability.js"
import { readFileSync } from "node:fs"
import { join, isAbsolute } from "node:path"
import { createHash } from "node:crypto"

export interface FingerprintInput {
  vaultRoot: string
  /** When true, ignore parse failures (default false = include all). */
  skipMissing?: boolean
}

export interface FingerprintReport {
  vaultRoot: string
  fingerprint: string
  fileCount: number
  /** Per-file SHA-256 hashes in locator-sorted order. */
  perFile: readonly { locator: string; hash: string; bytes: number }[]
  totalMs: number
}

export function vaultFingerprint(input: FingerprintInput): FingerprintReport {
  if (!isAbsolute(input.vaultRoot)) {
    throw new Error(`vaultRoot must be absolute, got ${input.vaultRoot}`)
  }
  const t0 = Date.now()
  const locators = listMarkdownLocators(input.vaultRoot)
  // Deterministic order: locator sort.
  locators.sort()
  const perFile: { locator: string; hash: string; bytes: number }[] = []
  const h = createHash("sha256")
  let fileCount = 0
  for (const locator of locators) {
    let text: Buffer
    try {
      text = readFileSync(join(input.vaultRoot, locator))
    } catch {
      if (input.skipMissing) continue
      throw new Error(`cannot read ${locator}`)
    }
    const fileHash = createHash("sha256").update(text).digest("hex")
    h.update(fileHash)
    perFile.push({ locator, hash: fileHash, bytes: text.byteLength })
    fileCount += 1
  }
  const fingerprint = h.digest("hex")
  return {
    vaultRoot: input.vaultRoot,
    fingerprint,
    fileCount,
    perFile,
    totalMs: Date.now() - t0,
  }
}
