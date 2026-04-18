#!/usr/bin/env bun
/**
 * Compare two llama-server benchmark runs.
 *
 * Usage:
 *   bun run bench/compare.ts <baseline.jsonl> <current.jsonl>
 *   bun run bench:compare <baseline.jsonl> <current.jsonl>
 *
 * Reads one JSON object per line from each file (the format produced by
 * bench/harness.ts). For every (model, config) pair found in both files,
 * prints a small table of FTL / TPS / RSS / Wall deltas, then flags
 * regressions. Exit codes:
 *   0: no regressions beyond the configured threshold
 *   1: at least one regression exceeded the threshold
 *
 * Thresholds (in %):
 *   FTL  up   > +15%   (first-token latency got worse)
 *   TPS  down >  -8%   (sustained tok/s got worse)
 *   RSS  up   > +15%   (memory got heavier)
 * Wall is informational only.
 *
 * Why this file: the audit called out "bench is standalone, no CI-visible
 * regression detector". Committing compare.ts + the bench:compare script
 * makes it trivial to wire into a cron / PR workflow once a reference
 * run is archived under bench/results/.
 */
import { readFileSync, existsSync } from "node:fs"

interface Run {
  timestamp: string
  model: string
  modelSizeMb: number
  ftlMs: number | null
  tps: number | null
  rssPeakMb: number | null
  wallSec: number | null
  // Everything else we preserve but don't compare.
  [k: string]: unknown
}

function loadJsonl(path: string): Run[] {
  if (!existsSync(path)) {
    console.error(`compare: file not found: ${path}`)
    process.exit(2)
  }
  const raw = readFileSync(path, "utf8")
  const rows: Run[] = []
  for (const line of raw.split("\n")) {
    const t = line.trim()
    if (!t) continue
    try {
      rows.push(JSON.parse(t) as Run)
    } catch (e) {
      console.warn(`compare: skipping malformed line in ${path}: ${(e as Error).message}`)
    }
  }
  return rows
}

function keyOf(r: Run): string {
  return String(r.model)
}

function pct(a: number | null, b: number | null): number | null {
  if (a == null || b == null || a === 0) return null
  return ((b - a) / a) * 100
}

function fmt(n: number | null, unit: string, digits = 1): string {
  if (n == null) return "n/a"
  return `${n.toFixed(digits)}${unit}`
}

function fmtDelta(p: number | null): string {
  if (p == null) return "  —  "
  const sign = p >= 0 ? "+" : ""
  return `${sign}${p.toFixed(1)}%`
}

function main() {
  const [, , baselinePath, currentPath] = process.argv
  if (!baselinePath || !currentPath) {
    console.error("usage: bun run bench/compare.ts <baseline.jsonl> <current.jsonl>")
    process.exit(2)
  }
  const baseline = loadJsonl(baselinePath)
  const current = loadJsonl(currentPath)

  const baseByKey = new Map<string, Run>()
  for (const r of baseline) baseByKey.set(keyOf(r), r)

  const FTL_UP = 15
  const TPS_DOWN = -8
  const RSS_UP = 15

  let regressed = false
  const lines: string[] = []
  lines.push(
    `${"model".padEnd(30)}  ${"ftl".padStart(10)}  ${"tps".padStart(10)}  ${"rss".padStart(12)}  ${"wall".padStart(10)}`,
  )

  for (const c of current) {
    const key = keyOf(c)
    const b = baseByKey.get(key)
    if (!b) {
      lines.push(`${key.padEnd(30)}  (new — no baseline, skipping compare)`)
      continue
    }

    const dFtl = pct(b.ftlMs, c.ftlMs)
    const dTps = pct(b.tps, c.tps)
    const dRss = pct(b.rssPeakMb, c.rssPeakMb)
    const dWall = pct(b.wallSec, c.wallSec)

    lines.push(
      `${key.padEnd(30)}  ${fmtDelta(dFtl).padStart(10)}  ${fmtDelta(dTps).padStart(10)}  ${fmtDelta(dRss).padStart(12)}  ${fmtDelta(dWall).padStart(10)}`,
    )
    lines.push(
      `${" ".repeat(30)}  ${fmt(c.ftlMs, "ms", 0).padStart(10)}  ${fmt(c.tps, "t/s").padStart(10)}  ${fmt(c.rssPeakMb, "MB", 0).padStart(12)}  ${fmt(c.wallSec, "s").padStart(10)}`,
    )

    if (dFtl != null && dFtl > FTL_UP) {
      lines.push(`    REGRESSION: FTL ${fmtDelta(dFtl)} > ${FTL_UP}%`)
      regressed = true
    }
    if (dTps != null && dTps < TPS_DOWN) {
      lines.push(`    REGRESSION: TPS ${fmtDelta(dTps)} < ${TPS_DOWN}%`)
      regressed = true
    }
    if (dRss != null && dRss > RSS_UP) {
      lines.push(`    REGRESSION: RSS ${fmtDelta(dRss)} > ${RSS_UP}%`)
      regressed = true
    }
  }

  process.stdout.write(lines.join("\n") + "\n")
  if (regressed) {
    console.error("\ncompare: at least one threshold was exceeded")
    process.exit(1)
  }
}

main()
