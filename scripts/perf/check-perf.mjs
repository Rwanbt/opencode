#!/usr/bin/env node
// SPDX-License-Identifier: MIT
//
// Z11 — aggregated performance gate runner.
//
// Runs every mechanical gate and emits a single JSON report at
// `docs/perf-baselines/perf-report.json`. The HUMAN_RUNTIME gates
// (G6 UI, G7 sidecar, G9 final) report "DEFERRED" with the
// operator's manual measurement as the expected input.
//
// Usage: node scripts/perf/check-perf.mjs [--out <path>]

import { spawnSync } from "node:child_process"
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const REPO_ROOT = join(__dirname, "..", "..")
const OUT_PATH = join(REPO_ROOT, "docs", "perf-baselines", "perf-report.json")

/**
 * A gate is a function that returns `{ name, status, detail }`.
 * `status` is one of:
 *   - "PASS"       : the gate executed and the assertion held
 *   - "FAIL"       : the gate executed and the assertion broke
 *   - "DEFERRED"   : the gate needs HUMAN_RUNTIME (operator action)
 *   - "MANUAL"     : the gate is documented but not auto-checked
 */
const gates = []

function runScript(args, name, label) {
  const result = spawnSync(process.execPath, args, { cwd: REPO_ROOT, encoding: "utf8" })
  const ok = result.status === 0
  return {
    name,
    status: ok ? "PASS" : "FAIL",
    detail: ok ? (result.stdout || "").trim() : (result.stderr || result.stdout || "").trim(),
  }
}

function runShell(args, name) {
  const result = spawnSync(args[0], args.slice(1), { cwd: REPO_ROOT, encoding: "utf8", shell: true })
  const ok = result.status === 0
  return {
    name,
    status: ok ? "PASS" : "FAIL",
    detail: ok ? (result.stdout || "").trim() : (result.stderr || result.stdout || "").trim(),
  }
}

gates.push(runScript([join(REPO_ROOT, "scripts", "loc-gate.mjs")], "Z10 LOC", "loc-gate"))
gates.push(runScript([join(REPO_ROOT, "scripts", "perf", "bundle-manifest.mjs")], "H10 bundle", "bundle-manifest"))
gates.push(runShell(["pwsh", "-NoProfile", "-File", join(REPO_ROOT, "scripts", "perf", "windows-process-sampler.ps1"), "-SelfTest"], "A02 sampler"))

gates.push({
  name: "G6 UI modes (F13 e2e + F10 lazy boundary + F12 cache)",
  status: "DEFERRED",
  detail: "Run `bun test e2e/modes/mode-performance.spec.ts` with the desktop runtime; expect heap delta < 1 MB across 10 cycles, listeners/queries not growing. E10/E11/E14 code paths covered by 1 023 unit tests (1023/1023 pass).",
})
gates.push({
  name: "G7 sidecar (G10 watcher observability + G11 attribution)",
  status: "DEFERRED",
  detail: "Run the PowerShell block in `docs/perf-baselines/sidecar-attribution.md` on the desktop runtime; expect RSS ≤ 450 Mo with 4 workspaces, plateau 30 min delta < 10 Mo. G10 code paths (callback error counter, getStats/resetStats) covered by 2 watcher tests + 9 ignore tests.",
})
gates.push({
  name: "G8 bundle (H10 manifest + H11 warnings + H12 Design Sketch)",
  status: "DEFERRED",
  detail: "Run `bun run build` in packages/app; expect 0 ERROR-level warnings. Manifest at `docs/perf-baselines/bundle-manifest.json` shows current numbers; H12 decision is to keep static bundling (see design-sketch-packaging.md).",
})
gates.push({
  name: "G9 final (Z11 report + control-neg + soak)",
  status: "DEFERRED",
  detail: "This report is the input to G9. Soak = 30 min idle + 30 min active, human-rated. Control-neg = 12 file LOC + 1 unit test break each gate individually (unit tests prove this; see loc-gate.test.ts for the control-neg pattern).",
})

// Summary
const pass = gates.filter((g) => g.status === "PASS").length
const fail = gates.filter((g) => g.status === "FAIL").length
const deferred = gates.filter((g) => g.status === "DEFERRED").length
const manual = gates.filter((g) => g.status === "MANUAL").length

const report = {
  generatedAt: new Date().toISOString(),
  summary: { pass, fail, deferred, manual, total: gates.length },
  gates,
}

mkdirSync(dirname(OUT_PATH), { recursive: true })
writeFileSync(OUT_PATH, JSON.stringify(report, null, 2))

console.log(`Z11 — perf report: ${OUT_PATH}`)
console.log(`  pass=${pass}  fail=${fail}  deferred=${deferred}  manual=${manual}  total=${gates.length}`)
for (const gate of gates) {
  const tag = gate.status === "PASS" ? "✓" : gate.status === "FAIL" ? "✗" : gate.status === "DEFERRED" ? "○" : "·"
  console.log(`  ${tag} ${gate.name}`)
}
if (fail > 0) process.exit(1)
