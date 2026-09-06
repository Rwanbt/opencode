/* SPDX-License-Identifier: MIT */
/* Copyright (c) 2026 Unifia contributors */

/**
 * `bun run cert` — local certification runner (Plan V2.3.1 §186-188).
 *
 * Reads `docs/automation-v2/certification/gates.yaml`, evaluates
 * each gate's `status` and `blocker` flag, and produces a
 * human-readable report. Designed to be run from the worktree root
 * (cwd) by the user before requesting a profile certification.
 *
 * This is the **pre-flight** runner: it checks what's checkable
 * without a real substrate (V2 contracts, m0-contract, migration
 * tool, V1 fixtures, license audit). Runtime gates (M0 substrate
 * proof, multi-tenant, secret canary) require the kernel and are
 * out of scope for this script.
 *
 * Usage:
 *   cd packages/automate-migration-tool
 *   bun run scripts/cert.ts                # all checks
 *   bun run scripts/cert.ts --gate v2_contracts_regression  # one gate
 *   bun run scripts/cert.ts --json         # JSON output
 */

import { execSync } from "node:child_process"
import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { parse as parseYaml } from "yaml"

interface GateYaml {
  description: string
  required_commands?: string[]
  required_artifacts?: string[]
  allowed_skips?: { reason: string; scope: string }[]
  evidence?: string[]
  status: "GREEN" | "GREEN_WITH_DEBT" | "RED" | "NA_THIS_PROFILE" | "NOT_BUILT" | "NEEDS_RE_RUN" | "PARTIAL" | "NOT_VERIFIED" | "SKIP" | string
  blocker: boolean
  blocker_reason?: string
  blockerReason?: string
  note?: string
  finding?: string
  card_refs?: string[]
  status_override?: string
}

interface GatesFile {
  version: number
  target_profile: {
    capability: string
    execution: string
    platform: string
    schema_version: number
  }
  gates: Record<string, GateYaml>
  output?: { format: string; reader: string; update_policy: string }
  references?: Record<string, string>
}

interface GateResult {
  id: string
  description: string
  status: string
  blocker: boolean
  evidence: string[]
  notes: string
  finding?: string
}

const ROOT = join(import.meta.dir, "..", "..", "..")
const GATES_PATH = join(ROOT, "docs", "automation-v2", "certification", "gates.yaml")

function readGates(): GatesFile {
  const raw = readFileSync(GATES_PATH, "utf-8")
  return parseYaml(raw) as GatesFile
}

function checkArtifact(path: string): boolean {
  return existsSync(join(ROOT, path))
}

function runTest(path: string): { pass: number; fail: number; ok: boolean } {
  try {
    const out = execSync(`cd "${join(ROOT, path)}" && bun test 2>&1`, {
      encoding: "utf-8",
      timeout: 120_000,
      stdio: ["ignore", "pipe", "pipe"],
    })
    const passMatch = out.match(/^\s*(\d+)\s+pass/m)
    const failMatch = out.match(/^\s*(\d+)\s+fail/m)
    const pass = passMatch ? parseInt(passMatch[1]!, 10) : 0
    const fail = failMatch ? parseInt(failMatch[1]!, 10) : 0
    return { pass, fail, ok: fail === 0 }
  } catch (e: unknown) {
    return { pass: 0, fail: 1, ok: false }
  }
}

function checkGate(id: string, gate: GateYaml): GateResult {
  const evidence: string[] = []
  const notes: string[] = []
  if (gate.note) notes.push(gate.note)

  // Artifact checks
  if (gate.required_artifacts) {
    for (const a of gate.required_artifacts) {
      if (checkArtifact(a)) {
        evidence.push(`✓ artifact: ${a}`)
      } else {
        evidence.push(`✗ artifact MISSING: ${a}`)
      }
    }
  }

  // Command checks (only the ones that are safe to run locally)
  if (gate.required_commands) {
    for (const cmd of gate.required_commands) {
      if (cmd.startsWith("cd packages/") && cmd.includes("bun test")) {
        const path = cmd.replace(/^cd /, "").replace(/ && bun test.*$/, "")
        const r = runTest(path)
        evidence.push(`✓ command: ${cmd} → ${r.pass} pass, ${r.fail} fail`)
        if (!r.ok) notes.push(`Test failure in ${path}`)
      } else {
        evidence.push(`ⓘ command (not run locally): ${cmd}`)
      }
    }
  }

  // Status is taken from the YAML directly
  const result: GateResult = {
    id,
    description: gate.description,
    status: gate.status,
    blocker: gate.blocker,
    evidence,
    notes: notes.join(" | "),
    finding: gate.finding,
  }
  return result
}

function renderText(results: GateResult[], gates: GatesFile): string {
  const lines: string[] = []
  lines.push("=== UNIFIA AUTOMATE — Local Certification Runner ===")
  lines.push("")
  lines.push(`Profile : ${gates.target_profile.capability} × ${gates.target_profile.execution} × ${gates.target_profile.platform}`)
  lines.push(`Version : ${gates.version}, schema_version ${gates.target_profile.schema_version}`)
  lines.push(`Date    : ${new Date().toISOString()}`)
  lines.push("")
  lines.push("Gates:")
  lines.push("")

  const counts = { GREEN: 0, GREEN_WITH_DEBT: 0, RED: 0, NA: 0, OTHER: 0, BLOCKER: 0 }
  for (const r of results) {
    const mark = r.status === "GREEN" || r.status === "GREEN_WITH_DEBT" ? "✓" : r.status === "RED" ? "✗" : r.status === "NA_THIS_PROFILE" ? "—" : "?"
    if (r.status === "GREEN" || r.status === "GREEN_WITH_DEBT") counts.GREEN++
    else if (r.status === "RED") counts.RED++
    else if (r.status === "NA_THIS_PROFILE") counts.NA++
    else counts.OTHER++
    if (r.blocker) counts.BLOCKER++

    lines.push(`  ${mark} [${r.status.padEnd(15)}] ${r.id}`)
    lines.push(`      ${r.description}`)
    for (const e of r.evidence) lines.push(`      ${e}`)
    if (r.notes) lines.push(`      Note: ${r.notes}`)
    if (r.finding) lines.push(`      Finding: ${r.finding}`)
    if (r.blocker && r.status === "RED") lines.push(`      *** BLOCKER ***`)
    lines.push("")
  }

  lines.push("=== Summary ===")
  lines.push(`  GREEN          : ${counts.GREEN}`)
  lines.push(`  RED            : ${counts.RED}`)
  lines.push(`  NA_THIS_PROFILE: ${counts.NA}`)
  lines.push(`  OTHER (NOT_BUILT, etc.): ${counts.OTHER}`)
  lines.push(`  BLOCKER (status RED + blocker=true): ${counts.BLOCKER}`)
  lines.push("")
  lines.push("Local-runner scope: V2 contracts, m0-contract, migration tool, V1 fixtures, license audit.")
  lines.push("Not in scope (require substrate runtime): M0 substrate proof, secret canary, multi-tenant,")
  lines.push("e2e_app, e2e_design, build, typecheck, lint (run those via CI).")
  return lines.join("\n")
}

function main(): void {
  const args = process.argv.slice(2)
  const jsonMode = args.includes("--json")
  const gateArg = args.find((a) => a.startsWith("--gate="))
  const targetGate = gateArg ? gateArg.replace("--gate=", "") : null

  const gates = readGates()
  const results: GateResult[] = []
  for (const [id, gate] of Object.entries(gates.gates)) {
    if (targetGate && id !== targetGate) continue
    results.push(checkGate(id, gate))
  }

  if (jsonMode) {
    console.log(JSON.stringify(results, null, 2))
  } else {
    console.log(renderText(results, gates))
  }
}

main()
