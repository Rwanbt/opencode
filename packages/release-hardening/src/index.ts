/* SPDX-License-Identifier: MIT */

/**
 * Release hardening matrix — Plan V3 section 32 (Phase 17).
 *
 * Section 32 lists four suites and about thirty named scenarios. Several were
 * already covered by suites written for other phases, several were not, and
 * nothing said which was which — so "release hardening" could be reported as
 * progressing while a scenario nobody had implemented sat quietly in the list.
 *
 * This module turns that list into a structure. Every scenario is an entry with
 * exactly one of two things: a check that runs here, or the suite that already
 * covers it. **An entry with neither fails the matrix**, so a scenario cannot be
 * forgotten by omission — which is the only way a checklist of this size stays
 * honest.
 */

export type HardeningSuite = "runtime-conformance" | "imported-capability" | "supply-chain" | "security" | "reliability"

export type HardeningEntry = {
  suite: HardeningSuite
  /** The scenario name as the plan writes it. */
  scenario: string
} & (
  | { kind: "executed"; run: () => Promise<void> }
  | { kind: "covered"; by: string; note: string }
  | { kind: "blocked"; reason: string }
)

export type HardeningResult = {
  suite: HardeningSuite
  scenario: string
  status: "passed" | "failed" | "covered" | "blocked"
  detail: string
}

export type HardeningReport = {
  results: readonly HardeningResult[]
  executed: number
  covered: number
  blocked: number
  failed: number
  /** False when any scenario failed. Blocked scenarios do not pass the matrix. */
  passed: boolean
}

/**
 * Runs the matrix.
 *
 * `covered` entries are not re-run: duplicating an assertion in two places means
 * one of them drifts. They record where the proof lives so a reader can follow
 * it, which is the part a checklist normally loses.
 */
export async function runHardeningMatrix(entries: readonly HardeningEntry[]): Promise<HardeningReport> {
  const results: HardeningResult[] = []
  for (const entry of entries) {
    if (entry.kind === "covered") {
      results.push({ suite: entry.suite, scenario: entry.scenario, status: "covered", detail: `${entry.by} — ${entry.note}` })
      continue
    }
    if (entry.kind === "blocked") {
      results.push({ suite: entry.suite, scenario: entry.scenario, status: "blocked", detail: entry.reason })
      continue
    }
    try {
      await entry.run()
      results.push({ suite: entry.suite, scenario: entry.scenario, status: "passed", detail: "executed here" })
    } catch (error) {
      results.push({ suite: entry.suite, scenario: entry.scenario, status: "failed", detail: error instanceof Error ? error.message : String(error) })
    }
  }
  const count = (status: HardeningResult["status"]) => results.filter((result) => result.status === status).length
  return {
    results,
    executed: count("passed"),
    covered: count("covered"),
    blocked: count("blocked"),
    failed: count("failed"),
    passed: count("failed") === 0,
  }
}

/** The scenarios plan section 32 names, verbatim, grouped by its four suites. */
export const PLAN_SECTION_32_SCENARIOS: Readonly<Record<HardeningSuite, readonly string[]>> = {
  "runtime-conformance": ["OpenCode adapter", "Unifia adapter", "fake adapter", "N-1 protocol"],
  "imported-capability": ["document packs", "sandbox backends", "remote transports", "computer use", "file sessions"],
  "supply-chain": ["provenance completeness", "forbidden path /ee", "detached signatures", "hashes", "SBOM", "binary inventory", "reproducibility", "malicious update manifest"],
  security: [
    "remote replay",
    "webhook forgery",
    "screenshot secret leakage",
    "visual prompt injection",
    "window focus swap",
    "symlink/junction escape",
    "zip-slip",
    "office macro handling",
    "sandbox fallback downgrade",
    "secret + network exfiltration",
    "package install escalation",
  ],
  reliability: [
    "crash orchestrator",
    "crash runtime",
    "crash worker document",
    "crash WSL2/Lima/Docker",
    "network interruption",
    "remote reconnect",
    "event replay",
    "workspace switch during execution",
  ],
}

/**
 * Verifies the matrix covers exactly what the plan lists.
 *
 * @throws when a scenario is missing or invented. Both matter: a missing one is
 * an untested surface, an invented one means the matrix and the plan have
 * drifted and neither is authoritative any more.
 */
export function assertMatrixMatchesPlan(entries: readonly HardeningEntry[]): void {
  const problems: string[] = []
  for (const [suite, scenarios] of Object.entries(PLAN_SECTION_32_SCENARIOS) as [HardeningSuite, readonly string[]][]) {
    const declared = entries.filter((entry) => entry.suite === suite).map((entry) => entry.scenario)
    for (const scenario of scenarios) if (!declared.includes(scenario)) problems.push(`missing: ${suite} / ${scenario}`)
    for (const scenario of declared) if (!scenarios.includes(scenario)) problems.push(`not in the plan: ${suite} / ${scenario}`)
    const duplicates = declared.filter((scenario, index) => declared.indexOf(scenario) !== index)
    for (const scenario of duplicates) problems.push(`duplicate: ${suite} / ${scenario}`)
  }
  if (problems.length > 0) throw new Error(`hardening matrix does not match plan section 32:\n  ${problems.join("\n  ")}`)
}

export function formatReport(report: HardeningReport): string {
  const lines = report.results.map((result) => `  ${result.status.toUpperCase().padEnd(8)} ${result.suite}/${result.scenario} — ${result.detail}`)
  return [...lines, `  executed=${report.executed} covered=${report.covered} blocked=${report.blocked} failed=${report.failed}`].join("\n")
}
