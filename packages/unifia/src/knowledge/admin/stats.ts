/* SPDX-License-Identifier: MIT */
/**
 * Workspace stats (P11.26).
 *
 * Extends the summary with percentages by lifecycle and type.
 * Pure / read-only.
 */

import { summarise, type Summary } from "./summary.js"
import { isAbsolute } from "node:path"

export interface StatsBreakdown {
  name: string
  count: number
  percent: number
}

export interface StatsReport {
  vaultRoot: string
  totalNotes: number
  parseFailures: number
  portableStoreEntries: number
  policyEgress: Summary["policyEgress"]
  byLifecycle: StatsBreakdown[]
  byType: StatsBreakdown[]
  totalMs: number
}

function withPercent(counts: Record<string, number>, total: number): StatsBreakdown[] {
  const out: StatsBreakdown[] = []
  for (const [k, v] of Object.entries(counts)) {
    out.push({
      name: k,
      count: v,
      percent: total > 0 ? Math.round((v * 1000) / total) / 10 : 0,
    })
  }
  out.sort((a, b) => b.count - a.count)
  return out
}

export function computeStats(vaultRoot: string): StatsReport {
  if (!isAbsolute(vaultRoot)) {
    throw new Error(`vaultRoot must be absolute, got ${vaultRoot}`)
  }
  const summary: Summary = summarise({ vaultRoot })
  const total = summary.totalNotes
  return {
    vaultRoot: summary.vaultRoot,
    totalNotes: total,
    parseFailures: summary.parseFailures,
    portableStoreEntries: summary.portableStoreEntries,
    policyEgress: summary.policyEgress,
    byLifecycle: withPercent(summary.byLifecycle, total),
    byType: withPercent(summary.byType, total),
    totalMs: summary.totalMs,
  }
}
