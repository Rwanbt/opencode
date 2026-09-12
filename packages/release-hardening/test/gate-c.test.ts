/* SPDX-License-Identifier: MIT */

/**
 * Gate C is run, not remembered.
 */

import { assertGateMatchesPlan, runGate } from "../src/gate-b.js"
import { GATE_C_CONDITIONS, PLAN_SECTION_31_CONDITIONS } from "../src/gate-c.js"

let checks = 0
const check = (condition: boolean, message: string): void => {
  checks += 1
  if (!condition) throw new Error(message)
}

assertGateMatchesPlan(GATE_C_CONDITIONS, PLAN_SECTION_31_CONDITIONS, [])
checks += 1
check(GATE_C_CONDITIONS.length === PLAN_SECTION_31_CONDITIONS.length, `the matrix holds ${GATE_C_CONDITIONS.length} conditions against ${PLAN_SECTION_31_CONDITIONS.length} in §31`)

const report = await runGate(GATE_C_CONDITIONS)

// No condition may *fail*. Failing means a capability regressed; being blocked
// means it was never in reach from this machine, and the two must not be
// reported with the same word.
for (const result of report.results) {
  check(result.status !== "failed", `Gate C condition failed — ${result.condition}: ${result.detail}`)
}

// The verdict is NO-GO, and the blockers are named rather than remembered. The
// recorded verdict used to list five, four of which had since been delivered.
check(report.verdict === "NO-GO", `Gate C reported ${report.verdict}; every blocker would have to be closed first`)
const blockers = report.results.filter((result) => result.status === "blocked").map((result) => result.condition)
check(blockers.length === 2, `expected 2 named blockers, found ${blockers.length}: ${blockers.join(", ")}`)
check(blockers.includes("Marketplace content-first"), "the marketplace blocker is not named")
check(blockers.includes("Aucun P0/P1 sécurité"), "the external-audit blocker is not named")

// Conditions that were listed as blockers before are now met, and each is
// exercised rather than asserted.
const met = report.results.filter((result) => result.status === "passed" || result.status === "covered").map((result) => result.condition)
for (const condition of ["Mémoire visible et supprimable", "UI actions déclaratives", "Artefacts versionnés", "Workflows reprenables"]) {
  check(met.includes(condition), `${condition} is not met`)
}

const executed = report.results.filter((result) => result.status === "passed").length
console.log(`GateC: ${report.verdict} — ${report.results.length} conditions (${executed} executed, ${report.results.filter((r) => r.status === "covered").length} covered elsewhere, ${report.blocked} blocked: ${blockers.join("; ")}), ${checks} assertions`)
