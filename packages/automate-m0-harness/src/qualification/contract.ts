/* SPDX-License-Identifier: MIT */
/* Copyright (c) 2026 Unifia contributors */

/**
 * M0 substrate-neutral qualification contract (ADR-000 §6/§7, post review v1.1).
 *
 * This module defines the interface a candidate durable authority must
 * implement to be measured by the M0 harness. It is the boundary the
 * common oracle drives; no candidate-specific logic may live here.
 *
 * Both `UNIFIA_NATIVE` and `DBOS_GO_SQLITE` are scored against exactly
 * this contract, on exactly the same fixtures, with exactly the same
 * result schema. A FAIL here is a FAIL for that candidate — there is
 * no "adapters see a different oracle" loophole.
 *
 * Per pack gelé §4 (interdiction de pré-sélection) :
 *   - No candidate is favored
 *   - The harness cannot inherit an M1 decision
 *   - Common oracle != candidate implementation
 */

import type {
  AuthorityGeneration,
  AuthorityKind,
  WorkflowRunId,
  WorkflowVersionId,
  LogicalInvocationId,
  AttemptId,
  ApprovalId,
  DurableTimerId,
  EffectId,
  SchemaVersion,
  UnifiaValue,
} from "@unifia/automate-m0-contract"

/* ------------------------------------------------------------------ */
/* Candidate info                                                      */
/* ------------------------------------------------------------------ */

/** Identity of the candidate durable authority. */
export interface CandidateInfo {
  readonly kind: AuthorityKind
  /** Exact pinned version (no `latest`, no `1.0+`). */
  readonly version: string
  /** Free-form commit / build / hash for reproducibility. */
  readonly buildHash: string
  /** Native storage driver + configuration (SQLite journal_mode etc.). */
  readonly storage: CandidateStorageConfig
  /** Process model and IPC. */
  readonly process: CandidateProcessConfig
}

export interface CandidateStorageConfig {
  /** e.g. `SQLite 3.46.1`, `LMDB 0.9.31`, `BadgerDB v4`. */
  readonly engine: string
  /** e.g. `better-sqlite3 13.0.3`, `mattn/go-sqlite3 v1.14.22`. */
  readonly driver: string
  /** `WAL`, `DELETE`, `MEMORY`. */
  readonly journalMode: string
  /** `FULL`, `NORMAL`, `OFF`. */
  readonly synchronous: string
  /** Milliseconds. */
  readonly busyTimeoutMs: number
  /** Max open SQLite connections held by the candidate. */
  readonly maxOpenConns: number
  /** Where backups go. */
  readonly backupTarget: "file" | "stdout" | "memory"
}

export interface CandidateProcessConfig {
  /** `in-process`, `child-process`, `sidecar`, `remote`. */
  readonly topology: string
  /** IPC mechanism if cross-process. */
  readonly ipc?: string
  /** Whether the candidate supports multi-process access to the same store. */
  readonly multiProcessSafe: boolean
  /** Process health endpoint. */
  readonly healthEndpoint?: string
}

/* ------------------------------------------------------------------ */
/* Run lifecycle                                                       */
/* ------------------------------------------------------------------ */

/** What the harness needs to start a run. */
export interface StartRunInput {
  readonly workflowVersionId: WorkflowVersionId
  readonly ownerScope: { readonly organizationId: string; readonly workspaceId: string }
  readonly initialLogicalInvocation: {
    readonly logicalInvocationId: LogicalInvocationId
    readonly effectKey: string
    /** Already-canonical value (FC-31A path). */
    readonly canonicalInput: UnifiaValue
  }
  /** Already-canonical value persisted alongside the run. */
  readonly seedCanonicalValue: UnifiaValue
}

/** Canonical state a candidate must expose to the harness. */
export interface CanonicalRunState {
  readonly runId: WorkflowRunId
  readonly authorityGeneration: AuthorityGeneration
  readonly status: "PENDING" | "RUNNING" | "WAITING_APPROVAL" | "WAITING_TIMER" | "COMPLETED" | "FAILED" | "CANCELLED"
  readonly logicalInvocations: readonly CanonicalInvocationState[]
  readonly approvalIds: readonly ApprovalId[]
  readonly durableTimerIds: readonly DurableTimerId[]
  readonly effectIds: readonly EffectId[]
  /** Schema version the candidate currently understands. */
  readonly schemaVersion: SchemaVersion
  /** Monotonic attempt counter the candidate assigns to its next retry. */
  readonly nextAttemptId: number
}

export interface CanonicalInvocationState {
  readonly logicalInvocationId: LogicalInvocationId
  readonly attempts: readonly CanonicalAttemptState[]
  readonly currentAttemptId: AttemptId
  readonly canonicalObservation: UnifiaValue | null
  readonly terminal: boolean
}

export interface CanonicalAttemptState {
  readonly attemptId: AttemptId
  readonly startedAtEpochMs: number
  readonly completedAtEpochMs: number | null
  readonly status: "RUNNING" | "SUCCEEDED" | "FAILED" | "CANCELLED" | "UNKNOWN_EXTERNAL_STATE"
  readonly canonicalOutput: UnifiaValue | null
  readonly effectId: EffectId
}

/* ------------------------------------------------------------------ */
/* Approval minimal contract (D-02 V3, post pack-gelé review 2026-09-03) */
/* ------------------------------------------------------------------ */

/**
 * Canonical execution-plan digest. Per ADR-0007 V3 (CP7): the
 * approval is bound to the digest of the immutable ExecutionPlan
 * the request was made for; the resolve call MUST present the
 * current digest. A mismatch STALE's the approval.
 *
 * Use a branded type so adapters cannot silently widen `string` to
 * any UTF-8 string. The actual canonical digest is computed per
 * ADR-033 / ADR-001 (canonical value encoding).
 */
export type ExecutionPlanDigest = string & { readonly __brand: "ExecutionPlanDigest" }

/** What the harness needs to drive the approval-durability tests. */
export interface ApprovalRequestInput {
  /**
   * Per pack gelé §18: ApprovalId is DETERMINISTIC per
   * (workflowRunId, logicalInvocationId, executionPlanDigest,
   * ordinal, requestGeneration). Adapters MUST derive it from
   * these fields; passing a non-deterministic id is a contract
   * violation.
   */
  readonly approvalId: ApprovalId
  readonly runId: WorkflowRunId
  readonly logicalInvocationId: LogicalInvocationId
  /** Digest of the immutable ExecutionPlan this approval is bound to. */
  readonly executionPlanDigest: ExecutionPlanDigest
  /**
   * Per pack gelé §17: the requester principal. The resolve
   * call's actor MUST NOT be the requester principal (no
   * self-approval).
   */
  readonly requesterPrincipalId: string
  /** Ordinal of this approval within the (runId, liId, planDigest) family. */
  readonly ordinal: number
  /** Request generation — distinct approvals on the same family get distinct generations. */
  readonly requestGeneration: number
  readonly ownershipScope: { readonly organizationId: string; readonly workspaceId: string }
  /** Expiry wall-clock — fail-closed past this point. */
  readonly expiresAtEpochMs: number
  readonly createdAtEpochMs: number
}

export type ApprovalState = "PENDING" | "APPROVED" | "DENIED" | "EXPIRED" | "CANCELLED" | "STALE"

export interface ApprovalResolveInput {
  /**
   * Per pack gelé §16: the current ExecutionPlan digest at the
   * moment of resolve. The adapter MUST verify it matches the
   * stored digest; a mismatch transitions the approval to
   * STALE and the resolve is REJECTED.
   */
  readonly currentExecutionPlanDigest: ExecutionPlanDigest
  /** Optional reason for audit (DENIED or APPROVED). */
  readonly reason?: string
}

export interface ApprovalOutcome {
  readonly approvalId: ApprovalId
  readonly state: ApprovalState
  /** Actor that resolved, if any. */
  readonly actor?: { readonly id: string }
  readonly resolvedAtEpochMs?: number
  /** Reason set on CANCELLED / EXPIRED / STALE / resolution. */
  readonly reason?: string
}

/**
 * Append-only history event for an approval. Per pack gelé §21:
 * the broker records EVERY state transition as an event, not as a
 * replace of the ApprovalRequest. The history is replayable and
 * auditable.
 */
export type ApprovalHistoryEventType =
  | "REQUESTED"
  | "APPROVED"
  | "DENIED"
  | "EXPIRED"
  | "CANCELLED"
  | "STALE_PLAN_CHANGED"
  | "STALE_DIGEST_MISMATCH"
  | "REPLAYED_RESOLVE"  // idempotent re-resolve of an already-resolved approval

export interface ApprovalHistoryEvent {
  readonly eventId: string
  readonly approvalId: ApprovalId
  readonly eventType: ApprovalHistoryEventType
  readonly previousState: ApprovalState | null
  readonly newState: ApprovalState
  /** Actor for resolve / cancel events; null for system events (EXPIRED, STALE_*, etc.). */
  readonly actorId: string | null
  /** Wall-clock CanonicalTimestamp when the event was recorded. */
  readonly timestampEpochMs: number
  /** Optional reason / detail (denial reason, plan-change reason, etc.). */
  readonly reason: string | null
  /** Plan digest at the time of the event (for STALE_PLAN_CHANGED). */
  readonly executionPlanDigest: ExecutionPlanDigest | null
}

export type ApprovalActorKind = "PRINCIPAL" | "SYSTEM_EXPIRY" | "SYSTEM_CANCEL" | "SYSTEM_STALE"

/* ------------------------------------------------------------------ */
/* Timer minimal contract                                              */
/* ------------------------------------------------------------------ */

export interface DurableTimerRequest {
  readonly timerId: DurableTimerId
  readonly runId: WorkflowRunId
  readonly logicalInvocationId: LogicalInvocationId
  /** Wall-clock the timer should fire at. */
  readonly fireAtEpochMs: number
}

export type TimerState = "PENDING" | "FIRED" | "CANCELLED" | "EXPIRED"

export interface DurableTimerSnapshot {
  readonly timerId: DurableTimerId
  readonly state: TimerState
  readonly fireAtEpochMs: number
  readonly firedAtEpochMs?: number
  /** Whether the candidate recorded this timer across the most recent restart. */
  readonly survivedRestart: boolean
}

/* ------------------------------------------------------------------ */
/* Backup / restore                                                    */
/* ------------------------------------------------------------------ */

export interface BackupRef {
  /** Opaque handle the candidate returns. */
  readonly handle: string
  /** Bytes-size of the backup for resource accounting. */
  readonly sizeBytes: number
  /** Wall-clock the backup was taken. */
  readonly takenAtEpochMs: number
  /** `engine-native` (e.g. SQLite .backup API) or `app-level`. */
  readonly kind: "engine-native" | "app-level"
}

/* ------------------------------------------------------------------ */
/* Diagnostics                                                         */
/* ------------------------------------------------------------------ */

export interface CandidateDiagnostics {
  readonly info: CandidateInfo
  /** Effective schema version the candidate has. */
  readonly currentSchemaVersion: SchemaVersion
  /** Pinned authority generation. */
  readonly authorityGeneration: AuthorityGeneration
  /** Number of durable runs in the store. */
  readonly runs: number
  /** Number of pending approvals. */
  readonly pendingApprovals: number
  /** Number of durable timers. */
  readonly durableTimers: number
  /** Number of effects in the ledger. */
  readonly effectLedgerSize: number
}

/* ------------------------------------------------------------------ */
/* THE candidate interface (substrate-neutral)                         */
/* ------------------------------------------------------------------ */

/** Lossless typed-fixture descriptor for the FC-31B host-adapter endpoint.
 *
 * The payload travels as its exact JSON literal text (decimal string or
 * number literal) so no host float parsing happens before the candidate's
 * host materializes the value.
 */
export interface HostAdapterFixture {
  readonly caseId: string
  readonly encoding: string
  readonly payload: unknown
}

/** Verdict emitted by the candidate's own host for one FC-31B fixture. */
export interface HostAdapterVerdict {
  readonly outcome: "pass" | "reject"
  readonly code?: string
  /** The actual host type that materialized the value (e.g. int64, uint64, float64, time.Time). */
  readonly goType: string
  readonly canonical?: {
    readonly kind: string
    readonly bits?: string
    readonly decimal?: string
    readonly epochMs?: string
  }
}
/**
 * What every candidate MUST implement to be scored. The common oracle
 * drives this. No candidate-specific logic lives here.
 *
 * The contract is deliberately small — anything not in this contract
 * is not measured. Anything in this contract is measured the same way
 * for every candidate.
 */
export interface DurableWorkflowAuthorityQualificationAdapter {
  /** Identity the candidate declares at the start of qualification. */
  candidateInfo(): Promise<CandidateInfo>

  /** Open a connection / process / store. Idempotent. */
  initialize(): Promise<void>
  /** Close cleanly. Idempotent. */
  shutdown(): Promise<void>

  /**
   * Start a run with an effect that will be dispatched against the
   * harness's fake external provider. The candidate must record the
   * run + initial logical invocation + attempt durably.
   */
  startRun(input: StartRunInput): Promise<WorkflowRunId>

  /**
   * Returns the canonical state the candidate exposes. The harness
   * uses this to verify invariant assertions (FC-31A etc.).
   */
  inspectRun(runId: WorkflowRunId): Promise<CanonicalRunState>

  /**
   * Drive a single attempt to completion against the (mock) external
   * provider. The candidate is given the provider's response in
   * `providerResponse`; the harness will inject ACK loss / provider
   * success / provider failure / unknown as needed.
   */
  driveAttempt(
    runId: WorkflowRunId,
    logicalInvocationId: LogicalInvocationId,
    providerResponse: ProviderResolution,
  ): Promise<CanonicalAttemptState>

  /** Submit an approval request. */
  provideApproval(request: ApprovalRequestInput): Promise<void>

  /**
   * Resolve an approval. `actor` is mandatory.
   *
   * Per pack gelé §16-§17: the resolve call MUST present the
   * CURRENT ExecutionPlan digest. The adapter verifies it
   * matches the stored digest; a mismatch transitions the
   * approval to STALE and the resolve is REJECTED (no state
   * mutation). The actor MUST NOT be the requester principal
   * (no self-approval). Second call on a resolved approval
   * is idempotent (same outcome, no state mutation) or returns
   * APPROVAL_ALREADY_RESOLVED for a conflicting decision.
   */
  resolveApproval(
    approvalId: ApprovalId,
    state: "APPROVED" | "DENIED",
    actor: { readonly id: string; readonly kind: "PRINCIPAL" },
    currentResolve: ApprovalResolveInput,
  ): Promise<ApprovalOutcome>

  /**
   * Cancel a PENDING approval. The actor MUST be the requester
   * principal OR a principal with cancel authority for the run.
   */
  cancelApproval(
    approvalId: ApprovalId,
    actor: { readonly id: string; readonly kind: "PRINCIPAL" | "SYSTEM_CANCEL" },
    reason: string,
  ): Promise<ApprovalOutcome>

  /**
   * Return the append-only history of events for an approval.
   * Per pack gelé §21: every state transition is an event.
   */
  approvalHistory(approvalId: ApprovalId): Promise<readonly ApprovalHistoryEvent[]>

  /** Inspect an approval (read-only). */
  inspectApproval(approvalId: ApprovalId): Promise<ApprovalOutcome>

  /** Schedule a durable timer. */
  scheduleTimer(request: DurableTimerRequest): Promise<void>

  /** Inspect a durable timer. */
  inspectTimer(timerId: DurableTimerId): Promise<DurableTimerSnapshot>

  /** Force the candidate to "appear crashed" — for restart tests. */
  forceProcessCrash(): Promise<void>

  /**
   * Reopen the store from disk. For an in-process candidate this
   * constructs a fresh instance; for a child process this starts a
   * new process and reconnects.
   */
  reopen(): Promise<void>

  /** Take a consistent backup of the store. */
  createBackup(): Promise<BackupRef>

  /** Restore from a backup. The candidate store is wiped. */
  restoreBackup(ref: BackupRef): Promise<void>

  /** Full history of a run, in canonical form. */
  inspectHistory(runId: WorkflowRunId): Promise<readonly CanonicalRunState[]>

  /** Lightweight diagnostics. */
  diagnostics(): Promise<CandidateDiagnostics>
  /* -------------------------------------------------------------- */
  /* FC-31B host-adapter canonization (optional capability)          */
  /* -------------------------------------------------------------- */

  /**
   * FC-31B through the candidate's REAL host. A child-process candidate
   * whose binary exposes a typed host-adapter endpoint implements this to
   * let the harness drive the frozen FC-31B vectors through the host's
   * own conversion (the Go process materializes int64/uint64/float64/
   * time.Time itself). Absent => the FC-31B child-process branch stays
   * NOT_VALID for that candidate.
   */
  canonizeViaHost?(fixture: HostAdapterFixture): Promise<HostAdapterVerdict>

  /* -------------------------------------------------------------- */
  /* FC-14 / FC-25 substrate-neutral authority capabilities         */
  /* -------------------------------------------------------------- */

  /**
   * Race two authority-claim participants for a single run.
   *
   * The harness calls this from a common barrier so both
   * participants enter the race at the same time. The adapter
   * is responsible for the substrate-native mechanism: spawning
   * a child process, opening a second SQLite connection, or
   * using a second HTTP loopback. The result is one winner and
   * one loser (exactly).
   *
   * `concurrentRace = true` is required for FC-14 PASS.
   * `distinctOsProcesses >= 2` is required for FC-14 PASS on a
   * child-process / sidecar / remote candidate. An in-process
   * race (two Database handles in one process) is explicitly
   * NOT sufficient for FC-14 PASS — it can only support a
   * conformance primitive, not a qualification criterion.
   */
  raceAuthorities(input: RaceAuthoritiesInput): Promise<RaceAuthoritiesResult>

  /**
   * Attempt an authoritative mutation under a given (generation,
   * authorityOwnerId) token. The adapter MUST verify the token
   * matches the currently persisted authority state. On
   * mismatch, return `{ accepted: false, reason: "STALE_AUTHORITY" }`
   * without mutating state.
   *
   * Used by FC-14 to prove the winner can ACT on its authority
   * (not merely own the run_authority row) and the loser is
   * rejected at the mutate boundary.
   */
  attemptAuthoritativeMutation(
    input: AuthoritativeMutationInput,
  ): Promise<AuthoritativeMutationResult>

  /**
   * Attempt an external effect-dispatch authorization under a
   * given token. Same fencing rules as
   * `attemptAuthoritativeMutation`. Used by FC-14 to prove the
   * winner's dispatch is authorized and the loser's is rejected.
   */
  attemptEffectDispatch(
    input: EffectDispatchInput,
  ): Promise<EffectDispatchResult>

  /**
   * Forcibly take over authority for a run. The previous owner
   * is NOT released; the new owner receives a higher
   * generation. This is a QUALIFICATION-ONLY primitive: it
   * exercises the FC-25 zombie-fencing scenario. Production
   * failover is governed by ADR-008 and is out of M0 scope.
   */
  forceQualificationTakeover(
    input: QualificationTakeoverInput,
  ): Promise<QualificationTakeoverResult>

  /**
   * Read the current persisted authority state for a run.
   * Returns generation + owner id (and process id when known).
   */
  inspectAuthority(runId: WorkflowRunId): Promise<AuthoritySnapshot>

  /**
   * Initial authority claim. The adapter creates the
   * `run_authority` row at gen=1 with the given ownerId
   * (or returns the existing row if already claimed). This is
   * used by the FC-25 scenario to install ownerA before the
   * takeover; it is NOT used by FC-14 (which uses
   * `raceAuthorities` for a true 2-process race).
   */
  claimAuthority(input: ClaimAuthorityInput): Promise<ClaimAuthorityResult>

  /**
   * FC-25 REAL ZOMBIE-PROCESS SCENARIO (per pack gelé §13-§15
   * of the final M0 closure 2026-09-04). The adapter
   * orchestrates the end-to-end zombie process:
   *
   *   1. Spawn process A (a long-lived process that holds
   *      its own local token).
   *   2. A claims authority at gen=1 (its OWN process id is
   *      the holder; no parent adapter involvement).
   *   3. A REACHES A FREEZE BARRIER over IPC (typically a
   *      long-poll on a /await-resume endpoint). A's process
   *      is alive (PID running) but blocked. The harness
   *      observes `distinctOsProcesses >= 2` and
   *      `oldOwnerAliveDuringTakeover = true`.
   *   4. Takeover: the adapter increments gen=2 and assigns
   *      ownerB via its in-process primitive.
   *   5. ownerB commits an authoritative mutation under
   *      gen=2 (accepted).
   *   6. Resume A: the harness signals A to continue.
   *   7. A attempts stale mutate with its locally retained
   *      gen=1 token (must be REJECTED).
   *   8. A attempts stale dispatch with its locally retained
   *      gen=1 token (must be REJECTED).
   *
   * PASS requires all 4 post-resume observations, plus
   * `oldOwnerAliveDuringTakeover = true` (machine-confirmed
   * by the freeze barrier being successfully observed).
   */
  runZombieFC25Scenario(): Promise<ZombieFC25Result>
}

export interface ClaimAuthorityInput {
  readonly runId: WorkflowRunId
  readonly authorityOwnerId: string
}

export type ClaimAuthorityResult =
  | { readonly granted: true; readonly currentGeneration: AuthorityGeneration; readonly currentAuthorityOwnerId: string; readonly holderPid: number | null }
  | { readonly granted: false; readonly reason: "ALREADY_CLAIMED_BY_OTHER"; readonly currentGeneration: AuthorityGeneration; readonly currentAuthorityOwnerId: string }

/* ------------------------------------------------------------------ */
/* FC-14 / FC-25 capability inputs and outputs                        */
/* ------------------------------------------------------------------ */

export interface AuthorityToken {
  readonly runId: WorkflowRunId
  readonly generation: AuthorityGeneration
  readonly authorityOwnerId: string
}

export interface AuthoritySnapshot {
  readonly runId: WorkflowRunId
  readonly generation: AuthorityGeneration
  readonly authorityOwnerId: string
  /** Process id of the current owner, when the adapter can report it. */
  readonly holderPid: number | null
}

export interface RaceAuthoritiesInput {
  readonly runId: WorkflowRunId
  readonly participantA: { readonly authorityOwnerId: string }
  readonly participantB: { readonly authorityOwnerId: string }
  /**
   * The shared store directory the race participants must use.
   * The adapter MAY throw if this does not match its own
   * storeDir; the runner is expected to construct the adapter
   * with a known storeDir and pass the same value here. The
   * substrate-neutral contract does not require the runner to
   * introspect the adapter's storage layout.
   *
   * Pass an empty string to use the adapter's own storeDir.
   */
  readonly sharedStore: string
}

export interface RaceAuthoritiesResult {
  readonly measured: boolean
  /** True if both participants entered the claim path before either observed the outcome. */
  readonly concurrentRace: boolean
  readonly distinctOsProcesses: number
  readonly claimA: AuthorityClaimOutcome
  readonly claimB: AuthorityClaimOutcome
  readonly winner: { readonly authorityOwnerId: string; readonly processLocalOwnerId: string; readonly pid: number | null }
  readonly loser: { readonly authorityOwnerId: string; readonly processLocalOwnerId: string; readonly pid: number | null }
  readonly finalPersistedAuthorityOwnerId: string
  readonly finalGeneration: AuthorityGeneration
}

export interface AuthorityClaimOutcome {
  readonly granted: boolean
  /** When the participant is the loser, this is the WINNER's ownerId (the holder). */
  readonly currentAuthorityOwnerId: string
  readonly currentGeneration: AuthorityGeneration
  readonly attemptedGeneration: AuthorityGeneration
  readonly holderPid: number | null
}

export interface AuthoritativeMutationInput {
  readonly runId: WorkflowRunId
  readonly token: AuthorityToken
  /** Opaque label the adapter may record against the mutation. */
  readonly mutation: string
}

export type AuthoritativeMutationResult =
  | { readonly accepted: true; readonly generation: AuthorityGeneration; readonly authorityOwnerId: string }
  | { readonly accepted: false; readonly reason: "STALE_AUTHORITY" | "UNKNOWN_RUN" | "INVALID_TOKEN"; readonly currentGeneration: AuthorityGeneration | null; readonly currentAuthorityOwnerId: string | null }

export interface EffectDispatchInput {
  readonly runId: WorkflowRunId
  readonly token: AuthorityToken
  /** EffectKey the participant wants to authorize. */
  readonly effectKey: string
}

export type EffectDispatchResult =
  | { readonly accepted: true; readonly effectKey: string; readonly generation: AuthorityGeneration; readonly authorityOwnerId: string }
  | { readonly accepted: false; readonly reason: "STALE_AUTHORITY" | "UNKNOWN_RUN" | "INVALID_TOKEN" | "EFFECT_DUPLICATE"; readonly currentGeneration: AuthorityGeneration | null; readonly currentAuthorityOwnerId: string | null }

export interface QualificationTakeoverInput {
  readonly runId: WorkflowRunId
  /** Generation currently persisted (the holder to be displaced). */
  readonly expectedCurrentGeneration: AuthorityGeneration
  /** New authority owner id. */
  readonly newAuthorityOwnerId: string
}

export type QualificationTakeoverResult =
  | { readonly accepted: true; readonly previousGeneration: AuthorityGeneration; readonly previousAuthorityOwnerId: string; readonly newGeneration: AuthorityGeneration; readonly newAuthorityOwnerId: string }
  | { readonly accepted: false; readonly reason: "GENERATION_MISMATCH" | "UNKNOWN_RUN"; readonly currentGeneration: AuthorityGeneration | null; readonly currentAuthorityOwnerId: string | null }

/**
 * Result of the real FC-25 zombie-process scenario.
 *
 * The four post-resume conditions are MACHINE-OBSERVED; no
 * value is hard-coded by the harness. `oldOwnerAliveDuring-
 * Takeover` is true only if the freeze barrier was actually
 * observed (the long-poll returned with a status that
 * proves the worker was blocked on /await-resume before the
 * takeover was performed).
 */
export interface ZombieFC25Result {
  readonly measured: boolean
  readonly distinctOsProcesses: number
  readonly oldOwnerAliveDuringTakeover: boolean
  readonly oldOwnerDidNotReleaseBeforeTakeover: boolean
  readonly oldOwnerPid: number
  readonly runId: string
  readonly ownerA: string
  readonly ownerB: string
  readonly newGenerationGreaterThanOld: boolean
  readonly newOwnerCommitAccepted: boolean
  readonly staleOwnerCommitRejected: boolean
  readonly staleOwnerDispatchRejected: boolean
  readonly takeover: { readonly previousGeneration: AuthorityGeneration; readonly newGeneration: AuthorityGeneration; readonly previousAuthorityOwnerId: string; readonly newAuthorityOwnerId: string } | { readonly reason: string }
  readonly newOwnerMutate: { readonly accepted: boolean; readonly reason?: string }
  readonly staleMutate: { readonly accepted: boolean; readonly reason?: string }
  readonly staleDispatch: { readonly accepted: boolean; readonly reason?: string }
}

/* ------------------------------------------------------------------ */
/* Provider resolution (what the fake provider says)                  */
/* ------------------------------------------------------------------ */

/**
 * What the fake external provider tells the candidate at attempt time.
 * The harness controls this to simulate success / failure / unknown
 * / ACK loss (FC-04).
 */
export interface ProviderResolution {
  readonly effectKey: string
  readonly outcome: "SUCCEEDED" | "FAILED" | "UNKNOWN"
  /** Already-canonical result the provider claims it persisted. */
  readonly canonicalResult: UnifiaValue | null
  /** If true, the harness records the resolution locally but drops
   *  the ACK to the candidate (FC-04 ACK loss). */
  readonly ackLost: boolean
  /** Provider-side idempotency token to assert on duplicate calls. */
  readonly idempotencyKey: string
  /** Wall-clock the provider says it persisted. */
  readonly providerCommittedAtEpochMs: number
}

/* ------------------------------------------------------------------ */
/* Result taxonomy                                                     */
/* ------------------------------------------------------------------ */

export type QualificationStatus =
  | "PASS"
  | "FAIL_ARCHITECTURAL"
  | "FAIL_CORRECTABLE"
  | "NOT_APPLICABLE"
  | "BLOCKED"
  | "NOT_VALID"
  | "NOT_IMPLEMENTED"
  | "HARNESS_ERROR"

/** Stable identifier of a Functional Criterion. */
export type FunctionalCriterionId =
  | "FC-01" | "FC-02" | "FC-03" | "FC-04" | "FC-05" | "FC-06" | "FC-07" | "FC-08" | "FC-09" | "FC-10"
  | "FC-11" | "FC-12" | "FC-13" | "FC-13-CTRL" | "FC-14" | "FC-15" | "FC-16" | "FC-17" | "FC-18" | "FC-19" | "FC-20"
  | "FC-21" | "FC-22" | "FC-23" | "FC-24" | "FC-25" | "FC-26" | "FC-27" | "FC-28" | "FC-29" | "FC-30"
  | "FC-31A" | "FC-31B" | "FC-32"

/** Single FC result. */
export interface FunctionalCriterionResult {
  readonly testId: FunctionalCriterionId
  readonly candidate: AuthorityKind
  readonly status: QualificationStatus
  readonly evidencePath: string
  /** Commit hash the candidate was pinned to. */
  readonly commit: string
  /** Short human-readable note on what the oracle observed. */
  readonly note: string
  /** Raw observations the harness recorded. */
  readonly observations: { readonly [k: string]: unknown }
}

/** Per-candidate result file. */
export interface CandidateResultFile {
  readonly schemaVersion: 1
  readonly candidate: AuthorityKind
  readonly candidateInfo: CandidateInfo
  readonly results: readonly FunctionalCriterionResult[]
  /** Aggregated tally. */
  readonly summary: {
    readonly pass: number
    readonly failArchitectural: number
    readonly failCorrectable: number
    readonly notApplicable: number
    readonly blocked: number
    readonly notValid: number
  }
  /** Replay model observation per pack gelé §18 (FC-32). */
  readonly replayModel: "YES" | "NO" | "PARTIAL" | "NOT_MEASURED"
  /** When this file was produced. */
  readonly producedAt: string
  /**
   * Self-describing provenance (per Erwan review 2026-09-04).
   * Every canonical M0 result file MUST carry these fields so a
   * reviewer can verify the candidate identity, the source
   * commit, the build hash, and whether real DBOS APIs were on
   * the measured path.
   */
  readonly provenance: ResultProvenance
}

/**
 * Self-describing provenance block on every canonical M0
 * result. The `executionSubstrate` and `realDbosApisUsed`
 * fields are the two key discriminators: they tell the
 * reviewer which execution path produced the result.
 */
export interface ResultProvenance {
  /** Implementation identity (e.g. "CUSTOM_GO_SQLITE_CONTROL@1.0.0", "DBOS_GO_V1@1.0.0"). */
  readonly candidateImplementationId: string
  /** Source commit of the candidate (Go binary or native harness). */
  readonly candidateSourceCommit: string
  /** Build hash of the candidate. */
  readonly candidateBuildHash: string
  /** SHA-256 of the candidate binary, if applicable. */
  readonly candidateBinaryDigest?: string
  /** Source commit of the measurement harness. */
  readonly measurementHarnessCommit: string
  /** Oracle version (the version of the qualification contract). */
  readonly oracleVersion: string
  /** Execution substrate (e.g. "CUSTOM_GO_SQLITE", "DBOS_GO_V1", "UNIFIA_NATIVE_BUN_SQLITE"). */
  readonly executionSubstrate: string
  /** Storage engine (e.g. "SQLite 3.x via bun:sqlite", "SQLite 3.x via modernc.org/sqlite v1.54.0"). */
  readonly storageEngine: string
  /** Adapter identity (e.g. "NativeSqliteCandidate", "DBOSGoCandidate@CUSTOM_GO_SQLITE_CONTROL"). */
  readonly adapterIdentity: string
  /** Whether real DBOS Conductor APIs are on the measured path. */
  readonly realDbosApisUsed: boolean
  /** Platform on which the result was produced. */
  readonly platform: string
  /** Runtime / toolchain (e.g. "Bun 1.3.14 / Go 1.25.12 / Windows 10"). */
  readonly runtime: string
  /**
   * Qualification generation id. Per mandate §26-§29: every
   * canonical file in a single publication shares the same
   * generation id; readers validate that all generation ids
   * are equal (otherwise the publication is torn). Canonical
   * evidence is also STALE when its `candidateSourceCommit`
   * no longer matches the source commit of the candidate code
   * being evaluated.
   */
  readonly qualificationGenerationId: string
  /**
   * Marker that this evidence is current with the source
   * commit recorded in `provenance.candidateSourceCommit`.
   * Computed at publish-time; readers must not trust
   * `CURRENT=false` evidence for ADR-000 scoring.
   */
  readonly evidenceFreshness: "CURRENT" | "STALE"
  /**
   * `true` if the run was performed in `NON_CANONICAL_DIAGNOSTIC_MODE`.
   * Diagnostic results must never be used for ADR-000 scoring.
   */
  readonly nonCanonicalDiagnostic: boolean
}

/** Expected N/A pre-declaration. */
export interface ExpectedNAFile {
  readonly schemaVersion: 1
  readonly candidate: AuthorityKind
  /** A test that the harness expects NOT to apply, with justification. */
  readonly entries: readonly { readonly testId: FunctionalCriterionId; readonly reason: string }[]
  /**
   * Qualification generation id (see `ResultProvenance`).
   * Readers must compare the generation id of the result
   * file, the expected-NA file, and every evidence file
   * in the same publication. A mismatch means the
   * publication is torn and must be re-qualified.
   */
  readonly qualificationGenerationId: string
  /**
   * `true` if the file was produced in
   * `NON_CANONICAL_DIAGNOSTIC_MODE`. Diagnostic expected-NA
   * must never be confused with canonical.
   */
  readonly nonCanonicalDiagnostic: boolean
}

/**
 * Per-evidence-file metadata stamped at publish-time.
 * Written into every `<FC>/result.json` evidence file by
 * `publish()` so readers can validate that all evidence
 * files in a publication share the same generation.
 */
export interface EvidenceMetadata {
  /** Generation id matching the result file's generation. */
  readonly qualificationGenerationId: string
  /** Candidate kind owning this evidence. */
  readonly candidate: AuthorityKind
  /** Functional criterion owning this evidence folder. */
  readonly testId: FunctionalCriterionId
  /** Whether the evidence is current (matches the source commit) or stale. */
  readonly evidenceFreshness: "CURRENT" | "STALE"
  /** Whether the evidence was produced in diagnostic mode. */
  readonly nonCanonicalDiagnostic: boolean
}
