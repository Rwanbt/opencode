import { isRetryable, recoverabilityOf, type FailureCategory } from "./failure-classifier";

// =============================================================================
// attempt-manager.ts — TEAM-J03
//
// Owns the lifecycle of an attempt: which worker holds it, when it may be
// reassigned, and — the part that actually matters — which results are still
// allowed to be believed.
//
// Reassignment creates a window where two workers think they own the same
// task. The original was not killed, it was abandoned; it may still be
// running, and it will eventually report. The failure this module exists to
// prevent is that late report being accepted and integrated alongside the
// replacement's, producing the same change twice.
//
//   Late results are rejected by fencing token, not by timing. A result is
//   accepted only if its token is the one currently held. Comparing
//   timestamps or "did we reassign yet" is a race; comparing a monotonic
//   token is not.
//
//   Verified work is never discarded. If an attempt already produced a
//   verified commit, reassignment preserves it — the replacement starts from
//   that commit instead of redoing work that was already reviewed. Throwing
//   away verified work is how a reassignment turns a delay into a regression.
//
//   Quota exhaustion is not reassigned. A permanent failure follows the
//   account, not the worker: handing the same task to another worker on the
//   same exhausted quota just fails again, more slowly. It escalates instead.
//
// Clock-free and pure: the caller supplies time, no LLM, network or git.
// =============================================================================

export const ATTEMPT_MANAGER_SCHEMA_VERSION = "1.0.0" as const;

export class AttemptManagerInputError extends TypeError {
  constructor(message: string) {
    super(message);
    this.name = "AttemptManagerInputError";
  }
}

export type AttemptState = "RUNNING" | "SUCCEEDED" | "FAILED" | "ABANDONED";

export interface AttemptRecord {
  readonly taskId: string;
  readonly attemptNumber: number;
  readonly workerId: string;
  /** Monotonic ownership token. Only the holder's results are believed. */
  readonly fencingToken: number;
  readonly state: AttemptState;
  /** Verified commit produced by this attempt, if any. */
  readonly verifiedCommit: string | null;
  readonly startedAtMs: number;
}

export interface AttemptResult {
  readonly taskId: string;
  readonly fencingToken: number;
  readonly workerId: string;
  readonly succeeded: boolean;
  readonly commit: string | null;
  readonly failureCategory: FailureCategory | null;
}

export type ResultDisposition = "ACCEPTED" | "REJECTED_STALE_TOKEN" | "REJECTED_UNKNOWN_TASK" | "REJECTED_SETTLED";

export interface ResultAcceptance {
  readonly disposition: ResultDisposition;
  readonly detail: string;
  readonly attempt: AttemptRecord | null;
}

export type ReassignmentOutcome = "REASSIGNED" | "ESCALATED" | "REFUSED";

export interface ReassignmentDecision {
  readonly schemaVersion: typeof ATTEMPT_MANAGER_SCHEMA_VERSION;
  readonly outcome: ReassignmentOutcome;
  readonly reason: string;
  /** The new attempt, when one was created. */
  readonly attempt: AttemptRecord | null;
  /** Commit carried over from the abandoned attempt, never dropped. */
  readonly preservedCommit: string | null;
}

export class AttemptManager {
  private readonly attempts = new Map<string, AttemptRecord>();
  private nextToken: number;

  constructor(initialToken = 1) {
    if (!Number.isInteger(initialToken) || initialToken < 1) {
      throw new AttemptManagerInputError("initialToken must be a positive integer");
    }
    this.nextToken = initialToken;
  }

  current(taskId: string): AttemptRecord | null {
    return this.attempts.get(taskId) ?? null;
  }

  start(taskId: string, workerId: string, nowMs: number): AttemptRecord {
    assertId(taskId, "taskId");
    assertId(workerId, "workerId");
    if (this.attempts.has(taskId)) {
      throw new AttemptManagerInputError(`task ${taskId} already has an attempt; use reassign`);
    }
    const attempt: AttemptRecord = {
      taskId,
      attemptNumber: 1,
      workerId,
      fencingToken: this.nextToken++,
      state: "RUNNING",
      verifiedCommit: null,
      startedAtMs: nowMs,
    };
    this.attempts.set(taskId, attempt);
    return attempt;
  }

  /**
   * Accept or reject a reported result.
   *
   * The token check is the whole point: an abandoned worker is still running
   * and will eventually report. Accepting that late report alongside the
   * replacement's is how the same change gets integrated twice.
   */
  submitResult(result: AttemptResult): ResultAcceptance {
    const attempt = this.attempts.get(result.taskId);
    if (!attempt) {
      return {
        disposition: "REJECTED_UNKNOWN_TASK",
        detail: `no attempt is tracked for task ${result.taskId}`,
        attempt: null,
      };
    }
    if (result.fencingToken !== attempt.fencingToken) {
      return {
        disposition: "REJECTED_STALE_TOKEN",
        detail: `result carries token ${result.fencingToken} but the live attempt holds ${attempt.fencingToken}; this worker was reassigned away`,
        attempt,
      };
    }
    if (attempt.state !== "RUNNING") {
      return {
        disposition: "REJECTED_SETTLED",
        detail: `attempt for ${result.taskId} is already ${attempt.state}`,
        attempt,
      };
    }

    const settled: AttemptRecord = {
      ...attempt,
      state: result.succeeded ? "SUCCEEDED" : "FAILED",
      // A successful result's commit becomes verified work; a failure never
      // erases a commit an earlier attempt already had verified.
      verifiedCommit: result.succeeded ? result.commit : attempt.verifiedCommit,
    };
    this.attempts.set(result.taskId, settled);
    return { disposition: "ACCEPTED", detail: "result accepted from the current token holder", attempt: settled };
  }

  /**
   * Hand a task to another worker after a failure.
   *
   * Refuses when the failure follows the account rather than the worker, and
   * always carries any verified commit forward.
   */
  reassign(taskId: string, newWorkerId: string, category: FailureCategory, nowMs: number): ReassignmentDecision {
    assertId(newWorkerId, "newWorkerId");
    const attempt = this.attempts.get(taskId);
    if (!attempt) {
      return {
        schemaVersion: ATTEMPT_MANAGER_SCHEMA_VERSION,
        outcome: "REFUSED",
        reason: `no attempt is tracked for task ${taskId}`,
        attempt: null,
        preservedCommit: null,
      };
    }

    // Quota and auth follow the account, not the worker: another worker on
    // the same exhausted quota fails identically, only later.
    if (category === "QUOTA_EXCEEDED" || category === "AUTH") {
      return {
        schemaVersion: ATTEMPT_MANAGER_SCHEMA_VERSION,
        outcome: "ESCALATED",
        reason: `${category} follows the account rather than the worker; reassigning would fail the same way`,
        attempt: null,
        preservedCommit: attempt.verifiedCommit,
      };
    }

    if (recoverabilityOf(category) === "ESCALATE") {
      return {
        schemaVersion: ATTEMPT_MANAGER_SCHEMA_VERSION,
        outcome: "ESCALATED",
        reason: "failure is not classified well enough to justify another attempt",
        attempt: null,
        preservedCommit: attempt.verifiedCommit,
      };
    }

    if (attempt.state === "SUCCEEDED") {
      return {
        schemaVersion: ATTEMPT_MANAGER_SCHEMA_VERSION,
        outcome: "REFUSED",
        reason: `task ${taskId} already succeeded; reassigning would redo verified work`,
        attempt: null,
        preservedCommit: attempt.verifiedCommit,
      };
    }

    const replacement: AttemptRecord = {
      taskId,
      attemptNumber: attempt.attemptNumber + 1,
      workerId: newWorkerId,
      // A strictly higher token is what invalidates the abandoned worker's
      // eventual report.
      fencingToken: this.nextToken++,
      state: "RUNNING",
      // Verified work is carried, never redone: discarding it turns a delay
      // into a regression.
      verifiedCommit: attempt.verifiedCommit,
      startedAtMs: nowMs,
    };
    this.attempts.set(taskId, replacement);

    return {
      schemaVersion: ATTEMPT_MANAGER_SCHEMA_VERSION,
      outcome: "REASSIGNED",
      reason: isRetryable(category)
        ? `transient ${category}; handed to ${newWorkerId} with a fresh token`
        : `${category} suggests this worker cannot proceed; handed to ${newWorkerId} with a fresh token`,
      attempt: replacement,
      preservedCommit: replacement.verifiedCommit,
    };
  }
}

function assertId(value: string, name: string): void {
  if (!value.trim()) throw new AttemptManagerInputError(`${name} must not be empty`);
}
