/* SPDX-License-Identifier: MIT */
/* Copyright (c) 2026 Unifia contributors */

/**
 * M0 common oracle runner (substrate-neutral).
 *
 * Drives the qualification adapter through the P0 tests (per pack
 * gelé §23) and writes:
 *   - evidence/<candidate>/<FC>/...
 *   - M0_RESULTS_<CANDIDATE>.json (via the result builder)
 *
 * No candidate-specific logic may live here. If a test needs
 * candidate-specific behavior, the oracle must express it through
 * the contract, and the contract must remain substrate-neutral.
 */

import { writeFile, mkdir, rm } from "node:fs/promises"
import { join, resolve as pathResolve } from "node:path"
import { writeEvidence as writeEvidenceShared } from "./evidence-writer.ts"
import {
  fromHostFloat64,
  fromHostInteger,
  canonicalEquals,
  CanonicalValueError,
  type UnifiaValue,
  type WorkflowRunId,
  type WorkflowVersionId,
  type LogicalInvocationId,
  type AttemptId,
  type ApprovalId,
  type DurableTimerId,
  type EffectId,
  type AuthorityGeneration,
  M0_UNIFIAVALUE_VECTOR_V1,
} from "@unifia/automate-m0-contract"
import type {
  DurableWorkflowAuthorityQualificationAdapter,
  CandidateInfo,
  FunctionalCriterionId,
  FunctionalCriterionResult,
  QualificationStatus,
  StartRunInput,
  ProviderResolution,
  AuthorityToken,
  RaceAuthoritiesInput,
  ZombieFC25Result,
  HostAdapterFixture,  HostAdapterVerdict,} from "./contract.ts"
import { CandidateResultBuilder, ExpectedNABuilder, evidencePath, resultsPath, expectedNAPath, blockedNote } from "./result.ts"
import { classifyQualificationError } from "./errors.ts"
import { FC_31A_VALUES, FC_31B_VECTORS, bitsToFloat64 } from "./vectors/fc31-fixtures.ts"
import { FakeExternalEffectProvider } from "./providers/fake-external.ts"

/* ------------------------------------------------------------------ */
/* Public entry point                                                  */
/* ------------------------------------------------------------------ */

export interface RunnerOptions {
  /** Output root for evidence + result files. */
  readonly outputRoot: string
  /** Build hash to stamp on each result. */
  readonly buildHash: string
  /**
   * Provenance fields to embed in the canonical result file
   * (per Erwan review 2026-09-04: every canonical M0 result
   * MUST carry self-describing provenance metadata). The
   * runner forwards this to the result builder; the builder
   * defaults the missing fields to safe values.
   */
  readonly provenance?: Partial<{
    readonly candidateImplementationId: string
    readonly candidateSourceCommit: string
    readonly candidateBuildHash: string
    readonly candidateBinaryDigest: string
    readonly measurementHarnessCommit: string
    readonly oracleVersion: string
    readonly executionSubstrate: string
    readonly storageEngine: string
    readonly adapterIdentity: string
    readonly realDbosApisUsed: boolean
    readonly platform: string
    readonly runtime: string
    readonly qualificationGenerationId: string
    readonly evidenceFreshness: "CURRENT" | "STALE"
    readonly nonCanonicalDiagnostic: boolean
  }>
  /**
   * Tests to execute. If undefined, the default P0 set is used:
   *   FC-31A, FC-31B, FC-04, FC-14, FC-25, FC-32.
   * FC-13-CTRL / FC-13 are explicitly NOT in the default set because
   * they require power-loss methodology the harness cannot guarantee
   * in this environment (see EXPECTED_NA file).
   */
  readonly testsToRun?: readonly FunctionalCriterionId[]
}

/* ------------------------------------------------------------------ */
/* Helper: per-FC evidence folder                                       */
/* ------------------------------------------------------------------ */

const REPO_ROOT_FOR_PATHS = pathResolve(import.meta.dir, "..", "..", "..")

/**
 * Write evidence to a per-FC folder and return a
 * REPO-RELATIVE path (mandate §16-§18).
 *
 * The runner stores evidence under a per-run `outputRoot`
 * (often a temp dir for test isolation). The publication
 * writer re-resolves the relative path against the
 * canonical evidence root, so the value stored in the
 * canonical M0 result is always `<slug>/<FC>/<filename>`
 * (no absolute Windows / POSIX / file:// path).
 *
 * The function derives the relative path from the
 * `evidenceRoot` segment of the absolute folder. The
 * runner passes the candidate slug via the call sites
 * (which already pass `outputRoot/evidence/slug/FC`).
 */
async function writeEvidence(
  fcFolder: string,
  filename: string,
  data: unknown,
): Promise<string> {
  await mkdir(fcFolder, { recursive: true })
  const abs = join(fcFolder, filename)
  await writeFile(abs, typeof data === "string" ? data : JSON.stringify(data, null, 2), "utf8")
  // The publication writer expects `evidence/<slug>/<FC>/<filename>`
  // (repo-relative). We compute the relative path by
  // stripping the absolute prefix up to and including
  // the `evidence/` segment.
  const norm = abs.replaceAll("\\", "/")
  const evIdx = norm.lastIndexOf("/evidence/")
  if (evIdx >= 0) {
    return norm.slice(evIdx + 1) // e.g. "evidence/unifia-native/FC-31A/result.json"
  }
  throw new Error(
    `writeEvidence: fcFolder ${fcFolder} does not contain /evidence/ segment; cannot derive a repo-relative path.`,
  )
}

/* ------------------------------------------------------------------ */
/* Default P0 set                                                      */
/* ------------------------------------------------------------------ */

const DEFAULT_P0_TESTS: readonly FunctionalCriterionId[] = [
  "FC-31A",
  "FC-31B",
  "FC-04",
  "FC-14",
  "FC-25",
  "FC-32",
  // FC-13 and FC-13-CTRL are added explicitly so the result file
  // records them as BLOCKED with explicit methodology-gap evidence
  // (per pack gelé review 2026-09-03, v1.1 §2: BLOCKED ≠ NOT_VALID;
  // a missing methodology is BLOCKED, not NOT_APPLICABLE).
  "FC-13-CTRL",
  "FC-13",
]

/* ------------------------------------------------------------------ */
/* Runner                                                              */
/* ------------------------------------------------------------------ */

export class QualificationRunner {
  private readonly opts: RunnerOptions
  private readonly adapter: DurableWorkflowAuthorityQualificationAdapter
  private readonly provider: FakeExternalEffectProvider
  private readonly info: CandidateInfo | null = null
  private readonly builder: CandidateResultBuilder

  constructor(
    adapter: DurableWorkflowAuthorityQualificationAdapter,
    provider: FakeExternalEffectProvider,
    opts: RunnerOptions,
  ) {
    this.adapter = adapter
    this.provider = provider
    this.opts = opts
    this.builder = new CandidateResultBuilder(
      // placeholder; replaced after candidateInfo()
      {
        kind: "UNIFIA_NATIVE",
        version: "0.0.0",
        buildHash: opts.buildHash,
        storage: {
          engine: "n/a",
          driver: "n/a",
          journalMode: "n/a",
          synchronous: "n/a",
          busyTimeoutMs: 0,
          maxOpenConns: 0,
          backupTarget: "file",
        },
        process: { topology: "n/a", multiProcessSafe: false },
      },
      opts.buildHash,
      opts.provenance,
    )
  }

  /** Run the default P0 set (or the configured set) and write the result file. */
  async run(): Promise<{ resultPath: string; expectedNAPath: string; builder: CandidateResultBuilder }> {
    const info = await this.adapter.candidateInfo()
    // Replace the placeholder candidate info in the builder.
    // We do this by reconstructing the builder.
    const realBuilder = new CandidateResultBuilder(info, this.opts.buildHash, this.opts.provenance)
    Object.assign(this.builder, realBuilder)

    // Per pack gelé review 2026-09-03 v1.1 (CP4+ follow-up): the
    // runner used to call `this.adapter.initialize()` inside every
    // `runFC*` method. For child-process candidates (DBOS Go v1.0.0)
    // this meant re-spawning a ~30-60s Go process for each FC test.
    // The harness now initializes ONCE at the start and shuts down
    // ONCE at the end. The per-FC `runFC*` methods are expected to
    // assume the adapter is already initialized.
    await this.adapter.initialize()
    await this.provider.initialize()

    const tests = this.opts.testsToRun ?? DEFAULT_P0_TESTS
    try {
      for (const fc of tests) {
        try {
          await this.runOne(fc)
        } catch (e) {
          const folder = evidencePath(this.opts.outputRoot, info.kind, fc)
          // Mandate §19-§20: classify the exception precisely
          // instead of mechanically mapping every error to
          // FAIL_CORRECTABLE. QualificationNotImplemented maps
          // to NOT_IMPLEMENTED (the candidate capability has
          // not been wired), QualificationBlocked to BLOCKED,
          // etc. Unclassified exceptions are HARNESS_ERROR
          // and indicate a harness bug, not candidate evidence.
          const classified = classifyQualificationError(fc, e)
          const errorPath = await writeEvidence(
            folder,
            "error.txt",
            `Runner failed to execute ${fc}: ${(e as Error).message}\n${(e as Error).stack ?? ""}`,
          )
          this.builder.record({
            testId: fc,
            status: classified.status,
            evidencePath: errorPath,
            note: classified.message,
            observations: { exception: classified.name },
          })
        }
      }
    } finally {
      await this.adapter.shutdown().catch(() => undefined)
      await this.provider.shutdown().catch(() => undefined)
    }

    const resultPath = resultsPath(this.opts.outputRoot, info.kind)
    await this.builder.write(resultPath)

    // EXPECTED_NA : per pack gelé review (correction pack 2026-09-03,
    // v1.1 §3), this file contains ONLY NOT_APPLICABLE entries.
    // BLOCKED outcomes are written into M0_RESULTS_*.json by the
    // runner, not into the expected-NA file.
    const naBuilder = new ExpectedNABuilder(info.kind, {
      qualificationGenerationId: this.opts.provenance?.qualificationGenerationId ?? "unset",
      nonCanonicalDiagnostic: this.opts.provenance?.nonCanonicalDiagnostic ?? false,
    })
    const naPath = expectedNAPath(this.opts.outputRoot, info.kind)
    await naBuilder.write(naPath)

    return { resultPath, expectedNAPath: naPath, builder: this.builder }
  }

  /* ------------------------------------------------------------------ */
  /* Single-FC driver                                                   */
  /* ------------------------------------------------------------------ */

  private async runOne(fc: FunctionalCriterionId): Promise<void> {
    const info = await this.adapter.candidateInfo()
    switch (fc) {
      case "FC-31A":    return this.runFC31A(info)
      case "FC-31B":    return this.runFC31B(info)
      case "FC-04":     return this.runFC04(info)
      case "FC-14":     return this.runFC14(info)
      case "FC-25":     return this.runFC25(info)
      case "FC-32":     return this.runFC32(info)
      case "FC-13-CTRL": return this.runFC13CTRL(info)
      case "FC-13":     return this.runFC13(info)
      default:
        throw new Error(`test ${fc} not implemented in default P0 set`)
    }
  }

  /* ------------------------------------------------------------------ */
  /* FC-31A : canonical value round-trip WITH RESTART                    */
  /* ------------------------------------------------------------------ */

  private async runFC31A(info: CandidateInfo): Promise<void> {
    const folder = evidencePath(this.opts.outputRoot, info.kind, "FC-31A")
    // Per pack gelé review 2026-09-03 v1.1 §4: FC-31A is a RESTART
    // test, not a same-instance round-trip. The harness must:
    //
    //   1. Initialize candidate A
    //   2. Persist canonical value
    //   3. Close / shutdown candidate A
    //   4. WITHOUT deleting the durable store, construct candidate
    //      B (same store)
    //   5. Reopen the durable store
    //   6. Inspect / recover the canonical value
    //   7. Compare exact semantic value
    //
    // PASS only after this restart. The previous implementation
    // (same-instance persist+inspect) is NOT a proof of durability
    // and was reclassified NOT_VALID.
    try {
      let pass = 0
      let fail = 0
      const observations: Record<string, unknown> = {}
      const adapterInfo = await this.adapter.candidateInfo()
      const isChildProcess =
        adapterInfo.process.topology === "child-process" ||
        adapterInfo.process.topology === "sidecar" ||
        adapterInfo.process.topology === "remote"

      for (const v of FC_31A_VALUES) {
        const liId = `li-${v.name}` as LogicalInvocationId

        // Step 1-2: candidate A persists the canonical value.
        const runIdA = await this.adapter.startRun({
          workflowVersionId: "wf-fc31a" as WorkflowVersionId,
          ownerScope: { organizationId: "o1", workspaceId: "ws-fc31a" },
          initialLogicalInvocation: {
            logicalInvocationId: liId,
            effectKey: `ek-${v.name}`,
            canonicalInput: v.value,
          },
          seedCanonicalValue: v.value,
        } satisfies StartRunInput)
        await this.adapter.driveAttempt(runIdA, liId, {
          effectKey: `ek-${v.name}`,
          outcome: "SUCCEEDED",
          canonicalResult: v.value,
          ackLost: false,
          idempotencyKey: `ik-${v.name}-1`,
          providerCommittedAtEpochMs: Date.now(),
        } satisfies ProviderResolution)

        // Step 3-5: close the candidate, then reopen on the same
        // durable store. For in-process (Native) candidates, this
        // is forceProcessCrash() + reopen() (the adapter closes the
        // SQLite handle and re-opens it). For child-process (DBOS
        // Go) candidates, this kills the Go binary and spawns a
        // fresh one pointed at the same M0_STORE_DIR.
        await this.adapter.forceProcessCrash()
        await this.adapter.reopen()

        // Step 6: inspect the recovered run.
        const stateB = await this.adapter.inspectRun(runIdA)
        const lastB = stateB.logicalInvocations[0]
        if (!lastB) {
          fail++
          observations[v.name] = { ok: false, reason: "no invocation state after restart" }
          continue
        }
        const observed = lastB.canonicalObservation
        if (observed === null) {
          fail++
          observations[v.name] = { ok: false, reason: "observation is null after restart" }
          continue
        }
        const ok = canonicalEquals(observed, v.value)
        if (ok) pass++
        else {
          fail++
          observations[v.name] = { ok: false, expected: v.value, observed, bitPattern: v.bitPattern.toString() }
        }
      }

      const status: QualificationStatus = fail === 0 ? "PASS" : "FAIL_CORRECTABLE"
      const evidence = await writeEvidence(folder, "result.json", {
        pass,
        fail,
        observations,
        restartObserved: true,
        adapterTopology: info.process.topology,
        isChildProcess,
      })
      this.builder.record({
        testId: "FC-31A",
        status,
        evidencePath: evidence,
        note: `${pass}/${FC_31A_VALUES.length} canonical values survived a candidate restart (close+reopen on same durable store). ${fail} mismatches.`,
        observations: { pass, fail, total: FC_31A_VALUES.length, restartObserved: true },
      })
    } catch (e) {
      throw e
    }
  }

  /* ------------------------------------------------------------------ */
  /* FC-31B : host-integer vs host-float64 separation                    */
  /* ------------------------------------------------------------------ */

  private async runFC31B(info: CandidateInfo): Promise<void> {
    const folder = evidencePath(this.opts.outputRoot, info.kind, "FC-31B")
    // Adapter is initialized once in run() (single-init lifecycle).
    //
    // Per pack gelé review 2026-09-03 v1.1 §6-§8: FC-31B is a
    // HOST ADAPTER test, not a TS-side conversion test. For
    // candidates whose actual host is TS/Bun (UNIFIA_NATIVE in
    // M0), the harness can use the TS contract conversion
    // functions (fromHostFloat64 / fromHostInteger) — these are
    // the actual host adapter. For candidates whose actual host
    // is Go (DBOS_GO_SQLITE), the harness must drive the test
    // through the Go host's own typed fixtures. The current
    // harness uses TS conversion for both, so FC-31B is NOT_VALID
    // for DBOS_GO_SQLITE until a real Go host adapter is wired up.
    const isChildProcess =
      info.process.topology === "child-process" || info.process.topology === "sidecar" || info.process.topology === "remote"
    if (isChildProcess) {
      const canonize = this.adapter.canonizeViaHost?.bind(this.adapter)
      if (!canonize) {
        // Candidate host exposes no typed host-adapter endpoint (e.g. the
        // CUSTOM_GO_SQLITE_CONTROL diagnostic binary): FC-31B stays NOT_VALID.
        const observations = {
          measured: false,
          reason: "The candidate's host does not expose a typed host-adapter endpoint, so the frozen FC-31B vectors cannot be decided by the host itself.",
          requiredMethodology: "Implement /host-adapter/canonize in the candidate binary: receive lossless typed fixtures, materialize the host type (int64/uint64/float64/time.Time), apply the canonical value contract, emit PASS/REJECT verdicts.",
          nextAction: "Implement the endpoint, then rerun qualification from a clean source commit.",
        }
        const evidence = await writeEvidence(folder, "result.json", observations)
        this.builder.record({
          testId: "FC-31B",
          status: "NOT_VALID",
          evidencePath: evidence,
          note: "FC-31B NOT_VALID: no host-adapter endpoint on the candidate binary. The harness must not decide FC-31B with its own TS conversion for a non-TS host.",
          observations,
        })
        return
      }
      // Measured: every frozen FC-31B case (M0_UNIFIAVALUE_VECTOR_V1, test
      // == "FC-31B") is driven through the candidate's own host, which
      // materializes the exact typed value and applies the contract itself.
      const frozenCases = M0_UNIFIAVALUE_VECTOR_V1.filter((vectorCase) => vectorCase.test === "FC-31B")
      const observations: Record<string, unknown> = { measured: true, host: "candidate host-adapter endpoint" }
      let pass = 0
      let fail = 0
      for (const vectorCase of frozenCases) {
        const fixture: HostAdapterFixture = { caseId: vectorCase.id, encoding: vectorCase.encoding, payload: vectorCase.payload }
        try {
          const verdict: HostAdapterVerdict = await canonize(fixture)
          const expected = vectorCase.expect
          let ok: boolean
          if (expected.outcome === "reject") {
            ok = verdict.outcome === "reject" && verdict.code === expected.code
          } else if (expected.outcome === "pass-normalized") {
            ok = verdict.outcome === "pass" && verdict.canonical?.bits === expected.normalizedBits
          } else {
            ok = verdict.outcome === "pass"
          }
          if (ok) {
            pass++
            observations[vectorCase.id] = { ok: true, goType: verdict.goType }
          } else {
            fail++
            observations[vectorCase.id] = { ok: false, expected, verdict }
          }
        } catch (error) {
          fail++
          observations[vectorCase.id] = { ok: false, expected: vectorCase.expect, error: String(error) }
        }
      }
      const status: QualificationStatus = fail === 0 ? "PASS" : "FAIL_CORRECTABLE"
      const evidence = await writeEvidence(folder, "result.json", observations)
      this.builder.record({
        testId: "FC-31B",
        status,
        evidencePath: evidence,
        note: `${pass}/${frozenCases.length} frozen FC-31B cases decided by the candidate's own host (${info.process.topology}); actual host type recorded per case.`,
        observations: { pass, fail, total: frozenCases.length, ...observations },
      })
      return
    }
    try {
      // The adapter does not "convert" via toCanonicalValue() on
      // the way in; the contract exposes already-canonical values.
      // FC-31B is therefore tested at the harness level: the harness
      // owns the conversion, and we record whether the candidate
      // round-trips what the harness provides.
      //
      // Per pack gelé §17, the test is the host's own behavior, not
      // the candidate's. We delegate to the contract's conversion
      // functions and confirm the candidate round-trips a few key
      // edge values.
      let pass = 0
      let fail = 0
      const observations: Record<string, unknown> = {}
      for (const v of FC_31B_VECTORS) {
        let canonicalValue: UnifiaValue | null = null
        let conversionError: CanonicalValueError | null = null
        try {
          if (v.adapter === "fromHostFloat64") {
            canonicalValue = fromHostFloat64(v.input as number)
          } else {
            canonicalValue = fromHostInteger(v.input as number | bigint)
          }
        } catch (e) {
          conversionError = e as CanonicalValueError
        }
        if (v.expected === "PASS") {
          if (conversionError) {
            fail++
            observations[v.name] = { ok: false, reason: "expected PASS, got REJECT", code: conversionError.code }
            continue
          }
          if (canonicalValue === null) {
            fail++
            observations[v.name] = { ok: false, reason: "canonicalValue null after conversion" }
            continue
          }
          // Run the value through the candidate.
          const liId = `li-${v.name}` as LogicalInvocationId
          const runId = await this.adapter.startRun({
            workflowVersionId: "wf-fc31b" as WorkflowVersionId,
            ownerScope: { organizationId: "o1", workspaceId: "ws-fc31b" },
            initialLogicalInvocation: {
              logicalInvocationId: liId,
              effectKey: `ek-${v.name}`,
              canonicalInput: canonicalValue,
            },
            seedCanonicalValue: canonicalValue,
          } satisfies StartRunInput)
          await this.adapter.driveAttempt(runId, liId, {
            effectKey: `ek-${v.name}`,
            outcome: "SUCCEEDED",
            canonicalResult: canonicalValue,
            ackLost: false,
            idempotencyKey: `ik-${v.name}-1`,
            providerCommittedAtEpochMs: Date.now(),
          } satisfies ProviderResolution)
          const state = await this.adapter.inspectRun(runId)
          const observed = state.logicalInvocations[0]?.canonicalObservation ?? null
          if (observed === null || !canonicalEquals(observed, canonicalValue)) {
            fail++
            observations[v.name] = { ok: false, reason: "round-trip mismatch", expected: canonicalValue, observed }
          } else {
            pass++
            observations[v.name] = { ok: true }
          }
        } else {
          if (!conversionError) {
            fail++
            observations[v.name] = { ok: false, reason: "expected REJECT, got PASS" }
          } else if (conversionError.code !== v.expectedErrorCode) {
            fail++
            observations[v.name] = { ok: false, reason: `expected code ${v.expectedErrorCode}, got ${conversionError.code}` }
          } else {
            pass++
            observations[v.name] = { ok: true, code: conversionError.code }
          }
        }
      }
      const status: QualificationStatus = fail === 0 ? "PASS" : "FAIL_CORRECTABLE"
      const evidence = await writeEvidence(folder, "result.json", { pass, fail, observations })
      this.builder.record({
        testId: "FC-31B",
        status,
        evidencePath: evidence,
        note: `${pass}/${FC_31B_VECTORS.length} host-integer/float64 separation cases handled correctly.`,
        observations: { pass, fail, total: FC_31B_VECTORS.length },
      })
    } catch (e) {
      throw e
    }
  }

  /* ------------------------------------------------------------------ */
  /* FC-04 : provider success + local ACK lost                          */
  /* ------------------------------------------------------------------ */

  private async runFC04(info: CandidateInfo): Promise<void> {
    const folder = evidencePath(this.opts.outputRoot, info.kind, "FC-04")
    // Per pack gelé review 2026-09-03 v1.1 §10-§12: FC-04
    // requires REAL transport-level ACK loss, not a magic flag.
    // The harness must observe that:
    //
    //   1. The candidate actually called a real external provider
    //      (NOT just received a flag from the harness).
    //   2. The provider durably committed the effect to its own
    //      journal.
    //   3. The transport ACK was dropped after the commit.
    //   4. The candidate's recovery resolved to UNKNOWN_EXTERNAL_STATE.
    //
    // The current implementation uses `providerResponse.ackLost: true`
    // as a flag the harness passes to the candidate. For
    // UNIFIA_NATIVE, the candidate consults this flag and
    // short-circuits to UNKNOWN_EXTERNAL_STATE without calling the
    // provider — so we observe a UNKNOWN_EXTERNAL_STATE but the
    // provider was never called. For DBOS_GO_SQLITE, the candidate
    // is process-isolated and has no provider at all — the
    // `ackLost` flag is a magic value that the Go binary maps to
    // UNKNOWN_EXTERNAL_STATE in its custom SQLite, with no
    // provider involvement.
    //
    // Per §12, the current FC-04 PASS for DBOS Go is NOT_VALID.
    // We reclassify it here. The unblock path is documented in
    // observations.requiredMethodology.
    const isChildProcess =
      info.process.topology === "child-process" || info.process.topology === "sidecar" || info.process.topology === "remote"
    if (isChildProcess) {
      const observations = {
        measured: false,
        reason: "FC-04 requires real transport-level ACK loss, not a magic flag. The current DBOS Go candidate has no wired-in external provider; the harness passes `ackLost: true` to the Go binary's HTTP body, which the Go binary maps to UNKNOWN_EXTERNAL_STATE in its custom SQLite — but no provider was actually called, no provider commitment occurred, and no transport ACK was dropped. Per pack gelé §12 this is NOT_VALID until a real external provider architecture is wired in.",
        providerCalled: 0,
        providerCommitted: false,
        providerJournalContainsEffectKey: false,
        candidateDidNotReceiveSuccessAck: "by configuration, not by transport loss",
        candidateRestartedOrRecoveryPathExercised: false,
        blindRetryCount: 0,
        requiredMethodology: "(1) Stand up a real FakeExternalEffectProvider as an HTTP service with its own SQLite journal (separate from the candidate). (2) Candidate's driveAttempt makes an HTTP call to the provider with the EffectKey. (3) Provider durably commits the effect. (4) Provider is configured to drop the response ACK (close TCP without sending the HTTP response). (5) Candidate's driveAttempt times out / receives no response. (6) Candidate's recovery path resolves to UNKNOWN_EXTERNAL_STATE. (7) Cross-verify the provider's journal contains the effectKey.",
        nextAction: "Add a fake external provider HTTP service with its own SQLite journal; have the candidate's driveAttempt call the provider over HTTP; verify the provider's journal has the effectKey after the candidate's recovery.",
      }
      const evidence = await writeEvidence(folder, "result.json", observations)
      this.builder.record({
        testId: "FC-04",
        status: "NOT_VALID",
        evidencePath: evidence,
        note: "FC-04 NOT_VALID for DBOS Go: `ackLost: true` is a magic flag from the harness, not real transport-level ACK loss. The candidate has no wired-in provider; the Go binary maps the flag to UNKNOWN_EXTERNAL_STATE without any provider involvement. See observations.requiredMethodology for the unblock path.",
        observations,
      })
      return
    }
    // Adapter is initialized once in run() (single-init lifecycle).
    try {
      // Per pack gelé §10-§12 + CP6.1 §18-§20: FC-04 requires
      // real transport-level ACK loss, not a magic flag from
      // the harness. For UNIFIA_NATIVE the evidence records
      // `transportLevelAckLoss: false` because the candidate and
      // the provider are both in-process; the `ackLost: true`
      // flag is a configuration signal, not a real transport
      // loss. Per pack gelé §18, FC-04 for UNIFIA_NATIVE is
      // NOT_VALID — there is no exception for in-process.
      //
      // We still drive the test (to record what the candidate
      // does in response to the flag) and document the
      // evidence, but the status is NOT_VALID.
      const runId = await this.adapter.startRun({
        workflowVersionId: "wf-fc04" as WorkflowVersionId,
        ownerScope: { organizationId: "o1", workspaceId: "ws-fc04" },
        initialLogicalInvocation: {
          logicalInvocationId: "li-fc04" as LogicalInvocationId,
          effectKey: "ek-fc04",
          canonicalInput: fromHostFloat64(42),
        },
        seedCanonicalValue: fromHostFloat64(42),
      } satisfies StartRunInput)
      const attempt = await this.adapter.driveAttempt(runId, "li-fc04" as LogicalInvocationId, {
        effectKey: "ek-fc04",
        outcome: "SUCCEEDED",
        canonicalResult: fromHostFloat64(99),
        ackLost: true,
        idempotencyKey: "ik-fc04-1",
        providerCommittedAtEpochMs: Date.now(),
      } satisfies ProviderResolution)

      // Per pack gelé §18, FC-04 is NOT_VALID for both candidates
      // until a real external provider transport is wired in.
      const observations = {
        attemptStatus: attempt.status,
        ackLostSignal: true,
        adapterTopology: info.process.topology,
        transportLevelAckLoss: false,
        providerReceivedEffect: false,
        providerCommittedEffect: false,
        providerJournalContainsEffectKey: false,
        transportAckActuallyLost: false,
        candidateDidNotObserveSuccess: "by configuration, not by transport loss",
        candidateRestartedOrRecoveryPathExercised: false,
        blindRetryCount: 0,
        note: "FC-04 requires real transport-level ACK loss from an INDEPENDENT external provider. The current architecture is in-process (Native) or magic-flag (DBOS Go); neither satisfies the pack gelé §18-§20 contract. NOT_VALID until a FakeExternalEffectProviderProcess is wired in (separate HTTP service, separate SQLite journal, transport-level ACK drop after commit).",
      }
      const evidence = await writeEvidence(folder, "result.json", observations)
      this.builder.record({
        testId: "FC-04",
        status: "NOT_VALID",
        evidencePath: evidence,
        note: "FC-04 NOT_VALID: the harness uses `ackLost: true` as a magic flag, not a real transport-level ACK loss from an independent external provider. UNIFIA_NATIVE has no in-process exception per pack gelé §18. Reclassified from CP4 PASS.",
        observations,
      })
    } catch (e) {
      throw e
    }
  }

  /* ------------------------------------------------------------------ */
  /* FC-14 : multi-process authority (substrate-neutral)                 */
  /* ------------------------------------------------------------------ */

  private async runFC14(info: CandidateInfo): Promise<void> {
    // Per pack gelé §15 + CP6.3 (final closure 2026-09-04): FC-14
    // requires a real concurrent race between 2 OS processes,
    // and a proof that the WINNING authority can act
    // (authoritative mutation + effect dispatch ACCEPTED) and
    // the LOSING authority's attempts are REJECTED on both
    // paths. The runner now drives this scenario entirely
    // through substrate-neutral contract methods:
    //   adapter.raceAuthorities()  → spawns the 2nd process
    //   adapter.attemptAuthoritativeMutation()  → winner + loser
    //   adapter.attemptEffectDispatch()  → winner + loser
    // The adapter is responsible for the substrate-native
    // mechanism (CUSTOM_GO_SQLITE_CONTROL spawns a 2nd
    // `dbos-qualify.exe`; UNIFIA_NATIVE spawns a 2nd Bun worker
    // process via `native-authority-worker.ts`). The common
    // runner does not know which.
    const folder = evidencePath(this.opts.outputRoot, info.kind, "FC-14")
    const runId = `run-fc14-${Date.now()}-${Math.random().toString(36).slice(2, 8)}` as WorkflowRunId
    const ownerA = `owner-A-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    const ownerB = `owner-B-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    // We need a stable store dir to pass to raceAuthorities. The
    // adapter knows its own storeDir; we read it via candidateInfo
    // and the `process` block. For the M0 harness we use the
    // adapter's first open store dir by calling inspectAuthority
    // before any claim; that returns a zero-generation snapshot
    // and the runId does not yet exist. Then we use the same
    // storeDir the adapter will use.
    //
    // To avoid coupling the runner to a specific store dir, we
    // simply let the adapter pass through the sharedStore from
    // the FC-31A path (the same store dir reused). For M0 we
    // query the candidateInfo for the storeDir via a probe.
    const sharedStore = await this.deriveStoreDir(info)
    const race = await this.adapter.raceAuthorities({
      runId,
      sharedStore,
      participantA: { authorityOwnerId: ownerA },
      participantB: { authorityOwnerId: ownerB },
    } satisfies RaceAuthoritiesInput)
    if (!race.measured || !race.concurrentRace || race.distinctOsProcesses < 2) {
      // The adapter did not measure a real race. Record the
      // observations and reclassify as NOT_VALID (per pack gelé
      // §15: in-process is not sufficient).
      const observations: Record<string, unknown> = {
        measured: race.measured,
        concurrentRace: race.concurrentRace,
        distinctOsProcesses: race.distinctOsProcesses,
        reason: "Adapter did not measure a real 2-OS-process concurrent race. Per pack gelé §15, FC-14 requires at least 2 distinct OS processes claiming authority concurrently.",
        requiredMethodology: "Adapter must implement raceAuthorities() by spawning a 2nd process and issuing /authority/claim concurrently (Promise.all after a barrier).",
      }
      const evidence = await writeEvidence(folder, "result.json", observations)
      this.builder.record({
        testId: "FC-14",
        status: "NOT_VALID",
        evidencePath: evidence,
        note: "FC-14 NOT_VALID: adapter did not measure a real 2-OS-process concurrent race.",
        observations,
      })
      return
    }
    // Build the winner and loser tokens. The loser's
    // claim response contains the WINNER's authorityOwnerId
    // (because the loser was rejected and saw the current
    // owner). To make the mutate/dispatch REJECT, we use the
    // loser's processLocalOwnerId (the one IT claimed with)
    // at the loser's observed currentGeneration. The winner
    // uses the persisted (gen, owner) from the inspect call.
    const winnerToken: AuthorityToken = {
      runId,
      generation: race.finalGeneration,
      authorityOwnerId: race.finalPersistedAuthorityOwnerId,
    }
    const loserToken: AuthorityToken = {
      runId,
      generation: race.finalGeneration,
      authorityOwnerId: race.loser.processLocalOwnerId,
    }
    const winnerMutate = await this.adapter.attemptAuthoritativeMutation({ runId, token: winnerToken, mutation: "RUN_STATE_COMMITTED" })
    const loserMutate = await this.adapter.attemptAuthoritativeMutation({ runId, token: loserToken, mutation: "RUN_STATE_COMMITTED" })
    const winnerDispatch = await this.adapter.attemptEffectDispatch({ runId, token: winnerToken, effectKey: `ek-fc14-${Date.now()}` })
    const loserDispatch = await this.adapter.attemptEffectDispatch({ runId, token: loserToken, effectKey: `ek-fc14-${Date.now()}` })
    const winnerMutateAccepted = winnerMutate.accepted === true
    const loserMutateRejected = loserMutate.accepted === false
    const winnerDispatchAccepted = winnerDispatch.accepted === true
    const loserDispatchRejected = loserDispatch.accepted === false
    const observations: Record<string, unknown> = {
      measured: true,
      concurrentRace: true,
      distinctOsProcesses: race.distinctOsProcesses,
      winnerProcessLocalOwnerId: race.winner.processLocalOwnerId,
      loserProcessLocalOwnerId: race.loser.processLocalOwnerId,
      currentPersistedAuthorityOwnerId: race.finalPersistedAuthorityOwnerId,
      winnerOwnerId: race.winner.authorityOwnerId,
      loserOwnerId: race.loser.authorityOwnerId,
      winnerPid: race.winner.pid,
      loserPid: race.loser.pid,
      finalGeneration: race.finalGeneration,
      winnerMutate,
      loserMutate,
      winnerDispatch,
      loserDispatch,
      winnerMutateAccepted,
      loserMutateRejected,
      winnerDispatchAccepted,
      loserDispatchRejected,
    }
    const evidence = await writeEvidence(folder, "result.json", observations)
    const allPass = winnerMutateAccepted && loserMutateRejected && winnerDispatchAccepted && loserDispatchRejected
    this.builder.record({
      testId: "FC-14",
      status: allPass ? "PASS" : "FAIL_CORRECTABLE",
      evidencePath: evidence,
      note: allPass
        ? `FC-14 PASS: 2 distinct OS processes raced for authority on runId=${runId}. Winner (ownerId=${race.winner.authorityOwnerId} pid=${race.winner.pid}) mutated and dispatched successfully. Loser (ownerId=${race.loser.processLocalOwnerId} pid=${race.loser.pid}) was REJECTED on both mutate and dispatch.`
        : `FC-14 FAIL_CORRECTABLE: post-race conditions not all met. winnerMutate=${winnerMutateAccepted} loserMutate=${loserMutateRejected} winnerDispatch=${winnerDispatchAccepted} loserDispatch=${loserDispatchRejected}`,
      observations,
    })
  }

  /**
   * Derive a stable store dir for FC-14/25 racing. The runner
   * does not own a store dir; it must use the same one the
   * adapter uses. We probe via `inspectAuthority` on a
   * never-claimed runId: the adapter will create the row only
   * on first claim, so the inspect is a no-op for the row. To
   * get a path we can pass to `raceAuthorities.sharedStore`,
   * we read the candidate's diagnostics which include
   * `info.process.healthEndpoint` and the implementation's
   * store dir. Since the contract does not expose storeDir
   * directly, the adapter's `raceAuthorities` already asserts
   * `sharedStore === this.storeDir`; for the runner to pass
   * the right value, we obtain it from the adapter's existing
   * store dir through a side door: the candidateInfo
   * `version` field for CUSTOM_GO_SQLITE_CONTROL points to the
   * toolDir; for UNIFIA_NATIVE, the storage.engine includes
   * "bun:sqlite". The simplest correct approach is to let
   * the adapter publish its storeDir in candidateInfo.
   *
   * To keep the contract minimal we instead route through a
   * small probe: we call `inspectAuthority` for a probe runId
   * which returns a 404 from the Go binary and a zero-gen
   * snapshot from Native; either way, the `runId` is the
   * caller's. For the SHARED STORE DIR, the adapter's
   * `raceAuthorities` accepts the caller's `sharedStore` and
   * validates it equals its own; we therefore simply ASK the
   * adapter via a no-op probe by checking
   * `inspectAuthority(probeId)` — this exercises the adapter
   * and the runner can introspect the response to learn the
   * storeDir. Since `AuthoritySnapshot` does not include the
   * storeDir, we use a different mechanism: the runner
   * creates a temporary `runAuthority` row via a synthetic
   * call and reads the persistence path back. In practice,
   * the simplest substrate-neutral way is to pass the
   * `sharedStore` value the adapter EXPECTS to see. The
   * adapter's `raceAuthorities` returns
   * `UNKNOWN_SHARED_STORE` if it does not match, allowing
   * the runner to know to retry. For M0 we simplify: the
   * adapter and the runner agree via the `candidateInfo`
   * `process.healthEndpoint` (a URL). For Native, the
   * `process.healthEndpoint` is not yet exposed; for Go, the
   * endpoint is `/healthz`. The runner passes the SHARED
   * store dir as the input. To make this work without
   * enlarging the contract, the adapter's `raceAuthorities`
   * implementation accepts a SHARED STORE directory that
   * MUST equal its own; the runner passes the same
   * `storeDir` it gave to the adapter (the harness knows
   * this from the `opts` it used to construct the adapter).
   *
   * For M0 we delegate storeDir resolution to the harness:
   * the harness knows the store dir it constructed the
   * adapter with. The harness-side runner reads it from the
   * options. To keep this method pure, we accept a probe
   * `sharedStore` from the test/caller via `RunnerOptions`.
   */
  private async deriveStoreDir(_info: CandidateInfo): Promise<string> {
    // Pass an empty string; the adapter uses its own storeDir.
    // This is the substrate-neutral path: the runner does not
    // need to know the storage layout.
    return ""
  }

  /* ------------------------------------------------------------------ */
  /* FC-25 : stale authority fencing (zombie owner) — substrate-neutral  */
  /* ------------------------------------------------------------------ */

  private async runFC25(info: CandidateInfo): Promise<void> {
    // Per pack gelé §25-§28 (CP6.3 / final M0 closure 2026-09-04):
    // The runner now drives the REAL ZOMBIE-PROCESS scenario
    // through the substrate-neutral `runZombieFC25Scenario`
    // capability. The adapter is responsible for spawning
    // the second live OS process, performing the IPC freeze
    // barrier, observing the takeover, and verifying the
    // stale mutate+dispatch rejections.
    //
    // PASS conditions (per result-builder gate):
    //   distinctOsProcesses            >= 2
    //   oldOwnerAliveDuringTakeover   = true
    //   oldOwnerDidNotReleaseBeforeTakeover = true
    //   newGenerationGreaterThanOld   = true
    //   newOwnerCommitAccepted        = true
    //   staleOwnerCommitRejected      = true
    //   staleOwnerDispatchRejected    = true
    const folder = evidencePath(this.opts.outputRoot, info.kind, "FC-25")
    let result: ZombieFC25Result
    try {
      result = await this.adapter.runZombieFC25Scenario()
    } catch (e) {
      // The adapter threw (e.g. CUSTOM_GO_SQLITE_CONTROL
      // because the binary does not implement /await-resume).
      // The result is NOT_IMPLEMENTED until the underlying
      // capability exists on the candidate.
      const observations: Record<string, unknown> = {
        measured: false,
        reason: (e as Error).message,
        fc25ZombieScenarioRequired:
          "Real FC-25 requires 2 live OS processes with an IPC freeze barrier between A's claim and A's stale-mutate/dispatch. The adapter must implement runZombieFC25Scenario by spawning the second process, performing the takeover WHILE A is alive but blocked on /await-resume, then RESUME A and verify stale rejection.",
      }
      const evidence = await writeEvidence(folder, "result.json", observations)
      this.builder.record({
        testId: "FC-25",
        status: "NOT_IMPLEMENTED",
        evidencePath: evidence,
        note: `FC-25 NOT_IMPLEMENTED: ${(e as Error).message}`,
        observations,
      })
      return
    }
    // Build the FC-25 result builder observations.
    const observations: Record<string, unknown> = {
      measured: result.measured,
      distinctOsProcesses: result.distinctOsProcesses,
      oldOwnerAliveDuringTakeover: result.oldOwnerAliveDuringTakeover,
      oldOwnerDidNotReleaseBeforeTakeover: result.oldOwnerDidNotReleaseBeforeTakeover,
      oldOwnerPid: result.oldOwnerPid,
      newGenerationGreaterThanOld: result.newGenerationGreaterThanOld,
      newOwnerCommitAccepted: result.newOwnerCommitAccepted,
      staleOwnerCommitRejected: result.staleOwnerCommitRejected,
      staleOwnerDispatchRejected: result.staleOwnerDispatchRejected,
      takeover: result.takeover,
      newOwnerMutate: result.newOwnerMutate,
      staleMutate: result.staleMutate,
      staleDispatch: result.staleDispatch,
      runId: result.runId,
      ownerA: result.ownerA,
      ownerB: result.ownerB,
    }
    const evidence = await writeEvidence(folder, "result.json", observations)
    // FC-25 PASS requires the 5 conditions in the result builder gate.
    const allPass = result.measured
      && result.distinctOsProcesses >= 2
      && result.oldOwnerAliveDuringTakeover
      && result.oldOwnerDidNotReleaseBeforeTakeover
      && result.newGenerationGreaterThanOld
      && result.newOwnerCommitAccepted
      && result.staleOwnerCommitRejected
      && result.staleOwnerDispatchRejected
    this.builder.record({
      testId: "FC-25",
      status: allPass ? "PASS" : "FAIL_CORRECTABLE",
      evidencePath: evidence,
      note: allPass
        ? `FC-25 PASS: 2 live OS processes (pid=${result.oldOwnerPid} + parent adapter); A claimed gen=1, A blocked on /await-resume (frozen=true, alive=true), takeover to B at gen=${(result.takeover as { newGeneration: AuthorityGeneration }).newGeneration}, B commit ACCEPTED, A resumed and stale mutate+dispatch REJECTED.`
        : `FC-25 FAIL_CORRECTABLE: zombie-fence conditions not all met. measured=${result.measured} distinctProcs=${result.distinctOsProcesses} aliveDuringTakeover=${result.oldOwnerAliveDuringTakeover} newCommit=${result.newOwnerCommitAccepted} staleCommit=${result.staleOwnerCommitRejected} staleDispatch=${result.staleOwnerDispatchRejected}`,
      observations,
    })
  }

  /* ------------------------------------------------------------------ */
  /* FC-32 : replay model declaration                                    */
  /* ------------------------------------------------------------------ */

private async runFC32(info: CandidateInfo): Promise<void> {
    // Frozen pack §44: drive the candidate's own orchestration through
    // T1/R1/O1 -> partial checkpoint -> crash -> T2/R2/O2 recovery and
    // MEASURE which observations re-run, which values replay, which
    // control-flow decisions recompute, EffectKey stability, completed
    // effect replay behavior, and the final canonical state. The
    // classification REQUIRES_DETERMINISTIC_ORCHESTRATION = YES | NO |
    // PARTIAL is computed from the journals (measured = true), never
    // declared. PASS = measured + scenario completed with a canonical
    // final state; the classification itself is an ADR-000 decision input
    // and PASS criteria are identical for every candidate (§26).
    const folder = evidencePath(this.opts.outputRoot, info.kind, "FC-32")
    const fc32 = this.adapter.fc32StartScenario?.bind(this.adapter)
    if (!fc32 || !this.adapter.fc32RunAttempt || !this.adapter.fc32Measure || !this.adapter.fc32SetAmbient) {
      const observations = {
        measured: false,
        reason: "The candidate does not expose the FC-32 replay-scenario capability, so its orchestration cannot be measured.",
        requiredMethodology: "Implement fc32SetAmbient/fc32StartScenario/fc32RunAttempt/fc32Measure on the candidate: a step workflow whose bodies journal invocations, whose completed outputs replay, whose only ambient read is journaled, and whose external effect executes under a stable EffectKey.",
        nextAction: "Implement the capability, then rerun qualification from a clean source commit.",
      }
      const evidence = await writeEvidence(folder, "result.json", observations)
      this.builder.record({
        testId: "FC-32",
        status: "NOT_VALID",
        evidencePath: evidence,
        note: "FC-32 NOT_VALID: candidate does not expose the replay-scenario capability.",
        observations,
      })
      return
    }

    // Harness-controlled ambient values (frozen pack §44): T = time,
    // R = random, O = ordering. Recovery ambient values all differ.
    const ambientInitial = { t: "2026-09-04T10:00:00.000Z", r: "alpha-4711", o: "ord-001" }
    const ambientAfterCrash = { t: "2026-09-04T10:05:00.000Z", r: "beta-8263", o: "ord-002" }
    try {
      const started = await fc32({ workflowVersionId: "wf-fc32" as WorkflowVersionId, ambient: ambientInitial })
      const attempt1 = await this.adapter.fc32RunAttempt!(started.runId, "crash-before-effect-commit")
      await this.adapter.forceProcessCrash()
      await this.adapter.reopen()
      await this.adapter.fc32SetAmbient!(started.runId, ambientAfterCrash)
      const attempt2 = await this.adapter.fc32RunAttempt!(started.runId, "complete")
      const measurement = await this.adapter.fc32Measure!(started.runId, { initial: ambientInitial, afterCrash: ambientAfterCrash })

      // Shared semantic oracle over the measured journals.
      const replayedCapture = (measurement.stepReplays["capture-ambient"] ?? 0) >= 1
      const replayedDerive = (measurement.stepReplays["derive-effect-key"] ?? 0) >= 1
      const neverReReadAmbient = measurement.ambientObservedAfterCrash === null
      const observedInitialMatches = measurement.ambientObservedInitial.t === ambientInitial.t && measurement.ambientObservedInitial.r === ambientInitial.r && measurement.ambientObservedInitial.o === ambientInitial.o
      const stableKey = measurement.effectKeysObserved.length === 1 && measurement.effectKeysObserved[0]!.includes(ambientInitial.r) && !measurement.effectKeysObserved[0]!.includes(ambientAfterCrash.r)
      const distinctAttempts = new Set(measurement.attemptIds).size >= 2 && attempt1.attemptId !== attempt2.attemptId
      const finalState = (measurement.finalMaterializedState ?? {}) as { t?: string; r?: string; o?: string; effectKey?: string }
      const finalStateCanonical = finalState.t === ambientInitial.t && finalState.r === ambientInitial.r && finalState.o === ambientInitial.o && finalState.effectKey === measurement.effectKeysObserved[0]
      const completedEffectNotReexecuted = measurement.externalEffectExecutions === 1

      const replaySignals = [replayedCapture, replayedDerive, stableKey].filter(Boolean).length
      const deterministic = neverReReadAmbient && replayedCapture && replayedDerive && stableKey && finalStateCanonical
      const classification: "YES" | "NO" | "PARTIAL" = deterministic ? "YES" : replaySignals === 0 ? "NO" : "PARTIAL"
      const invariants = {
        replayedCapture,
        replayedDerive,
        neverReReadAmbient,
        observedInitialMatches,
        stableKey,
        distinctAttempts,
        finalStateCanonical,
        completedEffectNotReexecuted,
      }
      const failed = Object.entries(invariants).filter(([, ok]) => !ok).map(([name]) => name)
      const status: QualificationStatus = measurement.measured && failed.length === 0 ? "PASS" : "FAIL_CORRECTABLE"
      const evidence = await writeEvidence(folder, "result.json", {
        measured: true,
        classification,
        invariants,
        failedInvariants: failed,
        ambientIntent: { initial: ambientInitial, afterCrash: ambientAfterCrash },
        measurement,
      })
      this.builder.record({
        testId: "FC-32",
        status,
        evidencePath: evidence,
        note: `REQUIRES_DETERMINISTIC_ORCHESTRATION = ${classification} (measured=true). ${failed.length === 0 ? "All replay invariants satisfied" : `failed: ${failed.join(", ")}`}. AttemptIds ${measurement.attemptIds.join(" -> ")}, ambient reads/attempt ${measurement.ambientReadsPerAttempt.map((r) => `${r.attemptId}:${r.reads}`).join(", ")}, external effect executions ${measurement.externalEffectExecutions}.`,
        observations: { measured: true, classification, invariants, failedInvariants: failed, rootWorkflowInvocations: measurement.rootWorkflowInvocations, stepBodyInvocations: measurement.stepBodyInvocations, stepReplays: measurement.stepReplays },
      })
    } catch (error) {
      const observations = {
        measured: false,
        reason: `FC-32 scenario execution failed: ${String(error)}`,
        requiredMethodology: "See frozen pack §44; the scenario must complete a full crash-recovery cycle before classification.",
      }
      const evidence = await writeEvidence(folder, "result.json", observations)
      this.builder.record({
        testId: "FC-32",
        status: "FAIL_CORRECTABLE",
        evidencePath: evidence,
        note: "FC-32 FAIL_CORRECTABLE: the replay scenario could not complete; see observations.",
        observations,
      })
    }
  }

  /* ------------------------------------------------------------------ */
  /* FC-13-CTRL : power-loss negative control (BLOCKED, no methodology) */
  /* ------------------------------------------------------------------ */

  private async runFC13CTRL(info: CandidateInfo): Promise<void> {
    // FC-13-CTRL is the negative control for FC-13 (power-loss
    // durability). It must:
    //   1. Configure a deliberately NON-durable write
    //   2. Trigger power-loss / storage fault
    //   3. Verify the write is lost (the negative control must lose)
    // If the negative control does not lose, FC-13 = NOT_VALID.
    //
    // Per correction pack 2026-09-03 v1.1 §2: when the methodology
    // is not available, the outcome is BLOCKED, not NOT_VALID.
    // NOT_VALID means the methodology ran and failed to measure
    // what it should. BLOCKED means no methodology is available.
    const folder = evidencePath(this.opts.outputRoot, info.kind, "FC-13-CTRL")
    const observations = {
      blockedReason: "NO_METHODOLOGY",
      detail: "No power-loss / fault-injection layer available in this harness host. Validated options that are NOT available: (1) VM with virtual disk + abrupt ACPI off, (2) `scsi_debug` / `fault-inject` / `fltmc`, (3) `dm-thin` suspend/resume, (4) block-device fault layer. `kill -9` and `process.kill()` are NOT acceptable — they prove process crash, not power-loss. To unblock: provision a disposable VM with virtual disk + scripted power-cycle, or a fault-injection layer; produce scripts + docs; rerun FC-13-CTRL.",
      requiredMethodology: "configure non-durable write + abrupt power-off + verify loss + verify FC-13 PASS on durable write under same fault",
      nextActionOwner: "Erwan (env admin) OR a future VM-equipped agent session",
    }
    const evidence = await writeEvidence(folder, "result.json", {
      status: "BLOCKED",
      blockedKind: "NO_METHODOLOGY",
      observations,
      note: blockedNote("NO_METHODOLOGY", observations.detail),
    })
    this.builder.record({
      testId: "FC-13-CTRL",
      status: "BLOCKED",
      evidencePath: evidence,
      note: blockedNote("NO_METHODOLOGY", observations.detail),
      observations,
    })
  }

  /* ------------------------------------------------------------------ */
  /* FC-13 : power-loss / storage fault (BLOCKED, no methodology)        */
  /* ------------------------------------------------------------------ */

  private async runFC13(info: CandidateInfo): Promise<void> {
    // FC-13 measures whether durable writes survive a real power-loss
    // event. Per pack gelé §13, simple `kill -9` is NOT acceptable.
    // Per correction pack v1.1 §2, when the methodology is not
    // available, the outcome is BLOCKED.
    const folder = evidencePath(this.opts.outputRoot, info.kind, "FC-13")
    const observations = {
      blockedReason: "NO_METHODOLOGY",
      detail: "FC-13 cannot be exercised: no fault-injection layer / VM control / reproducible storage fault. FC-13 depends on FC-13-CTRL first (negative control must lose) — if FC-13-CTRL is not executable, FC-13 cannot yield a valid result either. Both are BLOCKED in the same M0 env.",
      requiredMethodology: "(1) Configure a SQLite write with synchronous=FULL + WAL + checkpoint. (2) Trigger abrupt power-off / storage fault. (3) Reopen store. (4) Verify the write is durably present. Compare against FC-13-CTRL (which must lose).",
      fc13CtrlStatus: "BLOCKED (NO_METHODOLOGY) — see FC-13-CTRL record",
      nextActionOwner: "Erwan (env admin) OR a future VM-equipped agent session",
    }
    const evidence = await writeEvidence(folder, "result.json", {
      status: "BLOCKED",
      blockedKind: "NO_METHODOLOGY",
      observations,
      note: blockedNote("NO_METHODOLOGY", observations.detail),
    })
    this.builder.record({
      testId: "FC-13",
      status: "BLOCKED",
      evidencePath: evidence,
      note: blockedNote("NO_METHODOLOGY", observations.detail),
      observations,
    })
  }
}
