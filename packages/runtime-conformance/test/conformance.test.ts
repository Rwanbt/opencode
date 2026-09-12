/* SPDX-License-Identifier: MIT */
import { FakeRuntimeAdapter, OpenCodeRuntimeAdapter, UnifiaRuntimeAdapter } from "@unifia/contracts"
import { CONFORMANCE_SCENARIOS, backendFromAdapter, runConformanceSuite, type ConformanceReport } from "../src/index.js"

/**
 * The two delegating adapters are driven over a backend built from a
 * FakeRuntimeAdapter. Stated plainly: this proves each adapter honours the
 * contract and forwards faithfully. It does NOT prove the behaviour of the real
 * OpenCode runtime — wiring OpenCodeRuntimeBackend to a live session runtime is
 * a separate step, and claiming otherwise from these results would be false.
 */
const RUNTIMES: ReadonlyArray<{ label: string; create: () => FakeRuntimeAdapter | OpenCodeRuntimeAdapter | UnifiaRuntimeAdapter }> = [
  { label: "fake", create: () => new FakeRuntimeAdapter() },
  { label: "opencode (delegating over a fake backend)", create: () => new OpenCodeRuntimeAdapter(backendFromAdapter(new FakeRuntimeAdapter())) },
  { label: "unifia (delegating over a fake backend)", create: () => new UnifiaRuntimeAdapter(backendFromAdapter(new FakeRuntimeAdapter())) },
]

const reports: ConformanceReport[] = []
for (const runtime of RUNTIMES) reports.push(await runConformanceSuite(runtime.label, runtime.create))

let failed = 0
for (const report of reports) {
  for (const result of report.results) {
    if (!result.passed) {
      failed += 1
      process.stdout.write(`  FAIL ${report.runtime} / ${result.scenario}: ${result.detail}\n`)
    }
  }
}

const expected = RUNTIMES.length * CONFORMANCE_SCENARIOS.length
const passed = reports.reduce((total, report) => total + report.results.filter((result) => result.passed).length, 0)

// The count is derived from the scenario list, so adding a scenario without
// running it cannot leave a stale total behind.
if (passed + failed !== expected) throw new Error(`suite ran ${passed + failed} scenarios instead of ${expected}`)
if (failed > 0) throw new Error(`${failed} conformance scenario(s) failed`)

console.log(`RuntimeConformance: ${passed}/${expected} passed (${RUNTIMES.length} runtimes x ${CONFORMANCE_SCENARIOS.length} scenarios)`)
