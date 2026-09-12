// =============================================================================
// integration-runtime.ts — TEAM-I04
//
// Plans the topological cherry-pick of verified commits into the integration
// branch, and refuses to plan anything it cannot justify.
//
// This module decides; it does not execute. Git operations are supplied by
// the caller as an adapter, so the ordering, verification and refusal logic
// is testable without a repository, and a dry run is the same code path as a
// real one with a different adapter.
//
// Four rules shape it, in the order they are enforced:
//
//   Primary branches untouched   The integration target is checked against a
//                                protected list before anything else. This
//                                runs first because every later step assumes
//                                it is safe to write somewhere, and that
//                                assumption is the one that must never be
//                                wrong.
//
//   No unverified commit         A commit reaches the plan only with an
//                                approved review AND a matching commit sha.
//                                A review that approves a *different* sha is
//                                not approval of this one — that mismatch is
//                                exactly how a reviewed change and an
//                                integrated change drift apart.
//
//   Topological order            Commits are ordered by their card's
//                                dependencies, so a dependent change never
//                                lands before what it builds on. A cycle is
//                                refused rather than broken arbitrarily.
//
//   Conflict cards               A conflict produces a described refusal
//                                naming the conflicting paths, not a silent
//                                skip and not an automatic resolution.
//
// Pure decision logic: no LLM, network, clock or filesystem access of its own.
// =============================================================================

export const INTEGRATION_RUNTIME_SCHEMA_VERSION = "1.0.0" as const;

/**
 * Branches this runtime must never write to, whatever it is asked.
 * Compared case-insensitively: Git refs are case-sensitive on Linux but not
 * on the Windows and macOS checkouts this program runs on, so "Main" must not
 * become a way past the guard.
 */
export const PROTECTED_BRANCHES: readonly string[] = ["main", "master", "dev", "stable", "opti-ui"];

export class IntegrationInputError extends TypeError {
  constructor(message: string) {
    super(message);
    this.name = "IntegrationInputError";
  }
}

export class ProtectedBranchError extends Error {
  constructor(branch: string) {
    super(`refusing to integrate into protected branch ${branch}`);
    this.name = "ProtectedBranchError";
  }
}

// -----------------------------------------------------------------------
// Inputs
// -----------------------------------------------------------------------

export type IntegrationVerdict = "APPROVED" | "APPROVED_WITH_FOLLOWUP" | "CHANGES_REQUESTED" | "BLOCKED";

const INTEGRABLE_VERDICTS: ReadonlySet<IntegrationVerdict> = new Set(["APPROVED", "APPROVED_WITH_FOLLOWUP"]);

export interface IntegrationCandidate {
  readonly cardId: string;
  readonly commit: string;
  /** Cards this one builds on. Used for topological ordering. */
  readonly dependsOn: readonly string[];
  readonly verdict: IntegrationVerdict;
  /** Commit sha the review actually examined. Must equal `commit`. */
  readonly reviewedCommit: string;
  /** Paths the commit touches, used for conflict detection. */
  readonly changedPaths: readonly string[];
}

export interface IntegrationRequest {
  readonly targetBranch: string;
  readonly baseSha: string;
  readonly candidates: readonly IntegrationCandidate[];
  /** Extra branches to protect on top of the built-in list. */
  readonly additionalProtectedBranches?: readonly string[];
}

// -----------------------------------------------------------------------
// Outputs
// -----------------------------------------------------------------------

export type ExclusionReason =
  | "NOT_APPROVED"
  | "REVIEW_SHA_MISMATCH"
  | "MISSING_DEPENDENCY"
  | "DEPENDENCY_EXCLUDED"
  | "DEPENDENCY_CYCLE";

export interface ExcludedCandidate {
  readonly cardId: string;
  readonly commit: string;
  readonly reason: ExclusionReason;
  readonly detail: string;
}

/** A described conflict between two candidates that both landed in the plan. */
export interface ConflictCard {
  readonly cardIds: readonly [string, string];
  readonly overlappingPaths: readonly string[];
  readonly detail: string;
}

export interface IntegrationPlan {
  readonly schemaVersion: typeof INTEGRATION_RUNTIME_SCHEMA_VERSION;
  readonly targetBranch: string;
  readonly baseSha: string;
  /** Commits to cherry-pick, in dependency order. */
  readonly order: readonly IntegrationCandidate[];
  readonly excluded: readonly ExcludedCandidate[];
  readonly conflicts: readonly ConflictCard[];
  /** Reverse order of `order` — what to undo, and in which order, on failure. */
  readonly rollbackOrder: readonly string[];
}

// -----------------------------------------------------------------------
// Planning
// -----------------------------------------------------------------------

export class IntegrationRuntime {
  /**
   * Build the integration plan.
   *
   * Throws only for conditions where producing a plan at all would be
   * unsafe or meaningless: a protected target branch, or malformed input.
   * Everything else is reported — an excluded candidate and a conflict are
   * both normal results a caller must record.
   */
  plan(request: IntegrationRequest): IntegrationPlan {
    assertWritableTarget(request);
    validateRequest(request);

    const excluded: ExcludedCandidate[] = [];
    const byCard = new Map(request.candidates.map((candidate) => [candidate.cardId, candidate] as const));

    // 1. Verification. A review that approved a different sha is not
    //    approval of this commit.
    const verified = request.candidates.filter((candidate) => {
      if (!INTEGRABLE_VERDICTS.has(candidate.verdict)) {
        excluded.push({
          cardId: candidate.cardId,
          commit: candidate.commit,
          reason: "NOT_APPROVED",
          detail: `verdict ${candidate.verdict} does not authorise integration`,
        });
        return false;
      }
      if (candidate.reviewedCommit !== candidate.commit) {
        excluded.push({
          cardId: candidate.cardId,
          commit: candidate.commit,
          reason: "REVIEW_SHA_MISMATCH",
          detail: `review examined ${candidate.reviewedCommit} but the candidate commit is ${candidate.commit}`,
        });
        return false;
      }
      return true;
    });

    // 2. Dependency admissibility, to a fixpoint: excluding one candidate can
    //    make a dependent inadmissible, and that has to cascade rather than
    //    leave a dependent landing on something that never arrived.
    const admissible = new Map(verified.map((candidate) => [candidate.cardId, candidate] as const));
    for (;;) {
      let removedAny = false;
      for (const candidate of [...admissible.values()]) {
        for (const dependency of candidate.dependsOn) {
          if (admissible.has(dependency)) continue;
          admissible.delete(candidate.cardId);
          removedAny = true;
          excluded.push({
            cardId: candidate.cardId,
            commit: candidate.commit,
            reason: byCard.has(dependency) ? "DEPENDENCY_EXCLUDED" : "MISSING_DEPENDENCY",
            detail: byCard.has(dependency)
              ? `depends on ${dependency}, which is not being integrated`
              : `depends on ${dependency}, which is not among the candidates`,
          });
          break;
        }
      }
      if (!removedAny) break;
    }

    // 3. Topological order. A cycle is refused, never broken arbitrarily.
    const { order, cyclic } = topologicalOrder([...admissible.values()]);
    for (const candidate of cyclic) {
      excluded.push({
        cardId: candidate.cardId,
        commit: candidate.commit,
        reason: "DEPENDENCY_CYCLE",
        detail: "card takes part in a dependency cycle and cannot be ordered",
      });
    }

    return {
      schemaVersion: INTEGRATION_RUNTIME_SCHEMA_VERSION,
      targetBranch: request.targetBranch,
      baseSha: request.baseSha,
      order,
      excluded: [...excluded].sort((a, b) => a.cardId.localeCompare(b.cardId)),
      conflicts: detectConflicts(order),
      // Undoing in reverse means a dependent is always removed before what
      // it depends on, which is the only order that leaves the branch
      // consistent at every intermediate step.
      rollbackOrder: [...order].reverse().map((candidate) => candidate.commit),
    };
  }
}

// -----------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------

function assertWritableTarget(request: IntegrationRequest): void {
  const protectedSet = new Set(
    [...PROTECTED_BRANCHES, ...(request.additionalProtectedBranches ?? [])].map((branch) => branch.toLowerCase()),
  );
  if (protectedSet.has(request.targetBranch.trim().toLowerCase())) {
    throw new ProtectedBranchError(request.targetBranch);
  }
}

/**
 * Kahn's algorithm over the admissible set. Candidates whose dependencies
 * never resolve are returned as `cyclic` instead of being force-ordered:
 * picking an arbitrary order inside a cycle would land a change before the
 * one it builds on, which is the exact failure this ordering exists to stop.
 *
 * Ready candidates are taken in card-id order so the plan is reproducible
 * rather than dependent on input order.
 */
function topologicalOrder(candidates: readonly IntegrationCandidate[]): {
  order: readonly IntegrationCandidate[];
  cyclic: readonly IntegrationCandidate[];
} {
  const remaining = new Map(candidates.map((candidate) => [candidate.cardId, candidate] as const));
  const placed = new Set<string>();
  const order: IntegrationCandidate[] = [];

  for (;;) {
    const ready = [...remaining.values()]
      .filter((candidate) => candidate.dependsOn.every((dependency) => placed.has(dependency)))
      .sort((a, b) => a.cardId.localeCompare(b.cardId));
    if (ready.length === 0) break;
    for (const candidate of ready) {
      order.push(candidate);
      placed.add(candidate.cardId);
      remaining.delete(candidate.cardId);
    }
  }

  return {
    order,
    cyclic: [...remaining.values()].sort((a, b) => a.cardId.localeCompare(b.cardId)),
  };
}

/**
 * Pairs of ordered candidates touching the same path.
 *
 * Reported rather than resolved: a textual cherry-pick can succeed while
 * producing semantically wrong code, so an overlap is a card for a human,
 * not something this module should silently merge. Pairs are emitted in
 * order-index sequence so the report is stable.
 */
function detectConflicts(order: readonly IntegrationCandidate[]): readonly ConflictCard[] {
  const conflicts: ConflictCard[] = [];
  for (let left = 0; left < order.length; left++) {
    for (let right = left + 1; right < order.length; right++) {
      const first = order[left]!;
      const second = order[right]!;
      const secondPaths = new Set(second.changedPaths);
      const overlapping = [...new Set(first.changedPaths.filter((path) => secondPaths.has(path)))].sort();
      if (overlapping.length === 0) continue;
      conflicts.push({
        cardIds: [first.cardId, second.cardId],
        overlappingPaths: overlapping,
        detail: `${first.cardId} and ${second.cardId} both change ${overlapping.join(", ")}; a textual cherry-pick may still be semantically wrong`,
      });
    }
  }
  return conflicts;
}

function validateRequest(request: IntegrationRequest): void {
  if (!request.targetBranch.trim()) throw new IntegrationInputError("targetBranch must not be empty");
  if (!request.baseSha.trim()) throw new IntegrationInputError("baseSha must not be empty");

  const seen = new Set<string>();
  for (const candidate of request.candidates) {
    if (!candidate.cardId.trim()) throw new IntegrationInputError("every candidate must have a cardId");
    if (!candidate.commit.trim()) throw new IntegrationInputError(`candidate ${candidate.cardId} has no commit`);
    if (seen.has(candidate.cardId)) {
      throw new IntegrationInputError(`duplicate candidate for card ${candidate.cardId}`);
    }
    seen.add(candidate.cardId);
    if (candidate.dependsOn.includes(candidate.cardId)) {
      throw new IntegrationInputError(`card ${candidate.cardId} depends on itself`);
    }
  }
}
