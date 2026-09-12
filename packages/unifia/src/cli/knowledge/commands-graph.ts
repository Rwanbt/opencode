/* SPDX-License-Identifier: MIT */
/**
 * Vault graph and distribution commands (card C16, C24).
 *
 * The analytical half of the former `commands-report.ts`: supersession
 * graphs, duplicates, timelines, co-occurrence and the distribution tables.
 */

import { parseFlags, } from "./shared.js"
import { supersedeGraph } from "../../knowledge/admin/supersede-graph.js"
import { findDuplicates } from "../../knowledge/admin/duplicates.js"
import { buildTimeline, formatTimeline } from "../../knowledge/admin/timeline.js"
import { tagCooccurrence } from "../../knowledge/admin/tag-cooccurrence.js"
import { classifySupersede } from "../../knowledge/admin/supersede-classify.js"
import { noteDiff } from "../../knowledge/admin/note-diff.js"
import { buildTransitionMatrix, formatTransitionMatrix } from "../../knowledge/admin/lifecycle-transitions.js"
import { noteStats } from "../../knowledge/admin/note-stats.js"
import { sizeDistribution } from "../../knowledge/admin/size-distribution.js"
import { weekdayDistribution } from "../../knowledge/admin/weekday-distribution.js"
import { edgeDensity } from "../../knowledge/admin/edge-density.js"
import { frontmatterDiff } from "../../knowledge/admin/frontmatter-diff.js"

export async function cmdSupersedeGraph(rest: readonly string[]): Promise<number> {
  const ws = rest[0]
  if (!ws) {
    process.stderr.write("supersede-graph: missing workspace path\n")
    return 2
  }
  try {
    const r = supersedeGraph({ vaultRoot: ws })
    process.stdout.write(`vault:    ${r.vaultRoot}\n`)
    process.stdout.write(`edges:    ${r.edges.length}\n`)
    process.stdout.write(`dangling: ${r.dangling.length}\n`)
    if (r.edges.length > 0) {
      process.stdout.write(`\nedges (from -> to):\n`)
      for (const e of r.edges) {
        process.stdout.write(`  ${e.fromLocator.padEnd(28)} supersedes -> ${e.to}\n`)
      }
    }
    if (r.deepest.length > 0) {
      process.stdout.write(`\ntop-3 deepest lineages:\n`)
      for (const d of r.deepest) {
        process.stdout.write(`  ${d.locator.padEnd(28)} depth=${d.depth}\n`)
      }
    }
    if (r.dangling.length > 0) {
      process.stdout.write(`\ndangling references:\n`)
      for (const d of r.dangling) {
        process.stdout.write(`  ${d.locator.padEnd(28)} -> ${d.missingId}\n`)
      }
    }
    return 0
  } catch (e) {
    process.stderr.write(`supersede-graph error: ${(e as Error).message}\n`)
    return 1
  }
}


export async function cmdDuplicates(rest: readonly string[]): Promise<number> {
  const ws = rest[0]
  if (!ws) {
    process.stderr.write("duplicates: missing workspace path\n")
    return 2
  }
  try {
    const r = findDuplicates({ vaultRoot: ws })
    process.stdout.write(`vault:          ${r.vaultRoot}\n`)
    process.stdout.write(`groups:         ${r.groups.length}\n`)
    process.stdout.write(`duplicates:     ${r.duplicateCount}\n`)
    process.stdout.write(`wasted-bytes:   ${r.wastedBytes}\n`)
    if (r.groups.length > 0) {
      process.stdout.write(`\nduplicate groups:\n`)
      for (const g of r.groups) {
        process.stdout.write(`  hash=${g.hash.slice(0, 12)}...  (${g.locators.length} copies, ${g.bytes}B each)\n`)
        for (const loc of g.locators) {
          process.stdout.write(`    - ${loc}\n`)
        }
      }
    }
    return 0
  } catch (e) {
    process.stderr.write(`duplicates error: ${(e as Error).message}\n`)
    return 1
  }
}


export async function cmdTimeline(rest: readonly string[]): Promise<number> {
  const ws = rest[0]
  if (!ws) {
    process.stderr.write("timeline: missing workspace path\n")
    return 2
  }
  const flags = parseFlags(rest.slice(1))
  const window = flags.get("window-days") !== undefined ? Number(flags.get("window-days")) : undefined
  const maxPerDay = flags.get("max-per-day") !== undefined ? Number(flags.get("max-per-day")) : 5
  try {
    const r = buildTimeline({
      vaultRoot: ws,
      ...(window !== undefined ? { windowDays: window } : {}),
    })
    process.stdout.write(formatTimeline(r, maxPerDay) + "\n")
    return 0
  } catch (e) {
    process.stderr.write(`timeline error: ${(e as Error).message}\n`)
    return 1
  }
}


export async function cmdTagCooccurrence(rest: readonly string[]): Promise<number> {
  const ws = rest[0]
  if (!ws) {
    process.stderr.write("tag-cooccurrence: missing workspace path\n")
    return 2
  }
  const flags = parseFlags(rest.slice(1))
  const minCount = flags.get("min-count") !== undefined ? Number(flags.get("min-count")) : undefined
  const limit = flags.get("limit") !== undefined ? Number(flags.get("limit")) : undefined
  try {
    const r = tagCooccurrence({
      vaultRoot: ws,
      ...(minCount !== undefined ? { minCount } : {}),
      ...(limit !== undefined ? { limit } : {}),
    })
    process.stdout.write(`vault:        ${r.vaultRoot}\n`)
    process.stdout.write(`scanned:      ${r.scanned}\n`)
    process.stdout.write(`unique-tags:  ${r.uniqueTags}\n`)
    process.stdout.write(`pairs:        ${r.pairs.length}\n`)
    if (r.pairs.length > 0) {
      process.stdout.write(`\nco-occurrence pairs:\n`)
      for (const p of r.pairs) {
        process.stdout.write(`  ${String(p.count).padStart(3)}  ${p.a.padEnd(20)} <-> ${p.b}\n`)
      }
    }
    return 0
  } catch (e) {
    process.stderr.write(`tag-cooccurrence error: ${(e as Error).message}\n`)
    return 1
  }
}


export async function cmdSupersedeClassify(rest: readonly string[]): Promise<number> {
  const ws = rest[0]
  if (!ws) {
    process.stderr.write("supersede-classify: missing workspace path\n")
    return 2
  }
  try {
    const r = classifySupersede({ vaultRoot: ws })
    process.stdout.write(`vault:     ${r.vaultRoot}\n`)
    process.stdout.write(`scanned:   ${r.scanned}\n\n`)
    process.stdout.write(`isolated:  ${r.totalByRole.isolated}  (no supersedes, no successor)\n`)
    process.stdout.write(`root:      ${r.totalByRole.root}  (has supersedes, no successor)\n`)
    process.stdout.write(`leaf:      ${r.totalByRole.leaf}  (no supersedes, has successor)\n`)
    process.stdout.write(`chain:     ${r.totalByRole.chain}  (has both)\n`)
    for (const role of ["isolated", "root", "leaf", "chain"] as const) {
      if (r.byRole[role].length === 0) continue
      process.stdout.write(`\n${role} (${r.byRole[role].length}):\n`)
      for (const n of r.byRole[role]) {
        process.stdout.write(`  - ${n.locator.padEnd(28)} ${n.type}  ${n.lifecycle}  (preds=${n.supersedesCount} succ=${n.successorCount})\n`)
      }
    }
    return 0
  } catch (e) {
    process.stderr.write(`supersede-classify error: ${(e as Error).message}\n`)
    return 1
  }
}


export async function cmdNoteDiff(rest: readonly string[]): Promise<number> {
  const ws = rest[0]
  if (!ws) {
    process.stderr.write("note-diff: missing workspace path\n")
    return 2
  }
  const flags = parseFlags(rest.slice(1))
  const aLoc = flags.get("target-a")
  const aId = flags.get("target-id-a")
  const bLoc = flags.get("target-b")
  const bId = flags.get("target-id-b")
  if (!aLoc && !aId) {
    process.stderr.write("note-diff: --target-a=<loc> or --target-id-a=<uuid> is required\n")
    return 2
  }
  if (!bLoc && !bId) {
    process.stderr.write("note-diff: --target-b=<loc> or --target-id-b=<uuid> is required\n")
    return 2
  }
  try {
    const r = noteDiff({
      vaultRoot: ws,
      ...(aLoc !== undefined ? { noteALocator: aLoc as never } : {}),
      ...(aId !== undefined ? { noteAId: aId as never } : {}),
      ...(bLoc !== undefined ? { noteBLocator: bLoc as never } : {}),
      ...(bId !== undefined ? { noteBId: bId as never } : {}),
    })
    process.stdout.write(`vault:    ${r.vaultRoot}\n`)
    process.stdout.write(`note-a:   ${r.noteA?.id}  (${r.noteA?.locator})\n`)
    process.stdout.write(`note-b:   ${r.noteB?.id}  (${r.noteB?.locator})\n`)
    process.stdout.write(`added:    ${r.added}\n`)
    process.stdout.write(`removed:  ${r.removed}\n`)
    const printSection = (label: string, lines: typeof r.frontmatterDiff) => {
      if (lines.length === 0) return
      process.stdout.write(`\n--- ${label} ---\n`)
      for (const l of lines) {
        const prefix = l.kind === "add" ? "+" : l.kind === "remove" ? "-" : " "
        process.stdout.write(`${prefix} ${l.content}\n`)
      }
    }
    printSection("frontmatter", r.frontmatterDiff)
    printSection("body", r.bodyDiff)
    return 0
  } catch (e) {
    process.stderr.write(`note-diff error: ${(e as Error).message}\n`)
    return 1
  }
}


export async function cmdLifecycleTransitions(_rest: readonly string[]): Promise<number> {
  try {
    const m = buildTransitionMatrix()
    process.stdout.write("V1 lifecycle transition matrix (per ADR-KNOW-0009):\n\n")
    process.stdout.write(formatTransitionMatrix(m) + "\n")
    process.stdout.write("\nLegend: OK = transition allowed, - = transition refused\n")
    return 0
  } catch (e) {
    process.stderr.write(`lifecycle-transitions error: ${(e as Error).message}\n`)
    return 1
  }
}

export async function cmdNoteStats(rest: readonly string[]): Promise<number> {
  const ws = rest[0]
  if (!ws) {
    process.stderr.write("note-stats: usage: note-stats <workspace> <locator>|--id=<uuid>\n")
    return 2
  }
  const idFlag = rest.find((a) => a.startsWith("--id="))
  const id = idFlag ? idFlag.slice("--id=".length) : undefined
  const locator = idFlag ? undefined : rest[1]
  if (!id && !locator) {
    process.stderr.write("note-stats: usage: note-stats <workspace> <locator>|--id=<uuid>\n")
    return 2
  }
  try {
    const r = noteStats({ vaultRoot: ws, locator, id })
    process.stdout.write(`locator:          ${r.locator}\n`)
    process.stdout.write(`id:               ${r.id ?? "-"}\n`)
    process.stdout.write(`type:             ${r.type}\n`)
    process.stdout.write(`lifecycle:        ${r.lifecycle}\n`)
    process.stdout.write(`project_ref:      ${r.projectRef ?? "-"}\n`)
    process.stdout.write(`updated_at:       ${r.updatedAt ?? "-"}\n`)
    process.stdout.write(`body:             ${r.bodyChars} chars / ${r.bodyLines} lines / ${r.bytes} bytes\n`)
    process.stdout.write(`frontmatter:      ${r.frontmatterFieldCount} fields (${r.frontmatterFieldNames.join(", ")})\n`)
    process.stdout.write(`headings:         ${r.headingCount} (max depth ${r.maxHeadingDepth})\n`)
    process.stdout.write(`wikilinks:        ${r.wikilinkOutCount} out / ${r.wikilinkInCount} in\n`)
    process.stdout.write(`tags:             ${r.tagCount} (${r.distinctTagCount} distinct)\n`)
    return 0
  } catch (e) {
    process.stderr.write(`note-stats error: ${(e as Error).message}\n`)
    return 1
  }
}

export async function cmdSizeDistribution(rest: readonly string[]): Promise<number> {
  const ws = rest[0]
  if (!ws) {
    process.stderr.write("size-distribution: usage: size-distribution <workspace>\n")
    return 2
  }
  try {
    const r = sizeDistribution({ vaultRoot: ws })
    process.stdout.write(`vault:        ${r.vaultRoot}\n`)
    process.stdout.write(`scanned:      ${r.scanned}\n`)
    process.stdout.write(`total:        ${r.totalBytes} bytes\n`)
    process.stdout.write(`mean:         ${r.meanBytes} bytes\n`)
    process.stdout.write(`median:       ${r.medianBytes} bytes\n`)
    process.stdout.write(`min/max:      ${r.minBytes} / ${r.maxBytes}\n\n`)
    process.stdout.write("distribution:\n")
    for (const [label, count] of Object.entries(r.bins)) {
      const bar = "#".repeat(count)
      process.stdout.write(`  ${label.padEnd(12)} ${String(count).padStart(4)} ${bar}\n`)
    }
    return 0
  } catch (e) {
    process.stderr.write(`size-distribution error: ${(e as Error).message}\n`)
    return 1
  }
}

export async function cmdWeekdayDistribution(rest: readonly string[]): Promise<number> {
  const ws = rest[0]
  if (!ws) {
    process.stderr.write("weekday-distribution: usage: weekday-distribution <workspace>\n")
    return 2
  }
  try {
    const r = weekdayDistribution({ vaultRoot: ws })
    process.stdout.write(`vault:    ${r.vaultRoot}\n`)
    process.stdout.write(`scanned:  ${r.scanned}\n`)
    process.stdout.write(`total:    ${r.total}\n\n`)
    process.stdout.write("by weekday (UTC, Mon=0 .. Sun=6):\n")
    for (const [label, count] of Object.entries(r.byWeekday)) {
      const bar = "#".repeat(count)
      process.stdout.write(`  ${label.padEnd(4)} ${String(count).padStart(4)} ${bar}\n`)
    }
    return 0
  } catch (e) {
    process.stderr.write(`weekday-distribution error: ${(e as Error).message}\n`)
    return 1
  }
}

export async function cmdEdgeDensity(rest: readonly string[]): Promise<number> {
  const ws = rest[0]
  if (!ws) {
    process.stderr.write("edge-density: usage: edge-density <workspace>\n")
    return 2
  }
  try {
    const r = edgeDensity({ vaultRoot: ws })
    process.stdout.write(`vault:        ${r.vaultRoot}\n`)
    process.stdout.write(`scanned:      ${r.scanned}\n`)
    process.stdout.write(`mean degree:  ${r.meanDegree}\n`)
    process.stdout.write(`max degree:   ${r.maxDegree}\n`)
    process.stdout.write(`isolated:     ${r.isolatedCount}\n\n`)
    process.stdout.write("degree histogram (in + out):\n")
    for (const [label, count] of Object.entries(r.buckets)) {
      const bar = "#".repeat(count)
      process.stdout.write(`  ${label.padEnd(6)} ${String(count).padStart(4)} ${bar}\n`)
    }
    return 0
  } catch (e) {
    process.stderr.write(`edge-density error: ${(e as Error).message}\n`)
    return 1
  }
}

export async function cmdFrontmatterDiff(rest: readonly string[]): Promise<number> {
  const ws = rest[0]
  if (!ws) {
    process.stderr.write(
      "frontmatter-diff: usage: frontmatter-diff <workspace> --target-a=<loc>|--id-a=<uuid> --target-b=<loc>|--id-b=<uuid>\n",
    )
    return 2
  }
  const targetA = rest.find((a) => a.startsWith("--target-a="))?.slice("--target-a=".length)
  const idA = rest.find((a) => a.startsWith("--id-a="))?.slice("--id-a=".length)
  const targetB = rest.find((a) => a.startsWith("--target-b="))?.slice("--target-b=".length)
  const idB = rest.find((a) => a.startsWith("--id-b="))?.slice("--id-b=".length)
  if (!targetA && !idA) {
    process.stderr.write("frontmatter-diff: missing --target-a or --id-a\n")
    return 2
  }
  if (!targetB && !idB) {
    process.stderr.write("frontmatter-diff: missing --target-b or --id-b\n")
    return 2
  }
  try {
    const r = frontmatterDiff({
      vaultRoot: ws,
      targetA,
      idA,
      targetB,
      idB,
    })
    process.stdout.write(`A: ${r.aLocator}\n`)
    process.stdout.write(`B: ${r.bLocator}\n\n`)
    process.stdout.write(`added (in B only):     ${r.added.length === 0 ? "(none)" : r.added.join(", ")}\n`)
    process.stdout.write(`removed (in A only):   ${r.removed.length === 0 ? "(none)" : r.removed.join(", ")}\n`)
    process.stdout.write(`changed:               ${r.changed.length}\n`)
    for (const c of r.changed) {
      process.stdout.write(`  ${c.key}: ${JSON.stringify(c.a)} -> ${JSON.stringify(c.b)}\n`)
    }
    process.stdout.write(`unchanged:             ${r.unchanged.length === 0 ? "(none)" : r.unchanged.join(", ")}\n`)
    return 0
  } catch (e) {
    process.stderr.write(`frontmatter-diff error: ${(e as Error).message}\n`)
    return 1
  }
}
