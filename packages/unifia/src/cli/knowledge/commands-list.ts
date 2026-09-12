/* SPDX-License-Identifier: MIT */
/**
 * Read-only note query commands (card C24).
 *
 * Split out of `main.ts` (which reached 970 LOC against a 500-line target for
 * a new file). These commands query the vault for specific notes and never
 * mutate state: tag search, backlinks, stats, by-type, broken links, headings,
 * and list. They share a five-line header (vault / scanned / hits) and a
 * per-hit row, but each filters on a different facet.
 */

import { tagSearch } from "../../knowledge/admin/tag-search.js"
import { findBacklinks } from "../../knowledge/admin/backlinks.js"
import { computeStats } from "../../knowledge/admin/stats.js"
import { listByType } from "../../knowledge/admin/by-type.js"
import { scanBrokenLinks } from "../../knowledge/admin/broken-links.js"
import { listHeadings } from "../../knowledge/admin/headings.js"
import { listNotes } from "../../knowledge/admin/list.js"
import { parseFlags } from "./shared.js"

export async function cmdTagSearch(rest: readonly string[]): Promise<number> {
  const ws = rest[0]
  if (!ws) {
    process.stderr.write("tag-search: missing workspace path\n")
    return 2
  }
  const tags = rest.slice(1).filter((r) => !r.startsWith("--"))
  const flags = parseFlags(rest.slice(1 + tags.length))
  const limitStr = flags.get("limit")
  const limit = limitStr && Number.isFinite(Number(limitStr)) ? Number(limitStr) : 50
  try {
    const r = tagSearch({ vaultRoot: ws, tags, limit })
    process.stdout.write(`vault:    ${r.vaultRoot}\n`)
    process.stdout.write(`query:    ${JSON.stringify(r.query)}\n`)
    process.stdout.write(`scanned:  ${r.scanned}\n`)
    process.stdout.write(`hits:     ${r.hits.length}\n`)
    for (const h of r.hits) {
      process.stdout.write(`  - ${h.id}  ${h.locator}  ${h.type}/${h.lifecycle}  [${h.tags.join(", ")}]\n`)
    }
    process.stdout.write(`\nelapsed:  ${r.totalMs}ms\n`)
    return 0
  } catch (e) {
    process.stderr.write(`tag-search error: ${(e as Error).message}\n`)
    return 1
  }
}

export async function cmdBacklinks(rest: readonly string[]): Promise<number> {
  const ws = rest[0]
  const target = rest[1]
  if (!ws || !target) {
    process.stderr.write("backlinks: usage: backlinks <workspace> <target>\n")
    return 2
  }
  try {
    const r = findBacklinks({ vaultRoot: ws, target })
    process.stdout.write(`vault:    ${r.vaultRoot}\n`)
    process.stdout.write(`target:   ${r.target}\n`)
    process.stdout.write(`scanned:  ${r.scanned}\n`)
    process.stdout.write(`hits:     ${r.hits.length}\n`)
    for (const h of r.hits) {
      process.stdout.write(`  - ${h.id}  ${h.source}  ${h.type}/${h.lifecycle}  -> ${h.matchedTarget}\n`)
    }
    process.stdout.write(`\nelapsed:  ${r.totalMs}ms\n`)
    return 0
  } catch (e) {
    process.stderr.write(`backlinks error: ${(e as Error).message}\n`)
    return 1
  }
}

export async function cmdStats(rest: readonly string[]): Promise<number> {
  const ws = rest[0]
  if (!ws) {
    process.stderr.write("stats: missing workspace path\n")
    return 2
  }
  try {
    const s = computeStats(ws)
    process.stdout.write(`vault:        ${s.vaultRoot}\n`)
    process.stdout.write(`total notes:  ${s.totalNotes}\n`)
    process.stdout.write(`parse fail:   ${s.parseFailures}\n`)
    process.stdout.write(`class B:      ${s.portableStoreEntries} entry(ies)\n`)
    process.stdout.write(`policy:       ${s.policyEgress}\n\n`)
    process.stdout.write(`by lifecycle:\n`)
    for (const b of s.byLifecycle) {
      process.stdout.write(`  ${b.name.padEnd(12)} ${String(b.count).padStart(4)}  ${b.percent.toFixed(1)}%\n`)
    }
    process.stdout.write(`\nby type:\n`)
    for (const b of s.byType) {
      process.stdout.write(`  ${b.name.padEnd(12)} ${String(b.count).padStart(4)}  ${b.percent.toFixed(1)}%\n`)
    }
    return 0
  } catch (e) {
    process.stderr.write(`stats error: ${(e as Error).message}\n`)
    return 1
  }
}

export async function cmdByType(rest: readonly string[]): Promise<number> {
  const ws = rest[0]
  const type = rest[1]
  if (!ws || !type) {
    process.stderr.write("by-type: usage: by-type <workspace> <type> [--only-active] [--limit=N]\n")
    return 2
  }
  const flags = parseFlags(rest.slice(2))
  const limitStr = flags.get("limit")
  const limit = limitStr && Number.isFinite(Number(limitStr)) ? Number(limitStr) : 50
  try {
    const r = listByType({ vaultRoot: ws, type, limit, onlyActive: flags.has("only-active") })
    process.stdout.write(`vault:    ${r.vaultRoot}\n`)
    process.stdout.write(`type:     ${r.type}\n`)
    process.stdout.write(`scanned:  ${r.scanned}\n`)
    process.stdout.write(`hits:     ${r.hits.length}\n`)
    for (const h of r.hits) {
      process.stdout.write(`  - ${h.id}  ${h.locator}  ${h.lifecycle}  updatedAt=${h.updatedAt}\n`)
    }
    return 0
  } catch (e) {
    process.stderr.write(`by-type error: ${(e as Error).message}\n`)
    return 1
  }
}

export async function cmdBrokenLinks(rest: readonly string[]): Promise<number> {
  const ws = rest[0]
  if (!ws) {
    process.stderr.write("broken-links: missing workspace path\n")
    return 2
  }
  try {
    const r = scanBrokenLinks({ vaultRoot: ws })
    process.stdout.write(`vault:    ${r.vaultRoot}\n`)
    process.stdout.write(`scanned:  ${r.scanned}\n`)
    process.stdout.write(`broken:   ${r.totalBroken}\n`)
    for (const [src, links] of Object.entries(r.bySource)) {
      process.stdout.write(`\n${src} :\n`)
      for (const l of links) {
        process.stdout.write(`  -> ${l.target}  (raw: ${l.raw})\n`)
      }
    }
    return r.totalBroken === 0 ? 0 : 1
  } catch (e) {
    process.stderr.write(`broken-links error: ${(e as Error).message}\n`)
    return 1
  }
}

export async function cmdHeadings(rest: readonly string[]): Promise<number> {
  const ws = rest[0]
  const loc = rest[1]
  if (!ws || !loc) {
    process.stderr.write("headings: usage: headings <workspace> <locator>\n")
    return 2
  }
  try {
    const r = listHeadings({ workspaceRoot: ws, locator: loc })
    process.stdout.write(`note:    ${loc}\n`)
    process.stdout.write(`count:   ${r.length}\n`)
    for (const h of r) {
      const indent = "  ".repeat(h.level - 1)
      process.stdout.write(`${indent}h${h.level}  L${h.line}  ${h.text}\n`)
    }
    return 0
  } catch (e) {
    process.stderr.write(`headings error: ${(e as Error).message}\n`)
    return 1
  }
}

export async function cmdList(rest: readonly string[]): Promise<number> {
  const ws = rest[0]
  if (!ws) {
    process.stderr.write("list: missing workspace path\n")
    return 2
  }
  const flags = parseFlags(rest.slice(1))
  const limitStr = flags.get("limit")
  const offsetStr = flags.get("offset")
  const limit = limitStr && Number.isFinite(Number(limitStr)) ? Number(limitStr) : 100
  const offset = offsetStr && Number.isFinite(Number(offsetStr)) ? Number(offsetStr) : 0
  try {
    const r = listNotes({ vaultRoot: ws, limit, offset })
    process.stdout.write(`vault:    ${r.vaultRoot}\n`)
    process.stdout.write(`hits:     ${r.hits.length}\n`)
    for (const h of r.hits) {
      process.stdout.write(`  - ${h.locator}  ${h.type}/${h.lifecycle}  ${h.updatedAt}\n`)
    }
    return 0
  } catch (e) {
    process.stderr.write(`list error: ${(e as Error).message}\n`)
    return 1
  }
}
