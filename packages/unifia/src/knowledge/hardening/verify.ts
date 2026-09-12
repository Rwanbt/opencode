/* SPDX-License-Identifier: MIT */
/**
 * Full verify (P11.13).
 *
 * Single entry point that runs the four V1 sovereignty checks
 * and reports a pass/fail summary. Used by the CLI `unifia
 * knowledge verify` command and by future CI integrations.
 *
 * The checks are:
 *  1. Sovereignty (vault, derived DB, internet, cloud, device).
 *  2. Disaster recovery (plan, simulate).
 *  3. Reachability (Class A vs Class B).
 *  4. Corpus classification (parse + index + doctor).
 *
 * The function is read-only. It never mutates state.
 */

import { runSovereigntyProbes, type SovereigntyReport } from "./sovereignty-runner.js"
import { planRecovery, simulateRecovery, type RecoveryPlan } from "./disaster-recovery.js"
import { scanReachability, type ReachabilityScan } from "../classb/reachability.js"
import { classifyCorpus, type CorpusReport } from "../admin/corpus-classify.js"
import type { InMemoryFs } from "./disaster-recovery.js"

export interface VerifyInput {
  /** Absolute path to the canonical vault root. */
  vaultRoot: string
  /** Absolute path to the derived DB. */
  derivedDbPath: string
  /** True if the operator confirms the process is offline. */
  internetOff: boolean
  /** True if the operator confirms no cloud API is invoked. */
  cloudOff: boolean
  /** True if the operator confirms no Android device is connected. */
  deviceIsolated: boolean
  /** True if the operator confirms the Class C control state is present. */
  classCPresent: boolean
  /** True if the operator confirms the Class D derived DB is present. */
  classDPresent: boolean
  /** True if the Unifia binary is available. */
  unifiaBinaryPresent: boolean
}

/**
 * Outcome of one verification.
 *
 * `WARN` exists because this report used to collapse anomalies into `ok`:
 * reachability passed with orphans and missing sidecars, and the recovery
 * check passed on a simulation over a stub filesystem. An anomaly is not a
 * success and a simulation is not an execution.
 */
export type VerifyStatus = "PASS" | "WARN" | "FAIL" | "NOT_EXECUTED"

export interface VerifyCheck {
  name: "sovereignty" | "disaster-recovery" | "reachability" | "classify"
  status: VerifyStatus
  /** True only for PASS. Kept so existing callers keep compiling. */
  ok: boolean
  durationMs: number
  details: string
  /** Files or probes behind a WARN/FAIL, not just a count. */
  findings?: string[]
}

function check(
  name: VerifyCheck["name"],
  status: VerifyStatus,
  durationMs: number,
  details: string,
  findings?: string[],
): VerifyCheck {
  const c: VerifyCheck = { name, status, ok: status === "PASS", durationMs, details }
  if (findings !== undefined && findings.length > 0) c.findings = findings
  return c
}

export interface VerifyReport {
  vaultRoot: string
  checks: VerifyCheck[]
  /** No check FAILed. WARN and NOT_EXECUTED are compatible with ok. */
  ok: boolean
  /** Every check ran and passed. Strictly stronger than `ok`. */
  allPassed: boolean
  totalMs: number
}

/** Run all V1 sovereignty checks. */
export async function runVerify(input: VerifyInput): Promise<VerifyReport> {
  const t0 = Date.now()
  const checks: VerifyCheck[] = []

  // 1. Sovereignty.
  const t1 = Date.now()
  const sov: SovereigntyReport = await runSovereigntyProbes({
    vaultRoot: input.vaultRoot,
    derivedDbPath: input.derivedDbPath,
    internetOff: input.internetOff,
    cloudOff: input.cloudOff,
    deviceIsolated: input.deviceIsolated,
  })
  // Three of the five probes read an operator assertion rather than
  // measuring anything; say so instead of calling them probes.
  const asserted = ["internet-off", "cloud-off", "device-isolated"]
  const measured = sov.probes.filter((p) => !asserted.includes(p.kind))
  checks.push(
    check(
      "sovereignty",
      sov.ok ? "PASS" : "FAIL",
      Date.now() - t1,
      `${measured.length} probed, ${sov.probes.length - measured.length} operator_asserted; verdict=${sov.ok ? "OK" : "FAIL"}`,
      sov.probes.filter((p) => !p.ok).map((p) => p.kind),
    ),
  )

  // 2. Disaster recovery.
  const t2 = Date.now()
  // classBReachable was hardcoded true. Derive it from the actual scan.
  let classBReachable = false
  try {
    const probe = scanReachability(input.vaultRoot)
    classBReachable = probe.orphans.length === 0
  } catch {
    classBReachable = false
  }
  const plan: RecoveryPlan = planRecovery({
    classAReadable: sov.probes.find((p) => p.kind === "vault-readable")?.ok ?? false,
    classBReachable,
    classCPresent: input.classCPresent,
    classDPresent: input.classDPresent,
    unifiaBinaryPresent: input.unifiaBinaryPresent,
    networkAvailable: !input.internetOff,
  })
  const stubFs: InMemoryFs = {
    read: (loc) => (loc === "memory/any.md" ? "# stub" : null),
    exists: (loc) => loc === "memory/any.md" || loc === "memory/any.md.unifia.json",
  }
  const sim = simulateRecovery(plan, stubFs)
  // A simulation over a stub filesystem is not a recovery. The plan can be
  // validated here; executing it is a separate, destructive operation.
  checks.push(
    check(
      "disaster-recovery",
      sim.ok && plan.steps.every((st) => st.kind !== "stop-and-ask-operator")
        ? "NOT_EXECUTED"
        : "FAIL",
      Date.now() - t2,
      `${plan.steps.length} step(s) planned; plan validated in simulation only (no real recovery executed); missing=[${plan.missing.join(",")}]`,
      plan.missing,
    ),
  )

  // 3. Reachability.
  const t3 = Date.now()
  let reach: ReachabilityScan | null = null
  let reachStatus: VerifyStatus = "PASS"
  let reachFindings: string[] = []
  let reachDetails = "0 note(s), 0 entry(ies)"
  try {
    reach = scanReachability(input.vaultRoot)
    reachDetails = `classA=${reach.classALocators.length}, classB=${reach.classBEntries.length}, orphans=${reach.orphans.length}, missingSidecars=${reach.missingSidecars.length}`
    // An orphan or a missing sidecar is an anomaly the operator should see.
    // It is not fatal, so it warns rather than failing — but it is not a pass.
    reachStatus =
      reach.orphans.length === 0 && reach.missingSidecars.length === 0 ? "PASS" : "WARN"
    reachFindings = [
      ...reach.orphans.map((o) => `orphan: ${o}`),
      ...reach.missingSidecars.map((m) => `missing sidecar: ${m}`),
    ]
  } catch (e) {
    reachStatus = "FAIL"
    reachDetails = `scan failed: ${(e as Error).message}`
  }
  checks.push(check("reachability", reachStatus, Date.now() - t3, reachDetails, reachFindings))

  // 4. Classify.
  const t4 = Date.now()
  let cls: CorpusReport | null = null
  let clsStatus: VerifyStatus = "PASS"
  let clsFindings: string[] = []
  let clsDetails = "0 note(s) parsed"
  try {
    cls = classifyCorpus(input.vaultRoot)
    const nonStale = cls.findings.filter((f) => f.category !== "stale_index")
    // A note that failed to parse is an anomaly even when no finding was
    // raised for it; it was previously invisible in the verdict.
    clsStatus = nonStale.length > 0 ? "FAIL" : cls.notesFailed > 0 ? "WARN" : "PASS"
    clsDetails = `parsed=${cls.notesParsed}, failed=${cls.notesFailed}, findings=${nonStale.length}`
    clsFindings = [
      ...nonStale.map((f) => `${f.category}: ${f.message}`),
      ...cls.failedLocators.map((l: string) => `unparsed: ${l}`),
    ]
  } catch (e) {
    clsStatus = "FAIL"
    clsDetails = `classify failed: ${(e as Error).message}`
  }
  checks.push(check("classify", clsStatus, Date.now() - t4, clsDetails, clsFindings))

  return {
    vaultRoot: input.vaultRoot,
    checks,
    // `ok` means nothing is broken: no check FAILed. `allPassed` is the
    // stricter reading — every check actually ran and passed. Keeping them
    // apart is the point: a WARN or a NOT_EXECUTED stays visible instead of
    // being absorbed into a green verdict.
    ok: checks.every((c) => c.status !== "FAIL"),
    allPassed: checks.every((c) => c.status === "PASS"),
    totalMs: Date.now() - t0,
  }
}
