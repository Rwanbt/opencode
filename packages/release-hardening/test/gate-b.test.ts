/* SPDX-License-Identifier: MIT */

/**
 * Gate B is run, not declared.
 */

import { GATE_B_CONDITIONS, GATE_B_GO, GATE_B_NO_GO, assertGateMatchesPlan, runGate, type GateEntry } from "../src/gate-b.js"

let checks = 0
const check = (condition: boolean, message: string): void => {
  checks += 1
  if (!condition) throw new Error(message)
}

/** §24, transcribed. Changing the plan must break this list, not slip past it. */
const PLAN_GO = [
  "Workbench intégré dans Unifia",
  "Documents stables",
  "SandboxBroker stable",
  "Remote bridges sûrs",
  "Browser isolé",
  "Computer use contrôlé",
  "Emergency stop testé",
  "Aucune fuite de secret",
  "Aucune évasion de workspace",
  "Audit complet",
  "Toutes les surfaces ont un kill switch",
]
const PLAN_NO_GO = [
  "Computer use global",
  "Remote commands en approval auto",
  "Cookies partagés entre workspaces",
  "Screenshot complet non redacted par défaut",
  "Accès à un password manager",
  "Backend native choisi silencieusement après échec de sandbox",
  "Action financière ou publication sans confirmation",
]

assertGateMatchesPlan(GATE_B_CONDITIONS, PLAN_GO, PLAN_NO_GO)
checks += 1
check(GATE_B_NO_GO.length === PLAN_NO_GO.length, `the matrix holds ${GATE_B_NO_GO.length} NO-GO conditions against ${PLAN_NO_GO.length} in §24`)
check(GATE_B_GO.length >= PLAN_GO.length, "a GO condition from §24 is missing")

// A condition the plan does not state is drift, not diligence.
let invented = false
try {
  assertGateMatchesPlan([...GATE_B_CONDITIONS, { kind: "go", condition: "Vibes are good", evidence: "covered", by: "x", note: "y" } as GateEntry], PLAN_GO, PLAN_NO_GO)
} catch {
  invented = true
}
check(invented, "the matrix accepted a condition §24 never states")

// A condition dropped from the matrix must fail rather than shrink the gate.
let dropped = false
try {
  assertGateMatchesPlan(GATE_B_CONDITIONS.filter((entry) => entry.condition !== "Computer use global"), PLAN_GO, PLAN_NO_GO)
} catch {
  dropped = true
}
check(dropped, "dropping a NO-GO condition made the gate smaller instead of failing")

const report = await runGate(GATE_B_CONDITIONS)
for (const result of report.results) {
  check(result.status !== "failed", `Gate B condition failed — ${result.condition}: ${result.detail}`)
}
check(report.failed === 0, `${report.failed} Gate B conditions failed`)

// Every NO-GO condition must be exercised or explicitly covered — never assumed.
for (const entry of GATE_B_NO_GO) {
  check(entry.evidence !== "blocked", `NO-GO condition "${entry.condition}" is blocked, which is an open hole, not a pass`)
}
const executedNoGo = report.results.filter((result) => result.kind === "no-go" && result.status === "passed").length
check(executedNoGo >= 6, `only ${executedNoGo} of the 7 NO-GO conditions were driven against real code`)

check(report.verdict === "GO", `Gate B verdict is ${report.verdict} (${report.failed} failed, ${report.blocked} blocked)`)

const executed = report.results.filter((result) => result.status === "passed").length
const covered = report.results.filter((result) => result.status === "covered").length
console.log(`GateB: ${report.verdict} — ${report.results.length} conditions (${executed} executed, ${covered} covered elsewhere, ${report.blocked} blocked), ${checks} assertions`)
