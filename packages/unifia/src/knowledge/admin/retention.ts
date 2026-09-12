/* SPDX-License-Identifier: MIT */
/**
 * Retention policy (card C35, R-0017).
 *
 * ADR-KNOW-0009 §1 states that a `candidate` has a maximum life — thirty days
 * by default — after which it is either promoted or archived. Nothing
 * implemented it, and its §Conséquences also promised a `doctor` check for
 * stale candidates that never existed either.
 *
 * This module reports; it does not act on its own. ADR-KNOW-0009 rejects
 * "lifecycle implicite (durée de vie basée sur timestamp)" as *too magic, no
 * traceability, no documented reason* — so a note is never archived because a
 * clock said so. What the ADR asks for is that the system **notice**, and let
 * the operator decide. The report is the noticing; applying it is a normal
 * audited mutation the caller performs.
 */

import { isAbsolute, join } from "node:path"
import { readFileSync } from "node:fs"
import { parseFrontmatter } from "../parser/frontmatter.js"
import { VaultSource } from "../source/vault.js"
import { KnowledgeFailure } from "../domain/errors.js"
import type { TrashedNote } from "../mutation/writer.js"

/** ADR-KNOW-0009 §1. */
export const DEFAULT_CANDIDATE_TTL_DAYS = 30

/** How long a deleted note stays restorable before it is worth purging. */
export const DEFAULT_TRASH_TTL_DAYS = 30

export interface RetentionInput {
  vaultRoot: string
  candidateTtlDays?: number
  trashTtlDays?: number
  /** Overridable so a test does not depend on the wall clock. */
  now?: Date
  /** Trash contents, from the writer. Omitted when only notes matter. */
  trash?: readonly TrashedNote[]
}

export interface StaleCandidate {
  locator: string
  id: string
  ageDays: number
  updatedAt: string
}

export interface RetentionReport {
  /** Candidates past their TTL: to promote or to archive, operator's call. */
  staleCandidates: StaleCandidate[]
  /** Trash entries old enough to purge. */
  purgeableTrash: Array<TrashedNote & { ageDays: number }>
  candidateTtlDays: number
  trashTtlDays: number
  /** Notes skipped because they failed to parse. */
  unreadable: string[]
}

const DAY_MS = 24 * 60 * 60 * 1000

/**
 * Report what has aged past policy. Read-only: nothing is mutated here.
 */
export async function retentionReport(input: RetentionInput): Promise<RetentionReport> {
  if (!isAbsolute(input.vaultRoot)) {
    throw KnowledgeFailure.pathUnresolved(`vaultRoot must be absolute, got ${input.vaultRoot}`)
  }
  const now = (input.now ?? new Date()).getTime()
  const candidateTtlDays = input.candidateTtlDays ?? DEFAULT_CANDIDATE_TTL_DAYS
  const trashTtlDays = input.trashTtlDays ?? DEFAULT_TRASH_TTL_DAYS

  const report: RetentionReport = {
    staleCandidates: [],
    purgeableTrash: [],
    candidateTtlDays,
    trashTtlDays,
    unreadable: [],
  }

  const source = new VaultSource({
    root: input.vaultRoot,
    space: { kind: "personal", id: "retention", label: "retention" },
  })

  for (const locator of await source.locators()) {
    let raw: string
    try {
      raw = readFileSync(join(input.vaultRoot, locator), "utf8")
    } catch {
      report.unreadable.push(locator)
      continue
    }
    let fm: ReturnType<typeof parseFrontmatter>["frontmatter"]
    try {
      fm = parseFrontmatter(raw).frontmatter
    } catch {
      report.unreadable.push(locator)
      continue
    }
    if (fm.unifia_lifecycle !== "candidate") continue

    const updated = Date.parse(fm.unifia_updated_at)
    if (!Number.isFinite(updated)) {
      report.unreadable.push(locator)
      continue
    }
    const ageDays = Math.floor((now - updated) / DAY_MS)
    if (ageDays >= candidateTtlDays) {
      report.staleCandidates.push({
        locator,
        id: fm.unifia_id,
        ageDays,
        updatedAt: fm.unifia_updated_at,
      })
    }
  }

  for (const entry of input.trash ?? []) {
    const deleted = Date.parse(entry.deletedAt)
    if (!Number.isFinite(deleted)) continue
    const ageDays = Math.floor((now - deleted) / DAY_MS)
    if (ageDays >= trashTtlDays) report.purgeableTrash.push({ ...entry, ageDays })
  }

  report.staleCandidates.sort((a, b) => b.ageDays - a.ageDays)
  report.purgeableTrash.sort((a, b) => b.ageDays - a.ageDays)
  return report
}

/** Render the report for an operator. */
export function formatRetention(report: RetentionReport): string {
  const lines: string[] = []
  lines.push(
    `candidate TTL: ${report.candidateTtlDays}d   trash TTL: ${report.trashTtlDays}d`,
    "",
  )

  if (report.staleCandidates.length === 0) {
    lines.push("no candidate past its TTL")
  } else {
    lines.push(`${report.staleCandidates.length} candidate(s) past TTL — promote or archive:`)
    for (const c of report.staleCandidates) {
      lines.push(`  ${String(c.ageDays).padStart(4)}d  ${c.locator}`)
    }
  }

  lines.push("")
  if (report.purgeableTrash.length === 0) {
    lines.push("nothing in the trash is old enough to purge")
  } else {
    lines.push(`${report.purgeableTrash.length} trash entr(ies) purgeable:`)
    for (const t of report.purgeableTrash) {
      lines.push(`  ${String(t.ageDays).padStart(4)}d  ${t.locator}  (${t.auditId})`)
    }
    lines.push("")
    lines.push("Purging destroys them permanently: emptyTrash({ confirm: true }).")
  }

  if (report.unreadable.length > 0) {
    lines.push("", `${report.unreadable.length} note(s) unreadable:`)
    for (const u of report.unreadable) lines.push(`  - ${u}`)
  }

  // Deliberately no "apply" here: ADR-KNOW-0009 rejects an implicit
  // timestamp-driven lifecycle. The system notices; the operator decides.
  return `${lines.join("\n")}\n`
}
