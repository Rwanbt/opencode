/* SPDX-License-Identifier: MIT */
/**
 * Vault listing and filtering commands (card C16, C24).
 *
 * Split out of `commands-report.ts`, which reached 891 lines against a
 * 500-line target for a new file. These commands answer "what is in the
 * vault": show, list by tag/type/project/lifecycle, orphans, staleness.
 */

import { LCD_TYPES, LCD_LIFECYCLES, parseFlags, hasFlag } from "./shared.js"
import { showNote } from "../../knowledge/admin/show.js"
import { allTags } from "../../knowledge/admin/tags.js"
import { allProjects } from "../../knowledge/admin/projects.js"
import { planSupersede } from "../../knowledge/admin/supersede.js"
import { listByLifecycle } from "../../knowledge/admin/by-lifecycle.js"
import { listByProject } from "../../knowledge/admin/by-project.js"
import { findOrphans } from "../../knowledge/admin/orphans.js"
import { lifecycleDistribution } from "../../knowledge/admin/lifecycle-distribution.js"
import { findStale } from "../../knowledge/admin/stale.js"
import { findReferences } from "../../knowledge/admin/references.js"
import { vaultFingerprint } from "../../knowledge/admin/fingerprint.js"
import { listByTag } from "../../knowledge/admin/by-tag.js"
import { compareVaults } from "../../knowledge/admin/vault-compare.js"
import { findRecent } from "../../knowledge/admin/recent.js"

export async function cmdShow(rest: readonly string[]): Promise<number> {
  const ws = rest[0]
  const loc = rest[1]
  if (!ws || !loc) {
    process.stderr.write("show: usage: show <workspace> <locator>\n")
    return 2
  }
  try {
    const text = showNote({ workspaceRoot: ws, locator: loc })
    process.stdout.write(text)
    if (!text.endsWith("\n")) process.stdout.write("\n")
    return 0
  } catch (e) {
    process.stderr.write(`show error: ${(e as Error).message}\n`)
    return 1
  }
}


export async function cmdTags(rest: readonly string[]): Promise<number> {
  const ws = rest[0]
  if (!ws) {
    process.stderr.write("tags: missing workspace path\n")
    return 2
  }
  try {
    const r = allTags({ vaultRoot: ws })
    process.stdout.write(`vault:    ${r.vaultRoot}` + "\n")
    process.stdout.write(`scanned:  ${r.scanned}` + "\n")
    process.stdout.write(`unique:   ${r.tags.length}` + "\n")
    for (const t of r.tags) {
      process.stdout.write(`  - ${t.tag.padEnd(20)} ${t.count}` + "\n")
    }
    return 0
  } catch (e) {
    process.stderr.write(`tags error: ${(e as Error).message}` + "\n")
    return 1
  }
}


export async function cmdProjects(rest: readonly string[]): Promise<number> {
  const ws = rest[0]
  if (!ws) {
    process.stderr.write("projects: missing workspace path\n")
    return 2
  }
  try {
    const r = allProjects({ vaultRoot: ws })
    process.stdout.write(`vault:    ${r.vaultRoot}` + "\n")
    process.stdout.write(`scanned:  ${r.scanned}` + "\n")
    process.stdout.write(`unique:   ${r.projects.length}` + "\n")
    for (const p of r.projects) {
      process.stdout.write(`  - ${p.projectRef.padEnd(20)} ${p.count}` + "\n")
    }
    return 0
  } catch (e) {
    process.stderr.write(`projects error: ${(e as Error).message}` + "\n")
    return 1
  }
}


export async function cmdSupersede(rest: readonly string[]): Promise<number> {
  const ws = rest[0]
  if (!ws) {
    process.stderr.write("supersede: missing workspace path\n")
    return 2
  }
  const flags = parseFlags(rest.slice(1))
  const targetLocator = flags.get("target")
  const targetId = flags.get("target-id")
  const source = flags.get("source") ?? "cli"
  const reason = flags.get("reason")
  const successorLocator = flags.get("successor")
  if (!reason) {
    process.stderr.write("supersede: --reason=<r> is required\n")
    return 2
  }
  if (!targetLocator && !targetId) {
    process.stderr.write("supersede: --target=<locator> or --target-id=<uuid> is required\n")
    return 2
  }
  try {
    const plan = planSupersede({
      vaultRoot: ws,
      ...(targetLocator !== undefined ? { targetLocator } : {}),
      ...(targetId !== undefined ? { targetId: targetId as never } : {}),
      ...(successorLocator !== undefined ? { successorLocator } : {}),
      source,
      reason,
    })
    if (!plan.ok) {
      process.stderr.write(`supersede: ${plan.reason ?? "unknown error"}\n`)
      return 1
    }
    process.stdout.write(`ok:        true\n`)
    process.stdout.write(`target:    ${plan.target?.id}  (${plan.target?.locator})\n`)
    process.stdout.write(`lifecycle: ${plan.target?.lifecycle}\n`)
    process.stdout.write(`hash:      ${plan.target?.versionHash}\n`)
    if (plan.successor) {
      process.stdout.write(`successor: ${plan.successor.id}  (${plan.successor.locator})\n`)
    }
    if (plan.warnings && plan.warnings.length > 0) {
      process.stdout.write(`warnings:\n`)
      for (const w of plan.warnings) {
        process.stdout.write(`  - ${w}\n`)
      }
    }
    if (plan.intent) {
      process.stdout.write(`intent:\n`)
      process.stdout.write(`  kind:                ${plan.intent.kind}\n`)
      process.stdout.write(`  targetId:            ${plan.intent.targetId}\n`)
      process.stdout.write(`  expectedVersionHash: ${plan.intent.expectedVersionHash}\n`)
      process.stdout.write(`  reason:              ${plan.intent.reason}\n`)
      process.stdout.write(`  source:              ${plan.intent.source}\n`)
    }
    return 0
  } catch (e) {
    process.stderr.write(`supersede error: ${(e as Error).message}\n`)
    return 1
  }
}


export async function cmdByLifecycle(rest: readonly string[]): Promise<number> {
  const ws = rest[0]
  const lc = rest[1]
  if (!ws || !lc) {
    process.stderr.write("by-lifecycle: usage: by-lifecycle <workspace> <candidate|active|superseded|archived> [--limit=N]\n")
    return 2
  }
  const flags = parseFlags(rest.slice(2))
  const limit = flags.get("limit") !== undefined ? Number(flags.get("limit")) : undefined
  try {
    const r = listByLifecycle({ vaultRoot: ws, lifecycle: lc as never, ...(limit !== undefined ? { limit } : {}) })
    process.stdout.write(`vault:    ${r.vaultRoot}` + "\n")
    process.stdout.write(`lifecycle: ${r.lifecycle}` + "\n")
    process.stdout.write(`scanned:  ${r.scanned}` + "\n")
    process.stdout.write(`hits:     ${r.hits.length}` + "\n")
    for (const h of r.hits) {
      process.stdout.write(`  - ${h.locator.padEnd(28)} ${h.type}  ${h.updatedAt}` + "\n")
    }
    return 0
  } catch (e) {
    process.stderr.write(`by-lifecycle error: ${(e as Error).message}\n`)
    return 1
  }
}


export async function cmdByProject(rest: readonly string[]): Promise<number> {
  const ws = rest[0]
  const pr = rest[1]
  if (!ws || !pr) {
    process.stderr.write("by-project: usage: by-project <workspace> <project_ref> [--limit=N]\n")
    return 2
  }
  const flags = parseFlags(rest.slice(2))
  const limit = flags.get("limit") !== undefined ? Number(flags.get("limit")) : undefined
  try {
    const r = listByProject({ vaultRoot: ws, projectRef: pr, ...(limit !== undefined ? { limit } : {}) })
    process.stdout.write(`vault:      ${r.vaultRoot}` + "\n")
    process.stdout.write(`project:    ${r.projectRef}` + "\n")
    process.stdout.write(`scanned:    ${r.scanned}` + "\n")
    process.stdout.write(`hits:       ${r.hits.length}` + "\n")
    for (const h of r.hits) {
      process.stdout.write(`  - ${h.locator.padEnd(28)} ${h.type}  ${h.lifecycle}  ${h.updatedAt}` + "\n")
    }
    return 0
  } catch (e) {
    process.stderr.write(`by-project error: ${(e as Error).message}\n`)
    return 1
  }
}


export async function cmdOrphans(rest: readonly string[]): Promise<number> {
  const ws = rest[0]
  if (!ws) {
    process.stderr.write("orphans: missing workspace path\n")
    return 2
  }
  const flags = parseFlags(rest.slice(1))
  const maxLinks = flags.get("max-links") !== undefined ? Number(flags.get("max-links")) : undefined
  const limit = flags.get("limit") !== undefined ? Number(flags.get("limit")) : undefined
  try {
    const r = findOrphans({
      vaultRoot: ws,
      ...(maxLinks !== undefined ? { maxLinks } : {}),
      ...(limit !== undefined ? { limit } : {}),
    })
    process.stdout.write(`vault:     ${r.vaultRoot}` + "\n")
    process.stdout.write(`max-links: ${r.maxLinks}` + "\n")
    process.stdout.write(`scanned:   ${r.scanned}` + "\n")
    process.stdout.write(`orphans:   ${r.hits.length}` + "\n")
    for (const h of r.hits) {
      process.stdout.write(`  - ${h.locator.padEnd(28)} ${h.type}  ${h.lifecycle}  (out=${h.outboundCount})` + "\n")
    }
    return 0
  } catch (e) {
    process.stderr.write(`orphans error: ${(e as Error).message}\n`)
    return 1
  }
}


export async function cmdLifecycleDistribution(rest: readonly string[]): Promise<number> {
  const ws = rest[0]
  if (!ws) {
    process.stderr.write("lifecycle-distribution: missing workspace path\n")
    return 2
  }
  try {
    const r = lifecycleDistribution({ vaultRoot: ws })
    process.stdout.write(`vault:    ${r.vaultRoot}\n`)
    process.stdout.write(`scanned:  ${r.scanned}\n`)
    process.stdout.write(`total:    ${r.total}\n\n`)
    // Header
    const header = ["          "]
    for (const t of LCD_TYPES) header.push(t.padStart(11))
    header.push("TOTAL".padStart(11))
    process.stdout.write(header.join(" ") + "\n")
    // Rows
    for (const lc of LCD_LIFECYCLES) {
      const row = [lc.padEnd(10)]
      let rowTotal = 0
      for (const t of LCD_TYPES) {
        const v = r.matrix[lc]?.[t] ?? 0
        row.push(String(v).padStart(11))
        rowTotal += v
      }
      row.push(String(rowTotal).padStart(11))
      process.stdout.write(row.join(" ") + "\n")
    }
    // Totals row
    const totalsRow = ["TOTAL".padEnd(10)]
    let grandTotal = 0
    for (const t of LCD_TYPES) {
      const v = r.typeTotals[t] ?? 0
      totalsRow.push(String(v).padStart(11))
      grandTotal += v
    }
    totalsRow.push(String(grandTotal).padStart(11))
    process.stdout.write(totalsRow.join(" ") + "\n")
    if (r.unknownTypeCount > 0 || r.unknownLifecycleCount > 0) {
      process.stdout.write(`\nunknowns: type=${r.unknownTypeCount}  lifecycle=${r.unknownLifecycleCount}\n`)
    }
    return 0
  } catch (e) {
    process.stderr.write(`lifecycle-distribution error: ${(e as Error).message}\n`)
    return 1
  }
}


export async function cmdStale(rest: readonly string[]): Promise<number> {
  const ws = rest[0]
  if (!ws) {
    process.stderr.write("stale: missing workspace path\n")
    return 2
  }
  const flags = parseFlags(rest.slice(1))
  const threshold = flags.get("threshold-days") !== undefined ? Number(flags.get("threshold-days")) : undefined
  const limit = flags.get("limit") !== undefined ? Number(flags.get("limit")) : undefined
  const onlyActive = flags.has("only-active")
  try {
    const r = findStale({
      vaultRoot: ws,
      ...(threshold !== undefined ? { thresholdDays: threshold } : {}),
      ...(limit !== undefined ? { limit } : {}),
      onlyActive,
    })
    process.stdout.write(`vault:           ${r.vaultRoot}\n`)
    process.stdout.write(`threshold:       ${r.thresholdDays} days\n`)
    process.stdout.write(`reference-date:  ${r.referenceDate}\n`)
    process.stdout.write(`scanned:         ${r.scanned}\n`)
    process.stdout.write(`stale:           ${r.hits.length}\n`)
    for (const h of r.hits) {
      process.stdout.write(`  - ${h.locator.padEnd(28)} age=${String(h.ageDays).padStart(4)}d  ${h.lifecycle}  ${h.updatedAt}\n`)
    }
    return 0
  } catch (e) {
    process.stderr.write(`stale error: ${(e as Error).message}\n`)
    return 1
  }
}


export async function cmdReferences(rest: readonly string[]): Promise<number> {
  const ws = rest[0]
  if (!ws) {
    process.stderr.write("references: missing workspace path\n")
    return 2
  }
  const flags = parseFlags(rest.slice(1))
  const targetLocator = flags.get("target")
  const targetId = flags.get("target-id")
  if (!targetLocator && !targetId) {
    process.stderr.write("references: --target=<locator> or --target-id=<uuid> is required\n")
    return 2
  }
  try {
    const r = findReferences({
      vaultRoot: ws,
      ...(targetLocator !== undefined ? { targetLocator } : {}),
      ...(targetId !== undefined ? { targetId: targetId as never } : {}),
    })
    if (!r.target) {
      process.stderr.write("references: target not found\n")
      return 1
    }
    process.stdout.write(`target:    ${r.target.id}  (${r.target.locator})\n`)
    process.stdout.write(`refs:      ${r.references.length}\n`)
    for (const w of r.references) {
      const heading = w.heading !== undefined ? `#${w.heading}` : ""
      const alias = w.alias !== undefined ? `|${w.alias}` : ""
      process.stdout.write(`  - [[${w.target}${heading}${alias}]]  (offset=${w.start})\n`)
    }
    return 0
  } catch (e) {
    process.stderr.write(`references error: ${(e as Error).message}\n`)
    return 1
  }
}


export async function cmdFingerprint(rest: readonly string[]): Promise<number> {
  const ws = rest[0]
  if (!ws) {
    process.stderr.write("fingerprint: missing workspace path\n")
    return 2
  }
  const flags = parseFlags(rest.slice(1))
  const verbose = hasFlag(rest, "verbose") || flags.has("verbose")
  try {
    const r = vaultFingerprint({ vaultRoot: ws, skipMissing: true })
    process.stdout.write(`vault:       ${r.vaultRoot}\n`)
    process.stdout.write(`files:       ${r.fileCount}\n`)
    process.stdout.write(`fingerprint: ${r.fingerprint}\n`)
    if (verbose) {
      process.stdout.write(`\nper-file hashes:\n`)
      for (const f of r.perFile) {
        process.stdout.write(`  ${f.hash}  ${String(f.bytes).padStart(6)}  ${f.locator}\n`)
      }
    }
    return 0
  } catch (e) {
    process.stderr.write(`fingerprint error: ${(e as Error).message}\n`)
    return 1
  }
}


export async function cmdByTag(rest: readonly string[]): Promise<number> {
  const ws = rest[0]
  const tag = rest[1]
  if (!ws || !tag) {
    process.stderr.write("by-tag: usage: by-tag <workspace> <tag> [--limit=N]\n")
    return 2
  }
  const flags = parseFlags(rest.slice(2))
  const limit = flags.get("limit") !== undefined ? Number(flags.get("limit")) : undefined
  try {
    const r = listByTag({ vaultRoot: ws, tag, ...(limit !== undefined ? { limit } : {}) })
    process.stdout.write(`vault:    ${r.vaultRoot}\n`)
    process.stdout.write(`tag:      ${r.tag}\n`)
    process.stdout.write(`scanned:  ${r.scanned}\n`)
    process.stdout.write(`hits:     ${r.hits.length}\n`)
    for (const h of r.hits) {
      process.stdout.write(`  - ${h.locator.padEnd(28)} ${h.type}  ${h.lifecycle}  tags=[${h.tags.join(", ")}]\n`)
    }
    return 0
  } catch (e) {
    process.stderr.write(`by-tag error: ${(e as Error).message}\n`)
    return 1
  }
}


export async function cmdVaultCompare(rest: readonly string[]): Promise<number> {
  const a = rest[0]
  const b = rest[1]
  if (!a || !b) {
    process.stderr.write("vault-compare: usage: vault-compare <workspace_a> <workspace_b>\n")
    return 2
  }
  try {
    const r = compareVaults({ vaultA: a, vaultB: b })
    process.stdout.write(`vault A: ${r.vaultA}  (${r.fileCountA} files)\n`)
    process.stdout.write(`vault B: ${r.vaultB}  (${r.fileCountB} files)\n\n`)
    process.stdout.write(`identical: ${r.identical.length}\n`)
    process.stdout.write(`changed:   ${r.changed.length}\n`)
    process.stdout.write(`only-A:    ${r.onlyA.length}\n`)
    process.stdout.write(`only-B:    ${r.onlyB.length}\n`)
    if (r.changed.length > 0) {
      process.stdout.write(`\nchanged files:\n`)
      for (const f of r.changed) process.stdout.write(`  ${f}\n`)
    }
    if (r.onlyA.length > 0) {
      process.stdout.write(`\nonly in A:\n`)
      for (const f of r.onlyA) process.stdout.write(`  ${f}\n`)
    }
    if (r.onlyB.length > 0) {
      process.stdout.write(`\nonly in B:\n`)
      for (const f of r.onlyB) process.stdout.write(`  ${f}\n`)
    }
    return 0
  } catch (e) {
    process.stderr.write(`vault-compare error: ${(e as Error).message}\n`)
    return 1
  }
}


export async function cmdRecent(rest: readonly string[]): Promise<number> {
  const ws = rest[0]
  if (!ws) {
    process.stderr.write("recent: missing workspace path\n")
    return 2
  }
  const flags = parseFlags(rest.slice(1))
  const window = flags.get("window-days") !== undefined ? Number(flags.get("window-days")) : undefined
  const limit = flags.get("limit") !== undefined ? Number(flags.get("limit")) : undefined
  const onlyActive = hasFlag(rest, "only-active") || flags.has("only-active")
  try {
    const r = findRecent({
      vaultRoot: ws,
      ...(window !== undefined ? { windowDays: window } : {}),
      ...(limit !== undefined ? { limit } : {}),
      onlyActive,
    })
    process.stdout.write(`vault:           ${r.vaultRoot}\n`)
    process.stdout.write(`window:          ${r.windowDays} days\n`)
    process.stdout.write(`reference-date:  ${r.referenceDate}\n`)
    process.stdout.write(`scanned:         ${r.scanned}\n`)
    process.stdout.write(`recent:          ${r.hits.length}\n`)
    for (const h of r.hits) {
      process.stdout.write(`  - ${h.locator.padEnd(28)} age=${String(h.ageDays).padStart(4)}d  ${h.lifecycle}  ${h.updatedAt}\n`)
    }
    return 0
  } catch (e) {
    process.stderr.write(`recent error: ${(e as Error).message}\n`)
    return 1
  }
}
