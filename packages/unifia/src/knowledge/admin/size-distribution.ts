/* SPDX-License-Identifier: MIT */
/**
 * Size distribution (P11.53).
 *
 * Walks the vault and produces a histogram of note sizes (in
 * bytes). Bins are fixed, log-ish:
 *
 *   [0, 1KB)   [1KB, 5KB)   [5KB, 10KB)
 *   [10KB, 50KB)   [50KB, 100KB)   [100KB, 1MB)   [1MB, +inf)
 *
 * Returns the per-bin count, total, and median (using a simple
 * averaging of middle values for even counts). Useful as a
 * quick health overview of vault payload.
 *
 * Pure / read-only.
 */

import { listMarkdownLocators } from "../classb/reachability.js"
import { readFileSync, statSync } from "node:fs"
import { join, isAbsolute } from "node:path"

const KB = 1024
const MB = 1024 * KB

const BINS: ReadonlyArray<{ label: string; min: number; max: number }> = [
  { label: "0-1KB", min: 0, max: 1 * KB },
  { label: "1-5KB", min: 1 * KB, max: 5 * KB },
  { label: "5-10KB", min: 5 * KB, max: 10 * KB },
  { label: "10-50KB", min: 10 * KB, max: 50 * KB },
  { label: "50-100KB", min: 50 * KB, max: 100 * KB },
  { label: "100KB-1MB", min: 100 * KB, max: 1 * MB },
  { label: "1MB+", min: 1 * MB, max: Number.POSITIVE_INFINITY },
]

export interface SizeDistributionReport {
  vaultRoot: string
  scanned: number
  /** Per-bin count. */
  bins: Record<string, number>
  /** Total bytes across all notes. */
  totalBytes: number
  /** Median bytes (0 if scanned=0). */
  medianBytes: number
  /** Mean bytes (0 if scanned=0). */
  meanBytes: number
  /** Max bytes. */
  maxBytes: number
  /** Min bytes. */
  minBytes: number
  totalMs: number
}

export interface SizeDistributionInput {
  vaultRoot: string
}

export function sizeDistribution(
  input: SizeDistributionInput,
): SizeDistributionReport {
  if (!isAbsolute(input.vaultRoot)) {
    throw new Error(`vaultRoot must be absolute, got ${input.vaultRoot}`)
  }
  const t0 = Date.now()
  const locators = listMarkdownLocators(input.vaultRoot)
  const bins: Record<string, number> = {}
  for (const b of BINS) bins[b.label] = 0
  const sizes: number[] = []
  let totalBytes = 0
  let maxBytes = 0
  let minBytes = Number.POSITIVE_INFINITY
  let scanned = 0

  for (const locator of locators) {
    const absPath = join(input.vaultRoot, locator)
    let size: number
    try {
      size = statSync(absPath).size
    } catch {
      try {
        size = Buffer.byteLength(readFileSync(absPath, "utf8"), "utf8")
      } catch {
        continue
      }
    }
    scanned += 1
    sizes.push(size)
    totalBytes += size
    if (size > maxBytes) maxBytes = size
    if (size < minBytes) minBytes = size
    for (const b of BINS) {
      if (size >= b.min && size < b.max) {
        bins[b.label] = (bins[b.label] ?? 0) + 1
        break
      }
    }
  }

  if (scanned === 0) {
    minBytes = 0
  }

  // median
  let medianBytes = 0
  if (sizes.length > 0) {
    const sorted = [...sizes].sort((a, b) => a - b)
    const mid = sorted.length >> 1
    medianBytes =
      sorted.length % 2 === 0
        ? Math.floor(((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2)
        : (sorted[mid] ?? 0)
  }

  const meanBytes = scanned === 0 ? 0 : Math.floor(totalBytes / scanned)

  return {
    vaultRoot: input.vaultRoot,
    scanned,
    bins,
    totalBytes,
    medianBytes,
    meanBytes,
    maxBytes,
    minBytes,
    totalMs: Date.now() - t0,
  }
}
