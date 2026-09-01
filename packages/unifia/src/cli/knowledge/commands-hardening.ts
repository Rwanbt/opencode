/* SPDX-License-Identifier: MIT */
/**
 * Hardening, probe, and operational-check commands (card C24).
 *
 * Split out of `main.ts` (which reached 970 LOC against a 500-line target for
 * a new file). These commands exercise the system's operational guarantees:
 * doctor, sovereign-knowledge probes, disaster recovery, migration,
 * verification, drill, validation, the precommit hook, and the two
 * benchmarks. They are read-mostly — the only mutations are the
 * `precommit install` and `policy` writes, both of which the runner has to
 * opt into explicitly.
 */

import { doctor, type DoctorInput } from "../../knowledge/admin/doctor.js"
import {
  benchmarkOne,
  summarise,
} from "../../knowledge/semantic/benchmark.js"
import { simulateLargeVault } from "../../knowledge/hardening/large-vault.js"
import { planRecovery, simulateRecovery } from "../../knowledge/hardening/disaster-recovery.js"
import { runSovereigntyProbes } from "../../knowledge/hardening/sovereignty-runner.js"
import { dryRunMigration, planRollback, MIGRATION_V1_TO_V2 } from "../../knowledge/hardening/migration.js"
import { scanStaged, installPrecommitHook } from "../../knowledge/git/precommit.js"
import { runVerify } from "../../knowledge/hardening/verify.js"
import { runDrill, stubFsWithClassA } from "../../knowledge/hardening/drill.js"
import { validate } from "../../knowledge/admin/validate.js"
import { parseFlags } from "./shared.js"

export async function cmdDoctor(): Promise<number> {
  const input: DoctorInput = {
    byId: new Map(),
    knownLocators: new Set(),
    edges: [],
    index: { rebuiltAt: new Date().toISOString(), candidatesCount: 0 },
    indexedLocators: new Set(),
  }
  const r = doctor(input)
  process.stdout.write(`doctor: ${r.findings.length} finding(s)\n`)
  for (const f of r.findings) process.stdout.write(`  - ${f.category}: ${f.message}\n`)
  return 0
}

export async function cmdBench(): Promise<number> {
  const candidates = ["a", "b", "c"].map((id, i) => ({
    id: id as never,
    locator: `m/${id}.md` as never,
    type: "decision" as const,
    space: "personal" as const,
    trust: "verified" as const,
    authority: "user" as const,
    restriction: "allow" as const,
    relevance: 1 - i * 0.1,
    snippet: "",
    snippetBytes: 0,
    snippetHash: "0".repeat(64),
  }))
  const r = benchmarkOne(
    { query: "q", expected: ["a"] as never },
    candidates,
    5,
  )
  const s = summarise([r])
  process.stdout.write(
    `recall@5=${s.meanRecallAt5.toFixed(3)}  recall@10=${s.meanRecallAt10.toFixed(3)}  mrr=${s.meanMrr.toFixed(3)}  ndcg@10=${s.meanNdcgAt10.toFixed(3)}  forbidden=${s.meanForbiddenRate}  activate=${s.activate}\n`,
  )
  return 0
}

export async function cmdBenchLarge(rest: readonly string[]): Promise<number> {
  const count = Number(rest[0] ?? "100")
  const bodySize = Number(rest[1] ?? "256")
  if (!Number.isFinite(count) || !Number.isFinite(bodySize) || count <= 0 || bodySize <= 0) {
    process.stderr.write("bench-large: count and bodySize must be positive numbers\n")
    return 2
  }
  const r = simulateLargeVault(count, bodySize, 1024)
  process.stdout.write(
    `simulated ${r.count} notes, parse=${r.totalParseMs}ms (mean ${r.meanParseMs.toFixed(2)}ms), index=${r.totalIndexMs}ms (mean ${r.meanIndexMs.toFixed(2)}ms), peak body bytes=${r.peakBodyBytes}\n`,
  )
  return 0
}

export async function cmdSovereignty(rest: readonly string[]): Promise<number> {
  const flags = parseFlags(rest)
  const vaultRoot = flags.get("vault") ?? "."
  const derivedDb = flags.get("derived") ?? "./derived.db"
  const report = await runSovereigntyProbes({
    vaultRoot,
    derivedDbPath: derivedDb,
    // In V1 the operator is asked once at install time. The CLI
    // defaults assume offline; pass --online to override.
    internetOff: !flags.has("online"),
    cloudOff: !flags.has("cloud"),
    deviceIsolated: !flags.has("device"),
  })
  process.stdout.write(
    `vault:      ${report.vaultRoot}\nderived:    ${report.derivedDbPath}\n`,
  )
  for (const p of report.probes) {
    process.stdout.write(
      `  ${p.ok ? "PASS" : "FAIL"}  ${p.kind.padEnd(22)}  ${p.message}  (${p.durationMs}ms)\n`,
    )
  }
  process.stdout.write(`\nverdict:    ${report.ok ? "OK" : "FAIL"}  (total ${report.totalMs}ms)\n`)
  return report.ok ? 0 : 1
}

export async function cmdDisasterRecovery(rest: readonly string[]): Promise<number> {
  const flags = parseFlags(rest)
  // No vault is opened here: this command plans and simulates recovery
  // against a stub filesystem. It read a `--vault` value and never used
  // it, so the usage screen has stopped advertising the flag.
  const plan = planRecovery({
    classAReadable: true,
    classBReachable: true,
    classCPresent: !flags.has("no-class-c"),
    classDPresent: !flags.has("no-class-d"),
    unifiaBinaryPresent: !flags.has("no-unifia"),
    networkAvailable: !flags.has("offline"),
  })
  process.stdout.write(`detected missing: [${plan.missing.join(", ")}]\n`)
  process.stdout.write(`requires network: ${plan.requiresNetwork}\n`)
  process.stdout.write(`requires unifia:  ${plan.requiresUnifiaBinary}\n\n`)
  for (const step of plan.steps) {
    process.stdout.write(`- [${step.kind}] ${step.description}\n`)
  }
  // Simulate against a stub fs.
  const sim = simulateRecovery(plan, {
    read: (loc) => (loc === "memory/any.md" ? "# hello" : null),
    exists: (loc) => loc === "memory/any.md" || loc === "memory/any.md.unifia.json",
  })
  process.stdout.write(
    `\nsimulation: ${sim.ok ? "OK" : "FAIL"} (classA=${sim.classAStillReadable} classB=${sim.classBStillReachable} steps=${sim.stepsExecuted})\n`,
  )
  return sim.ok ? 0 : 1
}

export async function cmdMigrate(rest: readonly string[]): Promise<number> {
  const dryRun = rest.includes("--dry-run")
  const rollback = rest.includes("--rollback")
  if (rollback) {
    const p = planRollback(MIGRATION_V1_TO_V2)
    process.stdout.write(
      `rollback plan: ${p.reversibleOps} reversible op(s), ${p.nonReversibleOps} reconstructible op(s), fullRollback=${p.fullRollback}\n`,
    )
    for (const op of p.reverseOps) {
      process.stdout.write(`  - ${op.kind} ${op.target} :: ${op.details}\n`)
    }
    // We are only printing a plan; we never apply it from the CLI in V1.
    return 0
  }
  const r = dryRunMigration(MIGRATION_V1_TO_V2)
  process.stdout.write(
    `V1→V2 migration (${dryRun ? "DRY-RUN" : "REVIEW"}): ${r.totalOps} op(s), ${r.additiveOps} additive, ${r.destructiveOps} destructive\n`,
  )
  process.stdout.write(`all reconstructible: ${r.allReconstructible}\n`)
  for (const label of r.stepLabels) process.stdout.write(`  - ${label}\n`)
  if (dryRun) {
    process.stdout.write(`\nNo state was mutated. Apply with caution after review.\n`)
    return 0
  }
  process.stdout.write(
    `\nRun with --dry-run for a safe preview or --rollback to see the reverse plan.\n`,
  )
  return 0
}

export async function cmdPrecommit(rest: readonly string[]): Promise<number> {
  const sub = rest[0]
  if (sub === "install") {
    const ws = rest[1]
    if (!ws) {
      process.stderr.write("precommit install: missing workspace path\n")
      return 2
    }
    const r = installPrecommitHook(ws)
    if (!r.ok) {
      process.stderr.write(`precommit install failed: ${r.reason}\n`)
      return 1
    }
    process.stdout.write(`installed hook at ${r.hookPath}\n`)
    return 0
  }
  if (sub === "scan") {
    const staged = rest.slice(1)
    const ws = process.cwd()
    const r = scanStaged({
      workspaceRoot: ws,
      staged,
      read: (loc) => {
        try {
          return require("node:fs").readFileSync(loc, "utf8") as string
        } catch {
          return null
        }
      },
    })
    if (!r.ok) {
      for (const f of r.findings) {
        process.stderr.write(`DENY  ${f.locator}  :: ${f.classification}\n`)
      }
      return 1
    }
    process.stdout.write(`scanned ${r.scanned} staged file(s), no secrets found\n`)
    return 0
  }
  process.stderr.write(`precommit: unknown subcommand: ${sub ?? "(missing)"}\n`)
  return 2
}

export async function cmdVerify(rest: readonly string[]): Promise<number> {
  const ws = rest[0]
  if (!ws) {
    process.stderr.write("verify: missing workspace path\n")
    return 2
  }
  const flags = parseFlags(rest.slice(1))
  const derived = flags.get("derived") ?? join_(ws, "derived.db")
  const r = await runVerify({
    vaultRoot: ws,
    derivedDbPath: derived,
    internetOff: !flags.has("online"),
    cloudOff: !flags.has("cloud"),
    deviceIsolated: !flags.has("device"),
    classCPresent: !flags.has("no-class-c"),
    classDPresent: !flags.has("no-class-d"),
    unifiaBinaryPresent: !flags.has("no-unifia"),
  })
  process.stdout.write(`vault:  ${r.vaultRoot}\n\n`)
  for (const c of r.checks) {
    process.stdout.write(
      `  ${c.status.padEnd(13)}${c.name.padEnd(20)}  ${c.details}  (${c.durationMs}ms)\n`,
    )
    // Name what is behind a WARN or a FAIL; a bare count is not actionable.
    for (const f of c.findings ?? []) {
      process.stdout.write(`      - ${f}\n`)
    }
  }
  const verdict = !r.ok ? "FAIL" : r.allPassed ? "OK" : "OK (warnings / not executed)"
  process.stdout.write(`\nverdict: ${verdict}  (total ${r.totalMs}ms)\n`)

  // `--strict` is what a CI gate should run: a check that warned or never
  // executed is not evidence of health, and exiting 0 on it turns the gate
  // into decoration. Interactive runs keep the lenient exit.
  const strict = flags.has("strict") || process.env.UNIFIA_VERIFY_STRICT === "1"
  if (strict && !r.allPassed) {
    process.stdout.write("strict: failing because not every check passed\n")
    return 1
  }
  return r.ok ? 0 : 1
}

// Tiny helper for joining paths without importing node:path
// at the top of this file (kept in one place for clarity).
function join_(...parts: string[]): string {
  return parts.join("/").replace(/[\\/]+/g, "/")
}

export async function cmdDrill(): Promise<number> {
  try {
    const r = runDrill({ fs: stubFsWithClassA() })
    process.stdout.write(`drill: ${r.passed}/${r.total} scenarios OK (${r.durationMs}ms)\n`)
    for (const s of r.scenarios) {
      process.stdout.write(`  ${s.ok ? "PASS" : "FAIL"}  ${s.point.padEnd(34)}  ${s.invariant}\n`)
    }
    return r.failed === 0 ? 0 : 1
  } catch (e) {
    process.stderr.write(`drill error: ${(e as Error).message}\n`)
    return 1
  }
}

export async function cmdValidate(rest: readonly string[]): Promise<number> {
  const ws = rest[0]
  if (!ws) {
    process.stderr.write("validate: missing workspace path\n")
    return 2
  }
  try {
    const r = validate({ vaultRoot: ws })
    process.stdout.write(`vault:        ${r.vaultRoot}\n`)
    process.stdout.write(`notes parsed: ${r.notesParsed}\n`)
    process.stdout.write(`notes failed: ${r.notesFailed}\n`)
    process.stdout.write(`findings:     ${r.findings.length}\n`)
    for (const [cat, count] of Object.entries(r.byCategory)) {
      process.stdout.write(`  - ${cat}: ${count}\n`)
    }
    process.stdout.write(`\nelapsed:      ${r.durationMs}ms\n`)
    return r.findings.length === 0 ? 0 : 1
  } catch (e) {
    process.stderr.write(`validate error: ${(e as Error).message}\n`)
    return 1
  }
}
