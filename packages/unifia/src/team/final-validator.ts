// =============================================================================
// final-validator.ts — TEAM-I05
//
// Decides whether a run may claim it achieved its objective.
//
// The single rule this module exists to enforce: a run cannot be reported
// COMPLETE while a required task is missing, unfinished, or merely
// *asserted* to have passed. Everything else here — the not-run inventory,
// the proof requirement, the rollback status — exists to make that rule
// impossible to satisfy by accident.
//
// Two design choices follow from that:
//
//   A required task with no proof is NOT_RUN, not passed. Somewhere between
//   "we ran it" and "it passed" sits "someone said it passed", and that is
//   the state this validator refuses to let through. A claim of success
//   without a proof reference is treated exactly like never having run.
//
//   COMPLETE is the narrow case, not the default. The verdict starts from
//   what is missing and only becomes COMPLETE when nothing is. An
//   INCOMPLETE run with everything green is still INCOMPLETE if a required
//   task was never attempted.
//
// Pure: no LLM, network, clock or filesystem access.
// =============================================================================

export const FINAL_VALIDATOR_SCHEMA_VERSION = "1.0.0" as const;

export class FinalValidatorInputError extends TypeError {
  constructor(message: string) {
    super(message);
    this.name = "FinalValidatorInputError";
  }
}

// -----------------------------------------------------------------------
// Inputs
// -----------------------------------------------------------------------

export type TaskOutcome = "PASSED" | "FAILED" | "NOT_RUN" | "SKIPPED";

export interface ValidatedTask {
  readonly taskId: string;
  /** A task the objective depends on. Required tasks gate COMPLETE. */
  readonly required: boolean;
  readonly outcome: TaskOutcome;
  /**
   * Where the outcome can be verified — a command output, a test report, a
   * commit. A PASSED claim without one is downgraded to NOT_RUN.
   */
  readonly proofRef: string | null;
  /** Why a task was skipped. Required for SKIPPED, ignored otherwise. */
  readonly skipReason?: string;
}

export type RollbackStatus = "NOT_REQUIRED" | "TESTED" | "UNTESTED" | "FAILED";

export interface FinalValidationRequest {
  readonly runId: string;
  readonly objective: string;
  readonly tasks: readonly ValidatedTask[];
  readonly rollbackStatus: RollbackStatus;
  /** Acceptance criteria of the objective itself, each with its own proof. */
  readonly acceptanceCriteria: readonly AcceptanceCriterion[];
}

export interface AcceptanceCriterion {
  readonly id: string;
  readonly statement: string;
  readonly satisfied: boolean;
  readonly proofRef: string | null;
}

// -----------------------------------------------------------------------
// Outputs
// -----------------------------------------------------------------------

export type FinalVerdict = "COMPLETE" | "INCOMPLETE" | "FAILED";

export type BlockingReasonKind =
  | "REQUIRED_TASK_NOT_RUN"
  | "REQUIRED_TASK_FAILED"
  | "REQUIRED_TASK_SKIPPED"
  | "REQUIRED_TASK_UNPROVEN"
  | "ACCEPTANCE_CRITERION_UNMET"
  | "ACCEPTANCE_CRITERION_UNPROVEN"
  | "ROLLBACK_FAILED";

export interface BlockingReason {
  readonly kind: BlockingReasonKind;
  readonly subjectId: string;
  readonly detail: string;
}

export interface FinalValidationResult {
  readonly schemaVersion: typeof FINAL_VALIDATOR_SCHEMA_VERSION;
  readonly runId: string;
  readonly verdict: FinalVerdict;
  /** Empty only when the verdict is COMPLETE. */
  readonly blockingReasons: readonly BlockingReason[];
  /** Every required task that did not demonstrably pass, named individually. */
  readonly notRunTaskIds: readonly string[];
  /** Tasks whose PASSED claim carried no proof and was therefore downgraded. */
  readonly unprovenTaskIds: readonly string[];
  readonly rollbackStatus: RollbackStatus;
  readonly requiredTaskCount: number;
  readonly passedRequiredTaskCount: number;
}

// -----------------------------------------------------------------------
// Validation
// -----------------------------------------------------------------------

/**
 * A PASSED outcome only counts with a proof reference.
 *
 * Without this, "PASSED" means "somebody typed PASSED", which is precisely
 * the claim this card exists to stop from reaching a final report.
 */
function effectiveOutcome(task: ValidatedTask): TaskOutcome {
  if (task.outcome === "PASSED" && !hasProof(task.proofRef)) return "NOT_RUN";
  return task.outcome;
}

function hasProof(proofRef: string | null): boolean {
  return proofRef !== null && proofRef.trim().length > 0;
}

export class FinalValidator {
  /**
   * Produce the run's verdict.
   *
   * Never throws for an unfavourable result — an incomplete run is a normal
   * outcome that must be reported, not an exception. Malformed input throws,
   * because a validator that accepts an inconsistent run would produce a
   * verdict nobody can rely on.
   */
  validate(request: FinalValidationRequest): FinalValidationResult {
    validateRequest(request);

    const blockingReasons: BlockingReason[] = [];
    const notRunTaskIds: string[] = [];
    const unprovenTaskIds: string[] = [];
    let passedRequired = 0;

    const required = request.tasks.filter((task) => task.required);
    for (const task of required) {
      const outcome = effectiveOutcome(task);
      if (task.outcome === "PASSED" && outcome === "NOT_RUN") {
        unprovenTaskIds.push(task.taskId);
        blockingReasons.push({
          kind: "REQUIRED_TASK_UNPROVEN",
          subjectId: task.taskId,
          detail: "claimed PASSED with no proof reference, which is indistinguishable from never having run",
        });
        notRunTaskIds.push(task.taskId);
        continue;
      }

      switch (outcome) {
        case "PASSED":
          passedRequired++;
          break;
        case "FAILED":
          blockingReasons.push({
            kind: "REQUIRED_TASK_FAILED",
            subjectId: task.taskId,
            detail: "required task failed",
          });
          break;
        case "SKIPPED":
          blockingReasons.push({
            kind: "REQUIRED_TASK_SKIPPED",
            subjectId: task.taskId,
            detail: `required task was skipped: ${task.skipReason ?? "no reason recorded"}`,
          });
          notRunTaskIds.push(task.taskId);
          break;
        case "NOT_RUN":
          blockingReasons.push({
            kind: "REQUIRED_TASK_NOT_RUN",
            subjectId: task.taskId,
            detail: "required task was never run",
          });
          notRunTaskIds.push(task.taskId);
          break;
      }
    }

    for (const criterion of request.acceptanceCriteria) {
      if (!criterion.satisfied) {
        blockingReasons.push({
          kind: "ACCEPTANCE_CRITERION_UNMET",
          subjectId: criterion.id,
          detail: `acceptance criterion not satisfied: ${criterion.statement}`,
        });
        continue;
      }
      if (!hasProof(criterion.proofRef)) {
        blockingReasons.push({
          kind: "ACCEPTANCE_CRITERION_UNPROVEN",
          subjectId: criterion.id,
          detail: `acceptance criterion claimed satisfied with no proof reference: ${criterion.statement}`,
        });
      }
    }

    if (request.rollbackStatus === "FAILED") {
      blockingReasons.push({
        kind: "ROLLBACK_FAILED",
        subjectId: request.runId,
        detail: "rollback failed, so the run cannot be reported as complete",
      });
    }

    // FAILED is reserved for something actually breaking. A run that merely
    // did not finish is INCOMPLETE — conflating the two would make an
    // unfinished run look like a broken one, and hide real failures among
    // ordinary incompleteness.
    const hasHardFailure = blockingReasons.some(
      (reason) => reason.kind === "REQUIRED_TASK_FAILED" || reason.kind === "ROLLBACK_FAILED",
    );
    const verdict: FinalVerdict =
      blockingReasons.length === 0 ? "COMPLETE" : hasHardFailure ? "FAILED" : "INCOMPLETE";

    return {
      schemaVersion: FINAL_VALIDATOR_SCHEMA_VERSION,
      runId: request.runId,
      verdict,
      blockingReasons,
      notRunTaskIds: [...new Set(notRunTaskIds)].sort(),
      unprovenTaskIds: [...new Set(unprovenTaskIds)].sort(),
      rollbackStatus: request.rollbackStatus,
      requiredTaskCount: required.length,
      passedRequiredTaskCount: passedRequired,
    };
  }
}

function validateRequest(request: FinalValidationRequest): void {
  if (!request.runId.trim()) throw new FinalValidatorInputError("runId must not be empty");
  if (!request.objective.trim()) throw new FinalValidatorInputError("objective must not be empty");

  const seen = new Set<string>();
  for (const task of request.tasks) {
    if (!task.taskId.trim()) throw new FinalValidatorInputError("every task must have a taskId");
    if (seen.has(task.taskId)) throw new FinalValidatorInputError(`duplicate task ${task.taskId}`);
    seen.add(task.taskId);
  }

  const criteria = new Set<string>();
  for (const criterion of request.acceptanceCriteria) {
    if (!criterion.id.trim()) throw new FinalValidatorInputError("every acceptance criterion must have an id");
    if (criteria.has(criterion.id)) {
      throw new FinalValidatorInputError(`duplicate acceptance criterion ${criterion.id}`);
    }
    criteria.add(criterion.id);
  }
}
