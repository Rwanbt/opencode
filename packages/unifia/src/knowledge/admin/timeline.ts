/* SPDX-License-Identifier: MIT */
/**
 * Daily timeline (P11.47).
 *
 * Walks the canonical vault and groups notes by the calendar
 * day of their `unifia_updated_at`. Returns the days sorted
 * descending (most recent first) with the count of notes
 * updated that day. Optionally restricts the timeline to a
 * window of recent days (default 30).
 *
 * The day is computed in UTC from the ISO 8601 timestamp.
 * This is a coarse activity indicator — useful for spotting
 * bursts of activity, quiet periods, and overall cadence.
 *
 * Pure / read-only.
 */

import { listMarkdownLocators } from "../classb/reachability.js"
import { parseDocument } from "../parser/parser.js"
import { readFileSync } from "node:fs"
import { join, isAbsolute } from "node:path"

const MS_PER_DAY = 24 * 60 * 60 * 1000

export interface TimelineEntry {
  /** ISO date (YYYY-MM-DD) in UTC. */
  day: string
  count: number
  /** Locators updated on this day, sorted. */
  locators: string[]
}

export interface TimelineInput {
  vaultRoot: string
  /** Window of recent days to include (default 30). 0 = no limit. */
  windowDays?: number
}

export interface TimelineReport {
  vaultRoot: string
  windowDays: number
  referenceDate: string
  totalNotes: number
  totalDays: number
  days: TimelineEntry[]
  totalMs: number
}

function dayKey(iso: string): string {
  // ISO 8601 -> "YYYY-MM-DD"
  if (iso.length < 10) return "unknown"
  return iso.slice(0, 10)
}

export function buildTimeline(input: TimelineInput): TimelineReport {
  if (!isAbsolute(input.vaultRoot)) {
    throw new Error(`vaultRoot must be absolute, got ${input.vaultRoot}`)
  }
  const windowDays = input.windowDays ?? 30
  if (windowDays < 0) {
    throw new Error(`windowDays must be >= 0, got ${windowDays}`)
  }
  const t0 = Date.now()
  const locators = listMarkdownLocators(input.vaultRoot)
  const now = new Date()
  const hasFilter = windowDays > 0
  const windowMs = windowDays * MS_PER_DAY
  const byDay = new Map<string, string[]>()
  let totalNotes = 0
  for (const loc of locators) {
    let text: string
    try {
      text = readFileSync(join(input.vaultRoot, loc), "utf8")
    } catch {
      continue
    }
    let doc: ReturnType<typeof parseDocument>
    try {
      doc = parseDocument(text)
    } catch {
      continue
    }
    const fm = doc.note.frontmatter
    const updated = Date.parse(fm.unifia_updated_at)
    if (Number.isNaN(updated)) continue
    if (hasFilter && now.getTime() - updated > windowMs) continue
    const key = dayKey(fm.unifia_updated_at)
    const arr = byDay.get(key)
    if (arr) arr.push(loc)
    else byDay.set(key, [loc])
    totalNotes += 1
  }
  const days: TimelineEntry[] = []
  for (const [day, locs] of byDay) {
    locs.sort()
    days.push({ day, count: locs.length, locators: locs })
  }
  days.sort((a, b) => (a.day < b.day ? 1 : a.day > b.day ? -1 : 0))
  return {
    vaultRoot: input.vaultRoot,
    windowDays,
    referenceDate: now.toISOString(),
    totalNotes,
    totalDays: days.length,
    days,
    totalMs: Date.now() - t0,
  }
}

export function formatTimeline(report: TimelineReport, maxLocatorsPerDay = 5): string {
  const lines: string[] = []
  lines.push(`vault:          ${report.vaultRoot}`)
  lines.push(`window:         ${report.windowDays} days`)
  lines.push(`reference-date: ${report.referenceDate}`)
  lines.push(`total-notes:    ${report.totalNotes}`)
  lines.push(`total-days:     ${report.totalDays}`)
  lines.push("")
  for (const d of report.days) {
    const locStr = d.locators.slice(0, maxLocatorsPerDay).join(", ")
    const more = d.locators.length > maxLocatorsPerDay ? ` (+${d.locators.length - maxLocatorsPerDay})` : ""
    lines.push(`${d.day}  ${String(d.count).padStart(3)} notes  ${locStr}${more}`)
  }
  return lines.join("\n")
}
