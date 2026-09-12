import type { ReviewFinding, ReviewResult, ReviewVerdict } from "./review-runtime";

// =============================================================================
// repair-coordinator.ts — TEAM-I02
//
// Turns a CHANGES_REQUESTED review verdict into a new, bounded repair
// attempt. It never edits the attempt that was reviewed: a reviewed commit is
// evidence, and rewriting it would invalidate the verdict that refers to it.
// Each repair is a fresh attempt with its own fencing token, carrying forward
// the parts the reviewer already approved as frozen.
//
// Three properties the card requires, and where they live here:
//
//   No mutation of a reviewed attempt   `planRepair` only ever produces a new
//                                       attempt descriptor. The reviewed
//                                       commit is copied into it as an
//                                       immutable parent reference, and the
//                                       frozen paths are refused to writers.
//
//   Cost tracked                        Every attempt carries its own usage,
//                                       and the coordinator accumulates the
//                                       total across the repair chain, so the
//                                       cost of repairing is visible next to
//                                       the cost of the original attempt
//                                       rather than disappearing into it.
//
//   Stop on architecture conflict       A finding that reports an
//                                       architectural conflict is not
//                                       repairable by another local attempt.
//                                       Retrying it would burn attempts on a
//                                       decision only a human can make, so the
//                                       coordinator stops and says so.
//
// Bounded by construction: attempts are capped, and the cap is checked before
// any work is planned rather than after it has been spent.
//
// Pure: no LLM, network, git, clock or filesystem access. The caller supplies
// the review result and the attempt history; the coordinator decides.
// =============================================================================

export const REPAIR_COORDINATOR_SCHEMA_VERSION = "1.0.0" as const;

/** Hard ceiling on attempts for one card, including the original. */
export const DEFAULT_MAX_ATTEMPTS = 3;

// -----------------------------------------------------------------------
// Errors
// -----------------------------------------------------------------------

export class RepairInputError extends TypeError {
  constructor(message: string) {
    super(message);
    this.name = "RepairInputError";
  }
}

// -----------------------------------------------------------------------
// Attempts
// -----------------------------------------------------------------------

export interface AttemptUsage {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly costUsd: number;
}

export interface AttemptRecord {
  readonly attemptNumber: number;
  readonly commit: string;
  readonly workerModelId: string;
  readonly fencingToken: number;
  readonly verdict: ReviewVerdict;
  readonly usage: AttemptUsage;
}

/**
 * Why a repair was refused. Every one of these is a stop rather than a
 * silent downgrade — the coordinator never quietly returns a weaker plan.
 */
export type RepairRefusal =
  | "NOTHING_TO_REPAIR"
  | "MAX_ATTEMPTS_REACHED"
  | "ARCHITECTURE_CONFLICT"
  | "REVIEW_BLOCKED";

export interface RepairPlan {
  readonly schemaVersion: typeof REPAIR_COORDINATOR_SCHEMA_VERSION;
  readonly cardId: string;
  readonly attemptNumber: number;
  /** Commit the repair starts from. Never rewritten — carried as a parent. */
  readonly parentCommit: string;
  readonly fencingToken: number;
  readonly workerModelId: string;
  /** True when the previous worker was replaced because it already failed twice. */
  readonly escalated: boolean;
  /** Paths the reviewer approved; a repair must not touch them. */
  readonly frozenPaths: readonly string[];
  /** Findings this attempt must address, in reviewer order. */
  readonly targetedFindings: readonly ReviewFinding[];
  readonly attemptsRemaining: number;
  readonly cumulativeUsage: AttemptUsage;
}

export interface RepairRefusalReport {
  readonly schemaVersion: typeof REPAIR_COORDINATOR_SCHEMA_VERSION;
  readonly cardId: string;
  readonly refusal: RepairRefusal;
  readonly reason: string;
  readonly cumulativeUsage: AttemptUsage;
  /** Findings that triggered a stop, when the refusal came from the review. */
  readonly blockingFindings: readonly ReviewFinding[];
}

export type RepairDecision =
  | { readonly outcome: "REPAIR"; readonly plan: RepairPlan }
  | { readonly outcome: "STOP"; readonly report: RepairRefusalReport };

export interface RepairRequest {
  readonly cardId: string;
  readonly review: ReviewResult;
  /** Every attempt so far, oldest first. Must contain at least the reviewed one. */
  readonly attempts: readonly AttemptRecord[];
  /** Paths the reviewer signed off; repairs must leave them untouched. */
  readonly approvedPaths: readonly string[];
  /** Monotonic token for the next attempt. Must exceed every prior token. */
  readonly nextFencingToken: number;
  /** Model to escalate to when the current worker has failed twice. */
  readonly escalationModelId?: string;
  readonly maxAttempts?: number;
}

// -----------------------------------------------------------------------
// Architecture-conflict detection
// -----------------------------------------------------------------------

/**
 * Markers a reviewer uses to say "this cannot be fixed by editing this card".
 * Matched case-insensitively against a finding's title and remediation.
 *
 * Kept explicit rather than inferred from severity: a P0 is usually a bug to
 * fix, while an architectural conflict can arrive at any severity and means
 * something categorically different — that the card's premise is wrong, not
 * its implementation.
 */
const ARCHITECTURE_CONFLICT_MARKERS = [
  "architecture conflict",
  "architectural conflict",
  "contradicts a frozen decision",
  "requires an adr",
  "requires a plan change",
  "scope expansion required",
] as const;

export function isArchitectureConflict(finding: ReviewFinding): boolean {
  const haystack = `${finding.title} ${finding.remediation}`.toLowerCase();
  return ARCHITECTURE_CONFLICT_MARKERS.some((marker) => haystack.includes(marker));
}

// -----------------------------------------------------------------------
// Usage accumulation
// -----------------------------------------------------------------------

const ZERO_USAGE: AttemptUsage = Object.freeze({ inputTokens: 0, outputTokens: 0, costUsd: 0 });

export function accumulateUsage(attempts: readonly AttemptRecord[]): AttemptUsage {
  return attempts.reduce<AttemptUsage>(
    (total, attempt) => ({
      inputTokens: total.inputTokens + attempt.usage.inputTokens,
      outputTokens: total.outputTokens + attempt.usage.outputTokens,
      costUsd: total.costUsd + attempt.usage.costUsd,
    }),
    ZERO_USAGE,
  );
}

// -----------------------------------------------------------------------
// Coordinator
// -----------------------------------------------------------------------

export class RepairCoordinator {
  /**
   * Decide whether the reviewed attempt can be repaired, and how.
   *
   * Returns a STOP report rather than throwing for every *expected* refusal
   * (nothing to repair, attempts exhausted, architectural conflict), because
   * those are normal outcomes a caller must record. Malformed input still
   * throws: a coordinator that quietly accepts an inconsistent attempt
   * history would produce a plan nobody can trust.
   */
  plan(request: RepairRequest): RepairDecision {
    validateRequest(request);

    const maxAttempts = request.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
    const cumulativeUsage = accumulateUsage(request.attempts);
    const reviewed = request.attempts[request.attempts.length - 1]!;

    const stop = (refusal: RepairRefusal, reason: string, blockingFindings: readonly ReviewFinding[] = []) => ({
      outcome: "STOP" as const,
      report: {
        schemaVersion: REPAIR_COORDINATOR_SCHEMA_VERSION,
        cardId: request.cardId,
        refusal,
        reason,
        cumulativeUsage,
        blockingFindings,
      },
    });

    if (request.review.verdict === "APPROVED") {
      return stop("NOTHING_TO_REPAIR", "review verdict is APPROVED; there is nothing to repair");
    }
    if (request.review.verdict === "BLOCKED") {
      return stop(
        "REVIEW_BLOCKED",
        "review is BLOCKED, so no verdict authorises a repair attempt",
        request.review.findings,
      );
    }

    const conflicts = request.review.findings.filter(isArchitectureConflict);
    if (conflicts.length > 0) {
      return stop(
        "ARCHITECTURE_CONFLICT",
        "at least one finding reports an architectural conflict, which another local attempt cannot resolve",
        conflicts,
      );
    }

    // Checked before planning, not after spending: the cap counts the
    // attempt we are about to authorise.
    if (request.attempts.length >= maxAttempts) {
      return stop(
        "MAX_ATTEMPTS_REACHED",
        `attempt cap of ${maxAttempts} reached after ${request.attempts.length} attempt(s)`,
      );
    }

    const failuresByCurrentWorker = request.attempts.filter(
      (attempt) => attempt.workerModelId === reviewed.workerModelId && attempt.verdict !== "APPROVED",
    ).length;
    const shouldEscalate = failuresByCurrentWorker >= 2 && request.escalationModelId !== undefined;

    return {
      outcome: "REPAIR",
      plan: {
        schemaVersion: REPAIR_COORDINATOR_SCHEMA_VERSION,
        cardId: request.cardId,
        attemptNumber: reviewed.attemptNumber + 1,
        parentCommit: reviewed.commit,
        fencingToken: request.nextFencingToken,
        workerModelId: shouldEscalate ? request.escalationModelId! : reviewed.workerModelId,
        escalated: shouldEscalate,
        frozenPaths: [...request.approvedPaths].sort(),
        targetedFindings: request.review.findings,
        attemptsRemaining: maxAttempts - request.attempts.length - 1,
        cumulativeUsage,
      },
    };
  }
}

// -----------------------------------------------------------------------
// Validation
// -----------------------------------------------------------------------

function validateRequest(request: RepairRequest): void {
  if (!request.cardId.trim()) throw new RepairInputError("cardId must not be empty");
  if (request.attempts.length === 0) {
    throw new RepairInputError("attempts must contain at least the reviewed attempt");
  }
  if (request.review.cardId !== request.cardId) {
    throw new RepairInputError(
      `review targets card ${request.review.cardId} but the request is for ${request.cardId}`,
    );
  }

  const maxAttempts = request.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1) {
    throw new RepairInputError("maxAttempts must be a positive integer");
  }

  // The reviewed attempt's verdict and the review result describe the same
  // fact. Letting them disagree gave the coordinator two sources of truth:
  // it authorised the repair from `review.verdict` while counting escalation
  // failures from `attempt.verdict`, so a contradictory history could repair
  // an attempt recorded as APPROVED and silently never escalate.
  const reviewed = request.attempts[request.attempts.length - 1]!;
  if (reviewed.verdict !== request.review.verdict) {
    throw new RepairInputError(
      `reviewed attempt ${reviewed.attemptNumber} records verdict ${reviewed.verdict} but the review result says ${request.review.verdict}`,
    );
  }

  let previousNumber = 0;
  let previousToken = Number.NEGATIVE_INFINITY;
  let highestToken = Number.NEGATIVE_INFINITY;
  for (const attempt of request.attempts) {
    if (!attempt.commit.trim()) throw new RepairInputError("every attempt must record a commit");
    if (attempt.attemptNumber <= previousNumber) {
      throw new RepairInputError("attempts must be ordered by strictly increasing attemptNumber");
    }
    // Two attempts sharing a token means fencing was already violated before
    // this coordinator was called. Building a new attempt on top of that
    // history would extend an ordering that is known to be broken.
    if (attempt.fencingToken <= previousToken) {
      throw new RepairInputError(
        `attempt ${attempt.attemptNumber} has fencing token ${attempt.fencingToken}, which does not exceed the previous attempt's ${previousToken}`,
      );
    }
    previousNumber = attempt.attemptNumber;
    previousToken = attempt.fencingToken;
    highestToken = Math.max(highestToken, attempt.fencingToken);
    for (const [name, value] of [
      ["inputTokens", attempt.usage.inputTokens],
      ["outputTokens", attempt.usage.outputTokens],
      ["costUsd", attempt.usage.costUsd],
    ] as const) {
      if (!Number.isFinite(value) || value < 0) {
        throw new RepairInputError(`attempt usage ${name} must be a non-negative finite number`);
      }
    }
  }

  // A repair reusing or lowering a token could be mistaken for the attempt it
  // replaces, which is exactly what fencing exists to prevent.
  if (request.nextFencingToken <= highestToken) {
    throw new RepairInputError(
      `nextFencingToken ${request.nextFencingToken} must exceed every prior token (highest ${highestToken})`,
    );
  }
}
