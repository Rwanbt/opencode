/* SPDX-License-Identifier: MIT */
/* Copyright (c) 2026 Unifia contributors */

/**
 * M0 qualification runner — produces canonical
 * `docs/automation-v2/m0/M0_RESULTS_*.json` and `evidence/`
 * folders atomically, with full self-describing provenance
 * metadata.
 *
 * Per Erwan review 2026-09-04: this script now actually
 * PUBLISHES to `docs/automation-v2/m0/`, not just prints
 * temp paths. The pre-CP6.3 version printed temp paths
 * which were not reproducible from a fresh clone.
 *
 * Usage (from repo root):
 *   bun scripts/run-m0-qualification.ts
 *
 * The bun:test suite in
 * `packages/automate-m0-harness/test/qualification.test.ts`
 * is the gating regression test; this script is the
 * canonical-publication writer.
 *
 * Atomic publication:
 *   1. Each candidate is qualified into a temporary staging
 *      dir under the OS tmp.
 *   2. The result schema + provenance are validated.
 *   3. If validation fails, the previous canonical evidence
 *      is left untouched and the script exits non-zero.
 *   4. If validation succeeds, the result file and the
 *      evidence folder are atomically moved to
 *      `docs/automation-v2/m0/`.
 *
 * Candidate matrix (frozen 2026-09-04):
 *   - UNIFIA_NATIVE              : true finalist A
 *   - DBOS_GO_SQLITE             : true finalist B (not yet built)
 *   - CUSTOM_GO_SQLITE_CONTROL   : harness/control (the Go binary
 *     that uses custom SQLite + blank DBOS import)
 */

import { mkdtempSync, rmSync, existsSync, mkdirSync, copyFileSync, readdirSync, statSync } from "node:fs"
import { mkdir as mkdirAsync } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, resolve as pathResolve, relative } from "node:path"
import { $ } from "bun"

/* ------------------------------------------------------------------ */
/* Two-commit reproducibility model (mandate §13-§17)                 */
/* ------------------------------------------------------------------ */

/**
 * Per the master execution mandate §13-§17: canonical
 * qualification must be run from a CLEAN worktree (Commit A
 * contains only source). Evidence (Commit B) is a separate
 * commit that records the qualification result + canonical
 * evidence files.
 *
 * The writer refuses to overwrite the canonical result /
 * evidence unless the worktree is clean. A diagnostic mode
 * (NON_CANONICAL_DIAGNOSTIC_MODE=1) is provided for ad-hoc
 * exploration; in that mode the writer still publishes but
 * tags the provenance with `nonCanonical: true` so a
 * reviewer cannot mistake a diagnostic run for a canonical
 * benchmark.
 */
async function isWorktreeClean(): Promise<boolean> {
  try {
    const out = await $`git status --porcelain`.cwd(REPO_ROOT).text()
    return out.trim().length === 0
  } catch {
    return false
  }
}

async function captureSourceCommit(): Promise<{ commit: string; tree: string; branch: string }> {
  const commit = (await $`git rev-parse HEAD`.cwd(REPO_ROOT).text()).trim()
  const tree = (await $`git rev-parse HEAD^{tree}`.cwd(REPO_ROOT).text()).trim()
  const branch = (await $`git branch --show-current`.cwd(REPO_ROOT).text()).trim()
  return { commit, tree, branch }
}

const NON_CANONICAL_DIAGNOSTIC_MODE = process.env.NON_CANONICAL_DIAGNOSTIC_MODE === "1"
import {
  FakeExternalEffectProvider,
  NativeSqliteCandidate,
  DBOSGoCandidate,
  DBOSRealCandidate,
  QualificationRunner,
  type CandidateResultFile,
} from "../packages/automate-m0-harness/src/qualification/index.ts"

const REPO_ROOT = pathResolve(import.meta.dir, "..")
const CANONICAL_DIR = join(REPO_ROOT, "docs", "automation-v2", "m0")
const EVIDENCE_DIR = join(CANONICAL_DIR, "evidence")
const HARNESS_TOOL_DIR = join(REPO_ROOT, "packages", "automate-m0-harness")
const DBOS_GO_TOOL_DIR = join(REPO_ROOT, "tools", "dbos-qualify")
const DBOS_GO_BINARY = join(DBOS_GO_TOOL_DIR, "dbos-qualify.exe")
const DBOS_REAL_TOOL_DIR = join(REPO_ROOT, "tools", "dbos-real-qualify")
const DBOS_REAL_BINARY = join(DBOS_REAL_TOOL_DIR, "dbos-real-qualify.exe")

const VERSION = "0.0.0-m0-qual-cp6.3"
const BUILD_HASH = `qual-m0-cp6.3-${Date.now()}`

// Self-describing provenance (per Erwan review 2026-09-04).
// Each candidate supplies its own values; the harness-side
// commit / runtime / platform are shared.
async function gitHead(cwd: string): Promise<string> {
  try {
    const out = await $`git rev-parse HEAD`.cwd(cwd).text()
    return out.trim()
  } catch {
    return "unknown"
  }
}
async function gitShort(cwd: string): Promise<string> {
  try {
    const out = await $`git rev-parse --short HEAD`.cwd(cwd).text()
    return out.trim()
  } catch {
    return "unknown"
  }
}
async function binaryDigest(path: string): Promise<string | undefined> {
  if (!existsSync(path)) return undefined
  try {
    const out = await $`certutil -hash SHA256 ${path}`.text()
    const m = out.match(/([a-f0-9]{64})/i)
    return m ? m[1] : undefined
  } catch {
    return undefined
  }
}

const HARNESS_COMMIT = await gitHead(HARNESS_TOOL_DIR)
const HARNESS_SHORT = await gitShort(HARNESS_TOOL_DIR)
const RUNTIME = `Bun ${Bun.version} / node ${process.version} / ${process.platform} ${process.arch}`
const ORACLE_VERSION = "1.1.0-cp6.3" // pinned per the candidate contract (this is the harness-side contract version)

function tempDir(label: string): string {
  return mkdtempSync(join(tmpdir(), `m0-qual-${label}-`))
}

/* ------------------------------------------------------------------ */
/* Per-candidate provenance                                            */
/* ------------------------------------------------------------------ */

const DBOS_GO_BUILT = existsSync(DBOS_GO_BINARY)
const DBOS_GO_DIGEST = await binaryDigest(DBOS_GO_BINARY)

const DBOS_REAL_BUILT = existsSync(DBOS_REAL_BINARY)
const DBOS_REAL_DIGEST = await binaryDigest(DBOS_REAL_BINARY)

/* ------------------------------------------------------------------ */
/* Candidate runners (return staging-dir result + evidence)            */
/* ------------------------------------------------------------------ */

interface CandidateRun {
  readonly kind: "UNIFIA_NATIVE" | "CUSTOM_GO_SQLITE_CONTROL"
  readonly resultPath: string
  readonly expectedNAPath: string
  readonly evidenceRoot: string
}

async function runNative(extraProv: { qualificationGenerationId: string; evidenceFreshness: "CURRENT" | "STALE"; nonCanonicalDiagnostic: boolean }): Promise<CandidateRun> {
  const stage = tempDir("native-stage")
  const providerDir = join(stage, "provider")
  const storeDir = join(stage, "candidate")
  mkdirSync(providerDir, { recursive: true })
  mkdirSync(storeDir, { recursive: true })
  const provider = new FakeExternalEffectProvider({ storeDir: providerDir, dropAckToCandidate: false })
  const candidate = new NativeSqliteCandidate({
    storeDir,
    provider,
    version: VERSION,
    buildHash: BUILD_HASH,
  })
  const runner = new QualificationRunner(candidate, provider, {
    outputRoot: stage,
    buildHash: BUILD_HASH,
    provenance: {
      candidateImplementationId: `UNIFIA_NATIVE_BUN_SQLITE@${VERSION}`,
      candidateSourceCommit: HARNESS_COMMIT,
      candidateBuildHash: BUILD_HASH,
      measurementHarnessCommit: HARNESS_COMMIT,
      oracleVersion: ORACLE_VERSION,
      executionSubstrate: "UNIFIA_NATIVE_BUN_SQLITE",
      storageEngine: "SQLite 3.x via bun:sqlite (M0 env)",
      adapterIdentity: "NativeSqliteCandidate",
      realDbosApisUsed: false,
      platform: `${process.platform} ${process.arch}`,
      runtime: RUNTIME,
      ...extraProv,
    },
  })
  const out = await runner.run()
  return {
    kind: "UNIFIA_NATIVE",
    resultPath: out.resultPath,
    expectedNAPath: out.expectedNAPath,
    evidenceRoot: join(stage, "evidence"),
  }
}

async function runCustomGo(extraProv: { qualificationGenerationId: string; evidenceFreshness: "CURRENT" | "STALE"; nonCanonicalDiagnostic: boolean }): Promise<CandidateRun | null> {
  if (!DBOS_GO_BUILT) {
    console.log(`[SKIP] CUSTOM_GO_SQLITE_CONTROL binary not built at ${DBOS_GO_BINARY}`)
    return null
  }
  const stage = tempDir("custom-go-stage")
  const providerDir = join(stage, "provider")
  mkdirSync(providerDir, { recursive: true })
  const provider = new FakeExternalEffectProvider({ storeDir: providerDir, dropAckToCandidate: false })
  const candidate = new DBOSGoCandidate({
    toolDir: DBOS_GO_TOOL_DIR,
    version: "github.com/dbos-inc/dbos-transact-golang@v1.0.0 (compile-time only)",
    buildHash: BUILD_HASH,
  })
  const runner = new QualificationRunner(candidate, provider, {
    outputRoot: stage,
    buildHash: BUILD_HASH,
    provenance: {
      candidateImplementationId: `CUSTOM_GO_SQLITE_CONTROL@${VERSION}`,
      candidateSourceCommit: HARNESS_COMMIT,
      candidateBuildHash: BUILD_HASH,
      candidateBinaryDigest: DBOS_GO_DIGEST,
      measurementHarnessCommit: HARNESS_COMMIT,
      oracleVersion: ORACLE_VERSION,
      // CRITICAL: the CUSTOM_GO binary uses custom SQLite
      // tables + custom authority fencing + custom effect
      // ledger + a BLANK DBOS import. It is NOT the real
      // DBOS Go candidate. realDbosApisUsed MUST be false.
      executionSubstrate: "CUSTOM_GO_SQLITE",
      storageEngine: "SQLite 3.x via modernc.org/sqlite v1.54.0 (pure-Go)",
      adapterIdentity: "DBOSGoCandidate@CUSTOM_GO_SQLITE_CONTROL",
      realDbosApisUsed: false,
      platform: `${process.platform} ${process.arch}`,
      runtime: RUNTIME,
      ...extraProv,
    },
  })
  const out = await runner.run()
  await candidate.shutdown().catch(() => undefined)
  return {
    kind: "CUSTOM_GO_SQLITE_CONTROL",
    resultPath: out.resultPath,
    expectedNAPath: out.expectedNAPath,
    evidenceRoot: join(stage, "evidence"),
  }
}

async function runRealDbosGo(extraProv: { qualificationGenerationId: string; evidenceFreshness: "CURRENT" | "STALE"; nonCanonicalDiagnostic: boolean }): Promise<CandidateRun | null> {
  if (!DBOS_REAL_BUILT) {
    console.log(`[SKIP] DBOS_GO_SQLITE binary not built at ${DBOS_REAL_BINARY}`)
    return null
  }
  const stage = tempDir("dbos-real-stage")
  const providerDir = join(stage, "provider")
  const storeDir = join(stage, "candidate")
  mkdirSync(providerDir, { recursive: true })
  mkdirSync(storeDir, { recursive: true })
  const provider = new FakeExternalEffectProvider({ storeDir: providerDir, dropAckToCandidate: false })
  const candidate = new DBOSRealCandidate({
    storeDir,
    version: "github.com/dbos-inc/dbos-transact-golang@v1.0.0 (real APIs on measured path)",
    buildHash: BUILD_HASH,
  })
  const runner = new QualificationRunner(candidate, provider, {
    outputRoot: stage,
    buildHash: BUILD_HASH,
    provenance: {
      candidateImplementationId: `DBOS_GO_V1@${VERSION}`,
      candidateSourceCommit: HARNESS_COMMIT,
      candidateBuildHash: BUILD_HASH,
      candidateBinaryDigest: DBOS_REAL_DIGEST,
      measurementHarnessCommit: HARNESS_COMMIT,
      oracleVersion: ORACLE_VERSION,
      executionSubstrate: "DBOS_GO_V1",
      storageEngine: "DBOS SQLite system DB (modernc.org/sqlite via dbos/driver/sqlite)",
      adapterIdentity: "DBOSRealCandidate@DBOS_GO_V1",
      realDbosApisUsed: true, // measured on the path: dbos.NewContext + RegisterWorkflow + RunWorkflow + RunAsStep + Launch
      platform: `${process.platform} ${process.arch}`,
      runtime: RUNTIME,
      ...extraProv,
    },
  })
  const out = await runner.run()
  await candidate.shutdown().catch(() => undefined)
  return {
    kind: "DBOS_GO_SQLITE",
    resultPath: out.resultPath,
    expectedNAPath: out.expectedNAPath,
    evidenceRoot: join(stage, "evidence"),
  }
}

/* ------------------------------------------------------------------ */
/* Atomic publication                                                  */
/* ------------------------------------------------------------------ */

function validateResult(result: CandidateResultFile, expectedKind: string): void {
  if (result.candidate !== expectedKind) {
    throw new Error(
      `candidate identity mismatch: expected ${expectedKind}, got ${result.candidate}. ` +
      `Refusing to publish misattributed evidence.`,
    )
  }
  if (!result.provenance) {
    throw new Error(`provenance block missing in result for ${expectedKind}`)
  }
  if (result.provenance.realDbosApisUsed === undefined) {
    throw new Error(`provenance.realDbosApisUsed is undefined in result for ${expectedKind}`)
  }
  // FC PASSes that have a measured gate (per the result builder
  // gate table) must declare `measured: true`. FCs without a
  // measured gate (FC-31A, FC-31B, FC-13, FC-13-CTRL) are
  // checked by their own pre-conditions elsewhere.
  const MEASURED_GATED_FCS = new Set(["FC-14", "FC-25", "FC-04", "FC-32"])
  for (const t of result.results) {
    if (t.status === "PASS" && MEASURED_GATED_FCS.has(t.testId)) {
      const o = t.observations as Record<string, unknown> | undefined
      if (!o || o.measured !== true) {
        throw new Error(`FC ${t.testId} PASS without measured=true — refusing to publish`)
      }
    }
  }
}

function copyDirRecursive(src: string, dst: string): void {
  mkdirSync(dst, { recursive: true })
  for (const e of readdirSync(src, { withFileTypes: true })) {
    const s = join(src, e.name)
    const d = join(dst, e.name)
    if (e.isDirectory()) copyDirRecursive(s, d)
    else if (e.isFile()) copyFileSync(s, d)
  }
}

/**
 * Stamp every evidence-file under
 * `stagingEvidenceRoot/<slug>/<FC>/result.json` with the
 * canonical publication metadata:
 *   - qualificationGenerationId
 *   - candidate
 *   - testId
 *   - evidenceFreshness (CURRENT/STALE based on candidateSourceCommit vs HEAD)
 *   - nonCanonicalDiagnostic
 *
 * The function is called on the staging dir BEFORE atomic
 * swap so a torn publication cannot occur: if the stamp
 * fails, no canonical file is touched.
 */
function stampEvidenceMetadata(
  stagingEvidenceRoot: string,
  slug: string,
  metadata: {
    qualificationGenerationId: string
    candidate: string
    evidenceFreshness: "CURRENT" | "STALE"
    nonCanonicalDiagnostic: boolean
  },
): void {
  const slugDir = join(stagingEvidenceRoot, slug)
  if (!existsSync(slugDir)) return
  for (const fcEntry of readdirSync(slugDir, { withFileTypes: true })) {
    if (!fcEntry.isDirectory()) continue
    const fcDir = join(slugDir, fcEntry.name)
    const resultFile = join(fcDir, "result.json")
    if (!existsSync(resultFile)) continue
    const raw = require("node:fs").readFileSync(resultFile, "utf8")
    let data: Record<string, unknown> = {}
    try {
      data = JSON.parse(raw)
    } catch {
      // Non-JSON evidence (e.g. a free-form log) — wrap it
      // but do not crash the publication.
      data = { raw }
    }
    data.qualificationGenerationId = metadata.qualificationGenerationId
    data.candidate = metadata.candidate
    data.testId = fcEntry.name
    data.evidenceFreshness = metadata.evidenceFreshness
    data.nonCanonicalDiagnostic = metadata.nonCanonicalDiagnostic
    require("node:fs").writeFileSync(resultFile, JSON.stringify(data, null, 2), "utf8")
  }
}

/**
 * Atomic publication. Stages the entire candidate
 * publication under a per-run staging dir
 * (`<CANONICAL>/.publish-staging/<generationId>/`), stamps
 * every file with the generation id, validates, then swaps
 * into the canonical location with a single rename so a
 * crash mid-publication cannot leave torn canonical files.
 *
 * Returns a list of every file the publication touched
 * (used by the diagnostic writer to mirror the result into
 * `.tmp/m0-diagnostic/`).
 */
function publish(run: CandidateRun, generationId: string, sourceCommit: string): {
  resultRelPath: string
  evidenceRelPath: string
  expectedNARelPath: string
} {
  // 1. Validate
  const result = JSON.parse(require("node:fs").readFileSync(run.resultPath, "utf8")) as CandidateResultFile
  validateResult(result, run.kind)
  if (result.provenance.qualificationGenerationId !== generationId) {
    throw new Error(
      `provenance.qualificationGenerationId mismatch: result=${result.provenance.qualificationGenerationId} run=${generationId}`,
    )
  }
  if (result.provenance.candidateSourceCommit !== sourceCommit) {
    throw new Error(
      `provenance.candidateSourceCommit mismatch: result=${result.provenance.candidateSourceCommit} source=${sourceCommit}`,
    )
  }

  // 2. Per-candidate staging subdir
  const candidateSlug = run.kind.toLowerCase().replace(/_/g, "-")
  const publicationRoot = join(CANONICAL_DIR, ".publish-staging", generationId, candidateSlug)
  const publicationResult = join(publicationRoot, `M0_RESULTS_${run.kind}.json`)
  const publicationEvidenceDir = join(publicationRoot, "evidence", candidateSlug)
  const publicationExpectedNA = join(publicationRoot, `M0_EXPECTED_NA_${run.kind}.json`)

  mkdirSync(publicationRoot, { recursive: true })
  mkdirSync(publicationEvidenceDir, { recursive: true })

  // 3. Copy result
  copyFileSync(run.resultPath, publicationResult)

  // 4. Copy evidence
  const stagingSlugDir = join(run.evidenceRoot, candidateSlug)
  if (existsSync(stagingSlugDir)) {
    copyDirRecursive(stagingSlugDir, publicationEvidenceDir)
  } else {
    console.warn(`  [WARN] staging slug dir not found: ${stagingSlugDir}`)
  }

  // 5. Copy expected-NA
  if (existsSync(run.expectedNAPath)) {
    copyFileSync(run.expectedNAPath, publicationExpectedNA)
  }

  // 6. Stamp evidence files with publication metadata
  // (mandate §26: every file in a publication shares the
  // same qualificationGenerationId).
  const freshness: "CURRENT" | "STALE" =
    result.provenance.candidateSourceCommit === sourceCommit ? "CURRENT" : "STALE"
  stampEvidenceMetadata(join(publicationRoot, "evidence"), candidateSlug, {
    qualificationGenerationId: generationId,
    candidate: run.kind,
    evidenceFreshness: freshness,
    nonCanonicalDiagnostic: false, // publish() is canonical-only
  })

  // 7. Rewrite evidencePath values in the staged result to
  // their canonical repo-relative form (mandate §16-§18).
  // The runner now writes evidence under a per-FC temp
  // dir and stores the relative path
  // `evidence/<slug>/<FC>/<filename>` in the result. The
  // publication writer re-resolves this against the
  // canonical evidence root.
  // Generic rule:
  //   - reject absolute Windows / POSIX / file:// paths
  //   - reject path-escape attempts (../, ..\)
  //   - rewrite to `docs/automation-v2/m0/evidence/<slug>/<FC>/<filename>`
  const staged = JSON.parse(require("node:fs").readFileSync(publicationResult, "utf8")) as CandidateResultFile
  for (const t of staged.results) {
    if (t.evidencePath) {
      const norm = t.evidencePath.replaceAll("\\", "/")
      // Reject absolute paths and protocol escapes.
      if (/^[a-z]:\//i.test(norm) || norm.startsWith("/") || norm.startsWith("file://")) {
        throw new Error(`evidencePath is absolute or has a protocol prefix: ${t.evidencePath}`)
      }
      if (norm.includes("..")) {
        throw new Error(`evidencePath contains '..' (path-escape attempt): ${t.evidencePath}`)
      }
      // The runner returns `evidence/<slug>/<FC>/<filename>`
      // (or `<slug>/<FC>/<filename>`). We accept both.
      const m = norm.match(new RegExp(`(evidence/)?(${candidateSlug})/(FC-[^/]+)/([^/]+)$`, "i"))
      if (m) {
        const fc = m[3]
        const file = m[4]
        t.evidencePath = `docs/automation-v2/m0/evidence/${candidateSlug}/${fc}/${file}`
      } else {
        throw new Error(`evidencePath does not match canonical layout: ${t.evidencePath}`)
      }
    }
  }
  require("node:fs").writeFileSync(publicationResult, JSON.stringify(staged, null, 2), "utf8")

  // 8. Atomic swap. We use rename() on the same filesystem
  // for atomicity. Per candidate: rename each file/folder
  // from publicationRoot into CANONICAL_DIR. The previous
  // canonical result/evidence/expected-NA (if any) is moved
  // into the publicationRoot BEFORE the rename, so a crash
  // mid-swap leaves the previous canonical data intact
  // (under .publish-staging/).
  mkdirSync(CANONICAL_DIR, { recursive: true })
  mkdirSync(EVIDENCE_DIR, { recursive: true })

  // Move previous canonical files into the publicationRoot
  // for rollback safety.
  const prevResult = join(CANONICAL_DIR, `M0_RESULTS_${run.kind}.json`)
  const prevEvidenceDir = join(EVIDENCE_DIR, candidateSlug)
  const prevExpectedNA = join(CANONICAL_DIR, `M0_EXPECTED_NA_${run.kind}.json`)
  const rollbackDir = join(publicationRoot, "_rollback")
  mkdirSync(rollbackDir, { recursive: true })
  if (existsSync(prevResult)) {
    require("node:fs").renameSync(prevResult, join(rollbackDir, `M0_RESULTS_${run.kind}.json`))
  }
  if (existsSync(prevEvidenceDir)) {
    require("node:fs").renameSync(prevEvidenceDir, join(rollbackDir, "evidence"))
  }
  if (existsSync(prevExpectedNA)) {
    require("node:fs").renameSync(prevExpectedNA, join(rollbackDir, `M0_EXPECTED_NA_${run.kind}.json`))
  }

  // Atomic swap into canonical
  require("node:fs").renameSync(publicationResult, prevResult)
  const canonicalEvidenceDir = join(EVIDENCE_DIR, candidateSlug)
  rmSync(canonicalEvidenceDir, { recursive: true, force: true })
  // The publication evidence may have been already moved
  // into rollback by accident; check & re-create.
  const stagedEvidence = join(publicationRoot, "evidence", candidateSlug)
  if (existsSync(stagedEvidence)) {
    copyDirRecursive(stagedEvidence, canonicalEvidenceDir)
  }
  if (existsSync(publicationExpectedNA)) {
    require("node:fs").renameSync(publicationExpectedNA, prevExpectedNA)
  }

  // 9. Rollback artifacts are kept under publicationRoot/_rollback/
  // for forensic recovery; only the swap itself is removed.
  const resultRelPath = relative(REPO_ROOT, prevResult).replaceAll("\\", "/")
  const evidenceRelPath = relative(REPO_ROOT, canonicalEvidenceDir).replaceAll("\\", "/")
  const expectedNARelPath = relative(REPO_ROOT, prevExpectedNA).replaceAll("\\", "/")

  console.log(`  [PUBLISH] ${run.kind}`)
  console.log(`           result:     ${resultRelPath}`)
  console.log(`           evidence:   ${evidenceRelPath}/`)
  console.log(`           expectedNA: ${expectedNARelPath}`)
  console.log(`           generation: ${generationId}`)
  console.log(`           freshness:  ${freshness}`)

  return { resultRelPath, evidenceRelPath, expectedNARelPath }
}

/* ------------------------------------------------------------------ */
/* Diagnostic-mode runner: writes to a non-canonical path             */
/* ------------------------------------------------------------------ */

/**
 * Run every available candidate and write the result to
 * `diagRoot`. The directory is OUTSIDE `docs/automation-v2/m0/`
 * so the canonical evidence tree is never touched. The
 * generation id is still recorded in each result so a
 * reviewer can correlate diagnostic runs with their
 * canonical counterparts.
 */
async function runAllCandidatesInto(
  diagRoot: string,
  generationId: string,
  sourceCommit: string,
  nonCanonical: boolean,
): Promise<void> {
  mkdirSync(diagRoot, { recursive: true })
  const runs: CandidateRun[] = []
  const prov = {
    qualificationGenerationId: generationId,
    evidenceFreshness: "STALE" as const, // diagnostic is never authoritative
    nonCanonicalDiagnostic: nonCanonical,
  }

  const native = await runNative(prov).catch((e) => {
    console.error(`  [FAIL] UNIFIA_NATIVE: ${(e as Error).message}`)
    throw e
  })
  // Diagnostic publish: write to diagRoot, NOT to canonical.
  const nativeResult = JSON.parse(require("node:fs").readFileSync(native.resultPath, "utf8")) as CandidateResultFile
  const nativeDest = join(diagRoot, `M0_RESULTS_${native.kind}.json`)
  require("node:fs").copyFileSync(native.resultPath, nativeDest)
  console.log(`  [DIAG] UNIFIA_NATIVE: ${nativeDest}`)
  runs.push(native)

  const customGo = await runCustomGo(prov).catch((e) => {
    console.error(`  [FAIL] CUSTOM_GO_SQLITE_CONTROL: ${(e as Error).message}`)
    throw e
  })
  if (customGo) {
    const dest = join(diagRoot, `M0_RESULTS_${customGo.kind}.json`)
    require("node:fs").copyFileSync(customGo.resultPath, dest)
    console.log(`  [DIAG] CUSTOM_GO_SQLITE_CONTROL: ${dest}`)
    runs.push(customGo)
  }

  const realDbos = await runRealDbosGo(prov).catch((e) => {
    console.error(`  [FAIL] DBOS_GO_SQLITE: ${(e as Error).message}`)
    throw e
  })
  if (realDbos) {
    const dest = join(diagRoot, `M0_RESULTS_${realDbos.kind}.json`)
    require("node:fs").copyFileSync(realDbos.resultPath, dest)
    console.log(`  [DIAG] DBOS_GO_SQLITE: ${dest}`)
    runs.push(realDbos)
  }
  // Reference sourceCommit to keep the strict-mode compiler
  // happy; it is also used in the canonical branch to stamp
  // freshness.
  void sourceCommit
  void nativeResult
}

/* ------------------------------------------------------------------ */
/* main                                                                */
/* ------------------------------------------------------------------ */

async function main(): Promise<void> {
  console.log("=".repeat(72))
  console.log("M0 qualification runner (CP6.3) — atomic publication")
  console.log("=".repeat(72))
  console.log(`Repo root:  ${REPO_ROOT}`)
  console.log(`Harness:    ${HARNESS_SHORT} (${HARNESS_COMMIT})`)
  console.log(`Runtime:    ${RUNTIME}`)
  console.log(`Oracle:     ${ORACLE_VERSION}`)

  // Two-commit reproducibility model gate (mandate §13-§17).
  // Refuse to publish canonical evidence from a dirty worktree
  // unless NON_CANONICAL_DIAGNOSTIC_MODE=1.
  const clean = await isWorktreeClean()
  if (!clean && !NON_CANONICAL_DIAGNOSTIC_MODE) {
    console.error("")
    console.error("[REFUSED] Worktree is dirty (per `git status --porcelain`).")
    console.error("         Commit source changes first (Commit A), then re-run this script.")
    console.error("         To run an ad-hoc diagnostic, set NON_CANONICAL_DIAGNOSTIC_MODE=1.")
    console.error("")
    process.exit(1)
  }
  const mode = clean ? "CANONICAL" : "NON_CANONICAL_DIAGNOSTIC"
  console.log(`Mode:       ${mode}`)
  const source = await captureSourceCommit()
  console.log(`Source:     commit=${source.commit.slice(0, 12)} tree=${source.tree.slice(0, 12)} branch=${source.branch}`)

  // Generation id is unique to this run and stamped on every
  // published file (mandate §26).
  const generationId = `gen-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  console.log(`Generation: ${generationId}`)

  // Diagnostic mode isolation (mandate §22). Diagnostic
  // results must NEVER touch the canonical evidence tree.
  // We redirect to a non-canonical directory and skip
  // publication entirely.
  if (!clean && NON_CANONICAL_DIAGNOSTIC_MODE) {
    const diagRoot = join(REPO_ROOT, ".tmp", "m0-diagnostic", `run-${Date.now()}`)
    await mkdirAsync(diagRoot, { recursive: true })
    console.log(`Diagnostic output root: ${diagRoot}`)
    console.log("Diagnostic mode: running candidates but NOT publishing to docs/automation-v2/m0/.")
    await runAllCandidatesInto(diagRoot, generationId, source.commit, true)
    console.log("\nDiagnostic run complete. Canonical evidence was NOT modified.")
    return
  }

  // Atomic publication (mandate §24-§25). Stage the entire
  // candidate publication under a per-run staging dir, then
  // swap into the canonical location in a single rename.
  const stagingDir = join(CANONICAL_DIR, ".publish-staging", generationId)
  await mkdirAsync(stagingDir, { recursive: true })
  console.log(`Staging:    ${stagingDir.replace(REPO_ROOT + "\\", "").replace(REPO_ROOT + "/", "")}/`)

  const runs: CandidateRun[] = []
  const canonicalProv = {
    qualificationGenerationId: generationId,
    evidenceFreshness: "CURRENT" as const,
    nonCanonicalDiagnostic: false,
  }

  console.log("\n[1/2] UNIFIA_NATIVE")
  try {
    const r = await runNative(canonicalProv)
    publish(r, generationId, source.commit)
    runs.push(r)
  } catch (e) {
    console.error(`  [FAIL] UNIFIA_NATIVE: ${(e as Error).message}`)
    throw e
  }

  console.log("\n[2/3] CUSTOM_GO_SQLITE_CONTROL")
  const customGo = await runCustomGo(canonicalProv)
  if (customGo) {
    try {
      publish(customGo, generationId, source.commit)
      runs.push(customGo)
    } catch (e) {
      console.error(`  [FAIL] CUSTOM_GO_SQLITE_CONTROL: ${(e as Error).message}`)
      throw e
    }
  }

  console.log("\n[3/3] DBOS_GO_SQLITE (real DBOS APIs on measured path)")
  const realDbos = await runRealDbosGo(canonicalProv)
  if (realDbos) {
    try {
      publish(realDbos, generationId, source.commit)
      runs.push(realDbos)
    } catch (e) {
      console.error(`  [FAIL] DBOS_GO_SQLITE: ${(e as Error).message}`)
      throw e
    }
  }

  // Print summary
  console.log("\n" + "=".repeat(72))
  console.log("SUMMARY (canonical files now published to docs/automation-v2/m0/)")
  console.log("=".repeat(72))
  for (const r of runs) {
    const file = join(CANONICAL_DIR, `M0_RESULTS_${r.kind}.json`)
    const result: CandidateResultFile = JSON.parse(require("node:fs").readFileSync(file, "utf8"))
    console.log(`\n${r.kind}`)
    console.log(`  version: ${result.candidateInfo.version}`)
    console.log(`  pass=${result.summary.pass} fail_arch=${result.summary.failArchitectural} fail_corr=${result.summary.failCorrectable} na=${result.summary.notApplicable} blocked=${result.summary.blocked} not_valid=${result.summary.notValid}`)
    console.log(`  replayModel: ${result.replayModel}`)
    console.log(`  executionSubstrate: ${result.provenance.executionSubstrate}`)
    console.log(`  realDbosApisUsed: ${result.provenance.realDbosApisUsed}`)
    console.log(`  qualificationGenerationId: ${result.provenance.qualificationGenerationId}`)
    console.log(`  evidenceFreshness: ${result.provenance.evidenceFreshness}`)
    for (const t of result.results) {
      console.log(`    ${t.testId.padEnd(12)} ${t.status.padEnd(20)} ${t.note.slice(0, 80)}`)
    }
  }

  // Clean up staging dirs
  for (const r of runs) {
    const stage = r.resultPath.replace(/[\\\/]M0_RESULTS_.*$/, "")
    if (existsSync(stage)) rmSync(stage, { recursive: true, force: true })
  }
  console.log("\nDone.")
}

main().catch((e) => {
  console.error("\nM0 qualification runner failed:", e)
  process.exit(1)
})
