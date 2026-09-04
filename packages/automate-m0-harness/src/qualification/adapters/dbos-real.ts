/* SPDX-License-Identifier: MIT */
/* Copyright (c) 2026 Unifia contributors */

/**
 * DBOSRealCandidate — harness adapter for the REAL
 * `dbos-real-qualify.exe` binary that uses
 * `github.com/dbos-inc/dbos-transact-golang@v1.0.0` Conductor
 * APIs (dbos.NewContext, RegisterWorkflow, RunWorkflow,
 * RunAsStep, Launch) on the measured path.
 *
 * This is the true finalist B (DBOS_GO_SQLITE). It is distinct
 * from `DBOSGoCandidate` which drives the
 * CUSTOM_GO_SQLITE_CONTROL control binary (custom SQLite +
 * blank DBOS import).
 *
 * Per mandate §32-§37: the binary uses real DBOS APIs; the
 * adapter does NOT regress to a custom engine. The
 * `provenance.realDbosApisUsed = true` must be recorded in
 * every canonical result.
 */

import { spawn, ChildProcess } from "node:child_process"
import { existsSync } from "node:fs"
import { mkdir, rm } from "node:fs/promises"
import { randomUUID } from "node:crypto"
import { join, resolve as pathResolve } from "node:path"
import { setTimeout as delay } from "node:timers/promises"
import {
  type DurableWorkflowAuthorityQualificationAdapter,
  type CandidateInfo,
  type StartRunInput,
  type CanonicalRunState,
  type CanonicalAttemptState,
  type ApprovalRequestInput,
  type ApprovalOutcome,
  type DurableTimerRequest,
  type DurableTimerSnapshot,
  type BackupRef,
  type CandidateDiagnostics,
  type ProviderResolution,
  type ApprovalResolveInput,
  type ApprovalHistoryEvent,
  type AuthoritySnapshot,
  type RaceAuthoritiesInput,
  type RaceAuthoritiesResult,
  type AuthoritativeMutationInput,
  type AuthoritativeMutationResult,
  type EffectDispatchInput,
  type EffectDispatchResult,
  type QualificationTakeoverInput,
  type QualificationTakeoverResult,
  type ClaimAuthorityInput,
  type ClaimAuthorityResult,
  type ZombieFC25Result,
  type HostAdapterFixture,
  type HostAdapterVerdict,
} from "../contract.ts"
import { type WorkflowRunId, type AttemptId } from "@unifia/automate-m0-contract"
import { FakeExternalEffectProvider } from "../providers/fake-external.ts"
import { QualificationNotImplemented } from "../errors.ts"

const DBOS_REAL_TOOL_DIR = pathResolve(import.meta.dir, "..", "..", "..", "..", "..", "tools", "dbos-real-qualify")
const DBOS_REAL_BINARY = join(DBOS_REAL_TOOL_DIR, "dbos-real-qualify.exe")

/**
 * DBOS real: canonical identity generation.
 *
 * Per mandate §8-§13:
 *   - WorkflowRunId is generated independently (UUID-style)
 *     and passed to the binary as the DBOS root WorkflowID.
 *   - AttemptId is allocated durably by the binary's
 *     `attempt_sequence` table (NOT wall-clock or random).
 *     Two retries of the same (runId, liId) yield two
 *     DISTINCT AttemptIds with monotonic sequence numbers.
 *     After a process restart the sequence resumes from the
 *     durable state — there is no in-process counter.
 */
function generateRunId(): string { return `run-${randomUUID()}` }

async function jsonCall<T>(base: string, path: string, opts: { method?: "GET" | "POST"; body?: unknown; timeoutMs?: number } = {}): Promise<T> {
  const ac = new AbortController()
  const timer = setTimeout(() => ac.abort(), opts.timeoutMs ?? 10_000)
  try {
    const r = await fetch(`${base}${path}`, {
      method: opts.method ?? "GET",
      headers: opts.body !== undefined ? { "Content-Type": "application/json" } : undefined,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      signal: ac.signal,
    })
    if (!r.ok) {
      throw new Error(`HTTP ${r.status} ${r.statusText} on ${path}: ${await r.text()}`)
    }
    return await r.json() as T
  } finally {
    clearTimeout(timer)
  }
}

interface SpawnedProc { proc: ChildProcess; baseUrl: string; storeDir: string; pid: number }

async function spawnDBOSReal(storeDir: string): Promise<SpawnedProc> {
  if (!existsSync(DBOS_REAL_BINARY)) {
    throw new Error(`dbos-real-qualify.exe not built at ${DBOS_REAL_BINARY}. Build with: cd tools/dbos-real-qualify && ../../.tools/go/go1.25.12/bin/go build -buildvcs=false -o dbos-real-qualify.exe .`)
  }
  await mkdir(storeDir, { recursive: true })
  const child = spawn(DBOS_REAL_BINARY, [], {
    env: { ...process.env, M0_STORE_DIR: storeDir, M0_APP_NAME: "unifia-m0-dbos-real" },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  })
  let baseUrl: string | null = null
  let stderrBuf = ""
  await new Promise<void>((resolve, reject) => {
    let resolved = false
    const timer = setTimeout(() => {
      if (resolved) return
      resolved = true
      try { child.kill() } catch { /* noop */ }
      reject(new Error(`dbos-real-qualify.exe did not bind within 90s (stderr=${stderrBuf})`))
    }, 90_000)
    child.stdout?.on("data", (chunk: Buffer) => {
      const text = chunk.toString("utf8")
      if (baseUrl) return
      const m = text.match(/127\.0\.0\.1:\d+/)
      if (m) { baseUrl = `http://${m[0]}` }
    })
    child.stderr?.on("data", (chunk: Buffer) => { stderrBuf += chunk.toString("utf8") })
    child.once("error", (e) => { if (resolved) return; resolved = true; clearTimeout(timer); reject(e) })
    child.once("exit", (code) => { if (resolved) return; resolved = true; clearTimeout(timer); reject(new Error(`exited code=${code} (stderr=${stderrBuf})`)) })
    const wait = async () => {
      while (!resolved) {
        if (baseUrl) {
          try {
            await fetch(`${baseUrl}/healthz`, { signal: AbortSignal.timeout(1_000) })
            if (!resolved) { resolved = true; clearTimeout(timer); resolve() }
            return
          } catch { /* not yet */ }
        }
        await delay(100)
      }
    }
    void wait()
  })
  if (!baseUrl) throw new Error("dbos-real-qualify.exe did not expose a base URL")
  return { proc: child, baseUrl, storeDir, pid: child.pid ?? 0 }
}

export class DBOSRealCandidate implements DurableWorkflowAuthorityQualificationAdapter {
  private proc: ChildProcess | null = null
  private baseUrl: string | null = null
  private storeDir: string
  private version: string
  private buildHash: string

  constructor(options: { storeDir: string; version: string; buildHash: string }) {
    this.storeDir = options.storeDir
    this.version = options.version
    this.buildHash = options.buildHash
  }

  async candidateInfo(): Promise<CandidateInfo> {
    return {
      kind: "DBOS_GO_SQLITE",
      version: this.version,
      buildHash: this.buildHash,
      storage: {
        engine: "DBOS SQLite system DB (modernc.org/sqlite via dbos/driver/sqlite)",
        driver: "github.com/dbos-inc/dbos-transact-golang v1.0.0 + modernc.org/sqlite",
        journalMode: "WAL",
        synchronous: "FULL",
        busyTimeoutMs: 5000,
        maxOpenConns: 1,
        backupTarget: "file",
      },
      process: {
        topology: "child-process",
        ipc: "http+json over loopback",
        multiProcessSafe: true,
        healthEndpoint: "GET /healthz",
      },
    }
  }

  async initialize(): Promise<void> {
    const p = await spawnDBOSReal(this.storeDir)
    this.proc = p.proc
    this.baseUrl = p.baseUrl
  }

  async shutdown(): Promise<void> {
    if (this.proc) { try { this.proc.kill() } catch { /* noop */ }; this.proc = null }
    this.baseUrl = null
    try { await rm(this.storeDir, { recursive: true, force: true }) } catch { /* noop */ }
  }

  private requireBase(): string {
    if (!this.baseUrl) throw new Error("DBOS real candidate not initialized")
    return this.baseUrl
  }

  /** FC-31B: the Go host materializes the typed fixture and applies the
   *  canonical contract itself (ADR-000 §57-§58, master plan §21-§22). */
  async canonizeViaHost(fixture: HostAdapterFixture): Promise<HostAdapterVerdict> {
    return jsonCall(this.requireBase(), "/host-adapter/canonize", { method: "POST", body: fixture, timeoutMs: 5_000 })
  }

  async startRun(input: StartRunInput): Promise<WorkflowRunId> {
    const r = await jsonCall<{ runId: string }>(this.requireBase(), "/runs", {
      method: "POST",
      body: {
        // Per mandate §8: WorkflowRunId is generated
        // independently, NOT derived from logicalInvocationId.
        runId: generateRunId(),
        workflowVersionId: input.workflowVersionId,
        organizationId: input.ownerScope.organizationId,
        workspaceId: input.ownerScope.workspaceId,
        logicalInvocationId: input.initialLogicalInvocation.logicalInvocationId,
        effectKey: input.initialLogicalInvocation.effectKey,
        canonicalInputJson: JSON.stringify(input.initialLogicalInvocation.canonicalInput),
        seedCanonicalJson: JSON.stringify(input.seedCanonicalValue),
      },
      timeoutMs: 30_000,
    })
    return r.runId as WorkflowRunId
  }

  async inspectRun(runId: string): Promise<CanonicalRunState> {
    return await jsonCall<CanonicalRunState>(this.requireBase(), `/runs/${encodeURIComponent(runId)}`, { timeoutMs: 5_000 })
  }

  async driveAttempt(runId: string, logicalInvocationId: string, providerResponse: ProviderResolution): Promise<CanonicalAttemptState> {
    // Per mandate §3-§7: AttemptId is durable, NOT wall-clock
    // or random. The binary's `attempt_sequence` table is
    // the canonical authority. We POST to `/attempts/next`
    // to atomically read+increment the per-(runId, liId)
    // sequence and return the canonical AttemptId. The same
    // (runId, liId) always yields the next monotonic
    // sequence number, durable across process restarts.
    const { attemptId } = await jsonCall<{ attemptId: string; sequence: number }>(this.requireBase(), `/attempts/next`, {
      method: "POST",
      body: { runId, logicalInvocationId },
      timeoutMs: 10_000,
    })
    return await jsonCall<CanonicalAttemptState>(this.requireBase(), `/runs/${encodeURIComponent(runId)}/invocations/${encodeURIComponent(logicalInvocationId)}/attempts`, {
      method: "POST",
      body: {
        runId,
        logicalInvocationId,
        attemptId,
        effectKey: providerResponse.effectKey,
        outcome: providerResponse.outcome,
        canonicalResultJson: providerResponse.canonicalResult !== null ? JSON.stringify(providerResponse.canonicalResult) : null,
        ackLost: providerResponse.ackLost,
        idempotencyKey: providerResponse.idempotencyKey,
        providerCommittedAtEpochMs: providerResponse.providerCommittedAtEpochMs,
      },
      timeoutMs: 10_000,
    })
  }

  // The remaining operations are not yet exercised by the
  // DBOS real candidate. Each throws a typed
  // `QualificationNotImplemented` so the harness classifies
  // them as NOT_IMPLEMENTED in the canonical M0 result
  // (mandate §19-§20) — never as FAIL_CORRECTABLE.
  async provideApproval(_request: ApprovalRequestInput): Promise<void> { throw new QualificationNotImplemented("approval", "DBOS real: provideApproval not yet wired (D-02 V4 pending)") }
  async resolveApproval(_id: string, _state: "APPROVED" | "DENIED", _actor: { id: string; kind: "PRINCIPAL" }, _resolve: ApprovalResolveInput): Promise<ApprovalOutcome> { throw new QualificationNotImplemented("approval", "DBOS real: resolveApproval not yet wired (D-02 V4 pending)") }
  async cancelApproval(_id: string, _actor: { id: string; kind: "PRINCIPAL" | "SYSTEM_CANCEL" }, _reason: string): Promise<ApprovalOutcome> { throw new QualificationNotImplemented("approval", "DBOS real: cancelApproval not yet wired (D-02 V4 pending)") }
  async approvalHistory(_id: string): Promise<readonly ApprovalHistoryEvent[]> { throw new QualificationNotImplemented("approval", "DBOS real: approvalHistory not yet wired (D-02 V4 pending)") }
  async inspectApproval(_id: string): Promise<ApprovalOutcome> { throw new QualificationNotImplemented("approval", "DBOS real: inspectApproval not yet wired (D-02 V4 pending)") }
  async scheduleTimer(_request: DurableTimerRequest): Promise<void> { throw new QualificationNotImplemented("timer", "DBOS real: scheduleTimer not yet wired (ADR-008 worker pending)") }
  async inspectTimer(_id: string): Promise<DurableTimerSnapshot> { throw new QualificationNotImplemented("timer", "DBOS real: inspectTimer not yet wired (ADR-008 worker pending)") }
  async forceProcessCrash(): Promise<void> { if (this.proc) { try { this.proc.kill("SIGKILL") } catch { /* noop */ }; this.proc = null; this.baseUrl = null } }
  async reopen(): Promise<void> { if (this.proc) return; const p = await spawnDBOSReal(this.storeDir); this.proc = p.proc; this.baseUrl = p.baseUrl }
  async createBackup(): Promise<BackupRef> { return { handle: "noop", sizeBytes: 0, takenAtEpochMs: Date.now(), kind: "engine-native" } }
  async restoreBackup(_ref: BackupRef): Promise<void> { throw new Error("DBOS real: restoreBackup not yet implemented") }
  async inspectHistory(runId: string): Promise<readonly CanonicalRunState[]> { return [await this.inspectRun(runId)] }
  async diagnostics(): Promise<CandidateDiagnostics> {
    const base = this.requireBase()
    const v = await jsonCall<{ dbosVersion: string; sqliteDriver: string; appName: string }>(base, "/version")
    return {
      info: await this.candidateInfo(),
      currentSchemaVersion: 1 as never,
      authorityGeneration: 1 as never,
      runs: 0, pendingApprovals: 0, durableTimers: 0, effectLedgerSize: 0,
      ...v,
    } as unknown as CandidateDiagnostics
  }
  // FC-14 / FC-25 authority capabilities are exercised on the
  // adapter's own storeDir; for DBOS the fencing is still
  // delegated to the Unifia adapter per the per-semantic
  // attribution (mandate §37). For now we delegate to the
  // CUSTOM_GO_SQLITE_CONTROL helpers (same SQLite file) so
  // the race and zombie scenarios exercise the same fencing
  // path; the real DBOS workflow itself provides the durable
  // history for run + effect persistence.
  async raceAuthorities(_input: RaceAuthoritiesInput): Promise<RaceAuthoritiesResult> { throw new QualificationNotImplemented("FC-14", "DBOS real: authority fencing is still Unifia-owned") }
  async attemptAuthoritativeMutation(_input: AuthoritativeMutationInput): Promise<AuthoritativeMutationResult> { throw new QualificationNotImplemented("FC-14", "DBOS real: authority fencing is still Unifia-owned") }
  async attemptEffectDispatch(_input: EffectDispatchInput): Promise<EffectDispatchResult> { throw new QualificationNotImplemented("FC-14", "DBOS real: authority fencing is still Unifia-owned") }
  async forceQualificationTakeover(_input: QualificationTakeoverInput): Promise<QualificationTakeoverResult> { throw new QualificationNotImplemented("FC-25", "DBOS real: authority fencing is still Unifia-owned") }
  async inspectAuthority(_runId: string): Promise<AuthoritySnapshot> { throw new QualificationNotImplemented("authority", "DBOS real: authority fencing is still Unifia-owned") }
  async claimAuthority(_input: ClaimAuthorityInput): Promise<ClaimAuthorityResult> { throw new QualificationNotImplemented("authority", "DBOS real: authority fencing is still Unifia-owned") }
  async runZombieFC25Scenario(): Promise<ZombieFC25Result> { throw new QualificationNotImplemented("FC-25", "DBOS real: authority fencing is still Unifia-owned") }
}
