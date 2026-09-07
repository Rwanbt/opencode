/* SPDX-License-Identifier: MIT */
/**
 * Weekday distribution (P11.54).
 *
 * Walks the vault and groups notes by the weekday of their
 * `unifia_updated_at` (UTC). Returns the per-weekday count
 * (Monday=0 .. Sunday=6) and a count of notes whose date is
 * missing or unparseable.
 *
 * Useful as a quick "when do I edit?" overview.
 *
 * Pure / read-only.
 */

import { listMarkdownLocators } from "../classb/reachability.js"
import { parseDocument } from "../parser/parser.js"
import { readFileSync } from "node:fs"
import { join, isAbsolute } from "node:path"

const WEEKDAYS: ReadonlyArray<{ idx: number; label: string }> = [
  { idx: 0, label: "Mon" },
  { idx: 1, label: "Tue" },
  { idx: 2, label: "Wed" },
  { idx: 3, label: "Thu" },
  { idx: 4, label: "Fri" },
  { idx: 5, label: "Sat" },
  { idx: 6, label: "Sun" },
]

export interface WeekdayDistributionReport {
  vaultRoot: string
  scanned: number
  /** Per-weekday count, using `Mon=0 .. Sun=6`. */
  byWeekday: Record<string, number>
  /** Total across all weekdays. */
  total: number
  totalMs: number
}

export interface WeekdayDistributionInput {
  vaultRoot: string
}

function parseUtcWeekday(iso: string | undefined): number | null {
  if (!iso) return null
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return null
  // JS getUTCDay: Sun=0, Mon=1, ... Sat=6
  // Normalize to Mon=0 .. Sun=6
  const js = d.getUTCDay()
  return (js + 6) % 7
}

export function weekdayDistribution(
  input: WeekdayDistributionInput,
): WeekdayDistributionReport {
  if (!isAbsolute(input.vaultRoot)) {
    throw new Error(`vaultRoot must be absolute, got ${input.vaultRoot}`)
  }
  const t0 = Date.now()
  const locators = listMarkdownLocators(input.vaultRoot)
  const byWeekday: Record<string, number> = {}
  for (const w of WEEKDAYS) byWeekday[w.label] = 0
  let scanned = 0
  let total = 0

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
    const wd = parseUtcWeekday(doc.note.frontmatter.unifia_updated_at)
    if (wd === null) {
      // Strict Zod already filters unparseable dates; this branch
      // is defensive in case a future contract relaxes the check.
      continue
    }
    const label = WEEKDAYS[wd]?.label ?? "Mon"
    byWeekday[label] = (byWeekday[label] ?? 0) + 1
    total += 1
  }

  return {
    vaultRoot: input.vaultRoot,
    scanned,
    byWeekday,
    total,
    totalMs: Date.now() - t0,
  }
}
