/* SPDX-License-Identifier: MIT */
/* Copyright (c) 2026 Unifia contributors */

/**
 * M0 qualification result writer (substrate-neutral).
 *
 * Per pack gelé §20, the harness writes:
 *   - M0_RESULTS_<CANDIDATE>.json
 *   - M0_EXPECTED_NA_<CANDIDATE>.json
 *   - evidence/<candidate>/<FC>/...
 *
 * The two candidates use exactly the same schema. No candidate-specific
 * fields may leak into the result.
 */

import { writeFile, mkdir } from "node:fs/promises"
import { dirname, join } from "node:path"
import type {
  CandidateResultFile,
  ExpectedNAFile,
  FunctionalCriterionId,
  FunctionalCriterionResult,
  QualificationStatus,
  CandidateInfo,
  ResultProvenance,
} from "./contract.ts"
import type { AuthorityKind } from "@unifia/automate-m0-contract"

/* ------------------------------------------------------------------ */
/* Builder                                                            */
/* ------------------------------------------------------------------ */

export class CandidateResultBuilder {
  private readonly results: FunctionalCriterionResult[] = []
  private readonly seen = new Set<FunctionalCriterionId>()
  private readonly candidateInfo: CandidateInfo
  private readonly commit: string
  private readonly provenance: ResultProvenance
  private replayModel: CandidateResultFile["replayModel"] = "NOT_MEASURED"

  constructor(
    candidateInfo: CandidateInfo,
    commit: string,
    provenance?: Partial<ResultProvenance>,
  ) {
    this.candidateInfo = candidateInfo
    this.commit = commit
    // Default provenance for a CUSTOM_GO_SQLITE_CONTROL or
    // UNIFIA_NATIVE candidate. Callers (run-m0-qualification.ts
    // and the harness entry points) MUST supply the real
    // values for each candidate.
    this.provenance = {
      candidateImplementationId: provenance?.candidateImplementationId ?? `${candidateInfo.kind}@${candidateInfo.version}`,
      candidateSourceCommit: provenance?.candidateSourceCommit ?? commit,
      candidateBuildHash: provenance?.candidateBuildHash ?? candidateInfo.buildHash,
      candidateBinaryDigest: provenance?.candidateBinaryDigest,
      measurementHarnessCommit: provenance?.measurementHarnessCommit ?? commit,
      oracleVersion: provenance?.oracleVersion ?? "1",
      executionSubstrate: provenance?.executionSubstrate ?? candidateInfo.kind,
      storageEngine: provenance?.storageEngine ?? candidateInfo.storage.engine,
      adapterIdentity: provenance?.adapterIdentity ?? candidateInfo.kind,
      realDbosApisUsed: provenance?.realDbosApisUsed ?? false,
      platform: provenance?.platform ?? process.platform,
      runtime: provenance?.runtime ?? `node ${process.version}`,
      qualificationGenerationId: provenance?.qualificationGenerationId ?? "unset",
      evidenceFreshness: provenance?.evidenceFreshness ?? "CURRENT",
      nonCanonicalDiagnostic: provenance?.nonCanonicalDiagnostic ?? false,
    }
  }

  record(input: {
    testId: FunctionalCriterionId
    status: QualificationStatus
    evidencePath: string
    note: string
    observations?: { readonly [k: string]: unknown }
  }): void {
    // Per pack gelé review 2026-09-03 v1.1 §22 + §37 of the
    // final M0 closure (2026-09-04): PASS requires measured=true
    // for any FC that has a `measured` field in the observation,
    // and the FC-specific gate below must hold. The harness
    // enforces these invariants at the result builder so a PASS
    // cannot be silently recorded for a property that was not
    // actually exercised or that did not satisfy the FC's
    // mandatory post-conditions.
    if (input.status === "PASS") {
      const o = input.observations ?? {}
      if ("measured" in o && o.measured === false) {
        throw new Error(
          `ResultBuilder invariant violated: status=PASS but measured=false for ${input.testId}. ` +
          `A PASS is not admissible when the FC was not actually exercised. Reclassify as NOT_VALID, BLOCKED, or FAIL_CORRECTABLE.`,
        )
      }
      assertFCPassGate(input.testId, o)
    }
    // Per-FC dedup: a single FC must not appear twice in the result
    // file, even if the runner tried twice. First-PASS wins; an
    // earlier FAIL_CORRECTABLE is NOT overwritten by a later
    // exception (failures are evidence and must remain visible).
    if (this.seen.has(input.testId)) {
      const existing = this.results.find((r) => r.testId === input.testId)
      if (existing && existing.status === "PASS" && input.status !== "PASS") {
        // Don't downgrade a PASS with a later exception
        return
      }
      if (existing && existing.status !== "PASS" && input.status === "PASS") {
        // Don't upgrade a FAIL with a later PASS
        return
      }
    }
    this.seen.add(input.testId)
    this.results.push({
      testId: input.testId,
      candidate: this.candidateInfo.kind,
      status: input.status,
      evidencePath: input.evidencePath,
      commit: this.commit,
      note: input.note,
      observations: input.observations ?? {},
    })
  }

  setReplayModel(model: CandidateResultFile["replayModel"]): void {
    this.replayModel = model
  }

  async write(filePath: string): Promise<CandidateResultFile> {
    const summary = this.summarize()
    const out: CandidateResultFile = {
      schemaVersion: 1,
      candidate: this.candidateInfo.kind,
      candidateInfo: this.candidateInfo,
      results: this.results,
      summary,
      replayModel: this.replayModel,
      producedAt: new Date().toISOString(),
      provenance: this.provenance,
    }
    await mkdir(dirname(filePath), { recursive: true })
    await writeFile(filePath, JSON.stringify(out, null, 2), "utf8")
    return out
  }

  private summarize(): CandidateResultFile["summary"] {
    const summary = {
      pass: 0,
      failArchitectural: 0,
      failCorrectable: 0,
      notApplicable: 0,
      blocked: 0,
      notValid: 0,
    }
    for (const r of this.results) {
      switch (r.status) {
        case "PASS": summary.pass++; break
        case "FAIL_ARCHITECTURAL": summary.failArchitectural++; break
        case "FAIL_CORRECTABLE": summary.failCorrectable++; break
        case "NOT_APPLICABLE": summary.notApplicable++; break
        case "BLOCKED": summary.blocked++; break
        case "NOT_VALID": summary.notValid++; break
      }
    }
    return summary
  }
}

/* ------------------------------------------------------------------ */
/* Expected-NA builder — ONLY for NOT_APPLICABLE                      */
/* ------------------------------------------------------------------ */

/**
 * ExpectedNABuilder declares tests that the harness is NOT going to
 * run, with documented architectural reasons (NOT_APPLICABLE).
 *
 * This file must NEVER contain BLOCKED. A BLOCKED entry is a
 * measurement outcome, not a pre-declared expectation. Per pack
 * gelé review (correction pack 2026-09-03, v1.1 §3) :
 *   - NOT_APPLICABLE : test does not apply to this candidate
 *   - BLOCKED        : a test ran but its methodology is unavailable
 *                       (appears in M0_RESULTS_*.json, not here)
 *   - NOT_VALID      : a test ran and its methodology failed to measure
 *                       (appears in M0_RESULTS_*.json, not here)
 *
 * If no FC is genuinely N/A, the resulting file is `{ entries: [] }`.
 */
export class ExpectedNABuilder {
  private readonly entries: { testId: FunctionalCriterionId; reason: string }[] = []
  private readonly candidate: AuthorityKind
  private readonly qualificationGenerationId: string
  private readonly nonCanonicalDiagnostic: boolean

  constructor(
    candidate: AuthorityKind,
    opts: { qualificationGenerationId: string; nonCanonicalDiagnostic: boolean } = {
      qualificationGenerationId: "unset",
      nonCanonicalDiagnostic: false,
    },
  ) {
    this.candidate = candidate
    this.qualificationGenerationId = opts.qualificationGenerationId
    this.nonCanonicalDiagnostic = opts.nonCanonicalDiagnostic
  }

  declare(testId: FunctionalCriterionId, reason: string): void {
    this.entries.push({ testId, reason })
  }

  async write(filePath: string): Promise<ExpectedNAFile> {
    const out: ExpectedNAFile = {
      schemaVersion: 1,
      candidate: this.candidate,
      entries: this.entries,
      qualificationGenerationId: this.qualificationGenerationId,
      nonCanonicalDiagnostic: this.nonCanonicalDiagnostic,
    }
    await mkdir(dirname(filePath), { recursive: true })
    await writeFile(filePath, JSON.stringify(out, null, 2), "utf8")
    return out
  }
}

/* ------------------------------------------------------------------ */
/* BlockedReason — explicit categorical classification                  */
/* ------------------------------------------------------------------ */

/**
 * Categorizes a `BLOCKED` outcome so the result file is precise
 * about *why* the test was blocked (vs. just `notApplicable`).
 *
 * Used internally by the runner when it knows a methodology is
 * unavailable. The result file still records `status: "BLOCKED"`,
 * but the reason appears in `note` for the human reader.
 */
export type BlockedReasonKind =
  | "NO_METHODOLOGY"          // no fault-injection / VM / harness available
  | "MISSING_TOOLCHAIN"       // candidate's required toolchain absent
  | "MISSING_FIXTURE"         // shared fixture (e.g. test vector) absent
  | "MISSING_PLATFORM_FEATURE" // required platform feature absent
  | "OUT_OF_M0_SCOPE"          // not in P0/P1 set; deferred to LATER

export function blockedNote(kind: BlockedReasonKind, detail: string): string {
  return `BLOCKED (${kind}): ${detail}`
}

/* ------------------------------------------------------------------ */
/* FC PASS gates (per pack gelé §37 of final M0 closure 2026-09-04)   */
/* ------------------------------------------------------------------ */

type Obs = { readonly [k: string]: unknown }

/**
 * Mandatory post-conditions for a PASS on each FC that has a
 * defined gate. The builder refuses PASS if any required
 * condition is missing or false.
 *
 * FC-14 PASS requires:
 *   concurrentRace=true
 *   distinctOsProcesses>=2
 *   winnerMutateAccepted=true
 *   loserMutateRejected=true
 *   winnerDispatchAccepted=true
 *   loserDispatchRejected=true
 *
 * FC-25 PASS requires:
 *   oldOwnerDidNotReleaseBeforeTakeover=true
 *   newGenerationGreaterThanOld=true
 *   newOwnerCommitAccepted=true
 *   staleOwnerCommitRejected=true
 *   staleOwnerDispatchRejected=true
 *
 * FC-04 PASS requires (real transport-level ACK loss):
 *   realExternalProvider=true
 *   providerCommitted=true
 *   transportAckLost=true
 *   recoveryExecuted=true
 *   blindRetryCount=0
 *
 * FC-32 PASS requires:
 *   measured=true
 *   controlledNondeterminism=true
 *   crashRecovery=true
 */
export function assertFCPassGate(testId: FunctionalCriterionId, o: Obs): void {
  switch (testId) {
    case "FC-14": {
      const missing: string[] = []
      if (o.concurrentRace !== true) missing.push("concurrentRace=true")
      if (typeof o.distinctOsProcesses !== "number" || (o.distinctOsProcesses as number) < 2) missing.push("distinctOsProcesses>=2")
      if (o.winnerMutateAccepted !== true) missing.push("winnerMutateAccepted=true")
      if (o.loserMutateRejected !== true) missing.push("loserMutateRejected=true")
      if (o.winnerDispatchAccepted !== true) missing.push("winnerDispatchAccepted=true")
      if (o.loserDispatchRejected !== true) missing.push("loserDispatchRejected=true")
      if (missing.length) {
        throw new Error(`FC-14 PASS gate violated: missing ${missing.join(", ")}`)
      }
      return
    }
    case "FC-25": {
      const missing: string[] = []
      if (o.oldOwnerDidNotReleaseBeforeTakeover !== true) missing.push("oldOwnerDidNotReleaseBeforeTakeover=true")
      if (o.newGenerationGreaterThanOld !== true) missing.push("newGenerationGreaterThanOld=true")
      if (o.newOwnerCommitAccepted !== true) missing.push("newOwnerCommitAccepted=true")
      if (o.staleOwnerCommitRejected !== true) missing.push("staleOwnerCommitRejected=true")
      if (o.staleOwnerDispatchRejected !== true) missing.push("staleOwnerDispatchRejected=true")
      if (missing.length) {
        throw new Error(`FC-25 PASS gate violated: missing ${missing.join(", ")}`)
      }
      return
    }
    case "FC-04": {
      const missing: string[] = []
      if (o.realExternalProvider !== true) missing.push("realExternalProvider=true")
      if (o.providerCommitted !== true) missing.push("providerCommitted=true")
      if (o.transportAckLost !== true) missing.push("transportAckLost=true")
      if (o.recoveryExecuted !== true) missing.push("recoveryExecuted=true")
      if (o.blindRetryCount !== 0) missing.push("blindRetryCount=0")
      if (missing.length) {
        throw new Error(`FC-04 PASS gate violated: missing ${missing.join(", ")}`)
      }
      return
    }
    case "FC-32": {
      const missing: string[] = []
      if (o.measured !== true) missing.push("measured=true")
      if (o.controlledNondeterminism !== true) missing.push("controlledNondeterminism=true")
      if (o.crashRecovery !== true) missing.push("crashRecovery=true")
      if (missing.length) {
        throw new Error(`FC-32 PASS gate violated: missing ${missing.join(", ")}`)
      }
      return
    }
    default:
      return
  }
}

/* ------------------------------------------------------------------ */
/* Path helpers (substrate-neutral)                                   */
/* ------------------------------------------------------------------ */

export function evidencePath(root: string, candidate: AuthorityKind, fc: FunctionalCriterionId): string {
  return join(root, "evidence", candidate.toLowerCase().replace(/_/g, "-"), fc)
}

export function resultsPath(root: string, candidate: AuthorityKind): string {
  return join(root, `M0_RESULTS_${candidate}.json`)
}

export function expectedNAPath(root: string, candidate: AuthorityKind): string {
  return join(root, `M0_EXPECTED_NA_${candidate}.json`)
}
