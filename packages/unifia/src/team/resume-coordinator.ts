// =============================================================================
// resume-coordinator.ts — TEAM-J04
//
// Decides who leads a run after the lead disappears, and whether a paused run
// can safely resume later.
//
// Two failures shape everything here, and they pull in opposite directions.
// Failing over too eagerly gives you two leads; failing over too slowly
// stalls the run. The resolution is that leadership is a lease, not a
// heartbeat: a standby may only take over by acquiring a strictly higher
// term, and the old lead is expected to notice it has been superseded and
// stand down. Nothing is ever decided by "the heartbeat looked old to me".
//
//   No split brain      Exactly one term is live. A standby that promotes
//                       itself increments the term; any action carrying an
//                       older term is refused. Two standbys racing produce
//                       two different terms, and only the higher one holds —
//                       so the loser is rejected rather than both proceeding.
//
//   Days-later resume   A pause is a durable record, not a sleeping process.
//                       Resuming after an arbitrary delay is the normal case,
//                       so nothing here expires by wall-clock age alone.
//                       Refusing a resume because it "took too long" would
//                       throw away completed work for no safety gain.
//
//   Base drift handled  What does invalidate a resume is the world having
//                       moved: if the integration branch advanced past the
//                       base the pause recorded, resuming blind would apply
//                       work to a tree it was never validated against. That
//                       is reported as drift requiring revalidation, not as a
//                       refusal — the work is still good, it just has to be
//                       rechecked.
//
// Clock-free and pure: the caller supplies time and observed Git state.
// =============================================================================

export const RESUME_COORDINATOR_SCHEMA_VERSION = "1.0.0" as const;

export class ResumeCoordinatorInputError extends TypeError {
  constructor(message: string) {
    super(message);
    this.name = "ResumeCoordinatorInputError";
  }
}

// -----------------------------------------------------------------------
// Leadership
// -----------------------------------------------------------------------

export interface LeadershipState {
  readonly leaderId: string;
  /** Monotonic. A higher term always wins; equal terms never transfer. */
  readonly term: number;
  readonly acquiredAtMs: number;
  readonly lastHeartbeatMs: number;
}

export type TakeoverOutcome = "PROMOTED" | "REFUSED_LEASE_ALIVE" | "REFUSED_STALE_TERM";

export interface TakeoverDecision {
  readonly outcome: TakeoverOutcome;
  readonly reason: string;
  readonly leadership: LeadershipState | null;
}

export interface TakeoverRequest {
  readonly current: LeadershipState;
  readonly standbyId: string;
  /** Term the standby believes is current. Must match to promote. */
  readonly observedTerm: number;
  readonly leaseTtlMs: number;
  readonly nowMs: number;
}

export class LeadershipRegistry {
  /**
   * Attempt a takeover.
   *
   * The standby must observe the current term exactly. Two standbys reading
   * the same stale state both request the same term, but only the first is
   * applied — the second then observes a term that no longer matches and is
   * refused, which is what keeps a single leader.
   */
  takeover(request: TakeoverRequest): TakeoverDecision {
    assertId(request.standbyId, "standbyId");
    if (request.leaseTtlMs <= 0) throw new ResumeCoordinatorInputError("leaseTtlMs must be positive");
    if (!Number.isFinite(request.nowMs)) throw new ResumeCoordinatorInputError("nowMs must be finite");

    if (request.observedTerm !== request.current.term) {
      return {
        outcome: "REFUSED_STALE_TERM",
        reason: `standby observed term ${request.observedTerm} but the live term is ${request.current.term}; another standby already took over`,
        leadership: null,
      };
    }

    const elapsed = request.nowMs - request.current.lastHeartbeatMs;
    if (elapsed < request.leaseTtlMs) {
      return {
        outcome: "REFUSED_LEASE_ALIVE",
        reason: `lead lease is still alive (${elapsed}ms since heartbeat, TTL ${request.leaseTtlMs}ms)`,
        leadership: null,
      };
    }

    return {
      outcome: "PROMOTED",
      reason: `lead lease expired after ${elapsed}ms; ${request.standbyId} promoted at term ${request.current.term + 1}`,
      leadership: {
        leaderId: request.standbyId,
        term: request.current.term + 1,
        acquiredAtMs: request.nowMs,
        lastHeartbeatMs: request.nowMs,
      },
    };
  }

  /**
   * Whether an action carrying `term` may still act as leader.
   *
   * This is how a superseded lead learns to stand down: it keeps working
   * until an action is refused, rather than being told out of band.
   */
  isCurrentLeader(state: LeadershipState, leaderId: string, term: number): boolean {
    return state.leaderId === leaderId && state.term === term;
  }

  heartbeat(state: LeadershipState, leaderId: string, term: number, nowMs: number): LeadershipState {
    if (!this.isCurrentLeader(state, leaderId, term)) {
      throw new ResumeCoordinatorInputError(
        `refusing heartbeat from ${leaderId} at term ${term}; live lead is ${state.leaderId} at term ${state.term}`,
      );
    }
    return { ...state, lastHeartbeatMs: nowMs };
  }
}

// -----------------------------------------------------------------------
// Pause / resume
// -----------------------------------------------------------------------

export interface PauseRecord {
  readonly schemaVersion: typeof RESUME_COORDINATOR_SCHEMA_VERSION;
  readonly runId: string;
  readonly pausedAtMs: number;
  readonly reason: string;
  /** Integration branch head when the run paused. */
  readonly baseSha: string;
  readonly completedTaskIds: readonly string[];
  readonly leadership: LeadershipState;
}

export type ResumeOutcome = "RESUMED" | "RESUMED_WITH_REVALIDATION" | "REFUSED";

export interface ResumeDecision {
  readonly schemaVersion: typeof RESUME_COORDINATOR_SCHEMA_VERSION;
  readonly outcome: ResumeOutcome;
  readonly reason: string;
  /** Tasks that must be revalidated before being trusted again. */
  readonly revalidateTaskIds: readonly string[];
  readonly baseDrifted: boolean;
  readonly leadership: LeadershipState | null;
}

export interface ResumeRequest {
  readonly pause: PauseRecord;
  /** Integration branch head observed now. */
  readonly observedBaseSha: string;
  readonly resumingLeaderId: string;
  readonly resumingTerm: number;
  readonly nowMs: number;
}

export class ResumeCoordinator {
  pause(input: {
    runId: string;
    reason: string;
    baseSha: string;
    completedTaskIds: readonly string[];
    leadership: LeadershipState;
    nowMs: number;
  }): PauseRecord {
    assertId(input.runId, "runId");
    if (!input.reason.trim()) throw new ResumeCoordinatorInputError("pause reason must not be empty");
    if (!input.baseSha.trim()) throw new ResumeCoordinatorInputError("baseSha must not be empty");

    return {
      schemaVersion: RESUME_COORDINATOR_SCHEMA_VERSION,
      runId: input.runId,
      pausedAtMs: input.nowMs,
      reason: input.reason,
      baseSha: input.baseSha,
      completedTaskIds: [...new Set(input.completedTaskIds)].sort(),
      leadership: input.leadership,
    };
  }

  /**
   * Decide whether a paused run may continue.
   *
   * Age is deliberately not a factor: a pause is a durable record, and
   * refusing a resume because it "took too long" would discard completed
   * work for no safety gain. What matters is whether the tree still matches
   * what the work was validated against.
   */
  resume(request: ResumeRequest): ResumeDecision {
    assertId(request.resumingLeaderId, "resumingLeaderId");
    if (!request.observedBaseSha.trim()) {
      throw new ResumeCoordinatorInputError("observedBaseSha must not be empty");
    }

    const { pause } = request;

    // Leadership is checked first: a resume driven by a superseded lead is
    // the split-brain case, and nothing about the base matters if the wrong
    // process is asking.
    if (request.resumingTerm < pause.leadership.term) {
      return {
        schemaVersion: RESUME_COORDINATOR_SCHEMA_VERSION,
        outcome: "REFUSED",
        reason: `resume attempted at term ${request.resumingTerm}, older than the paused run's term ${pause.leadership.term}`,
        revalidateTaskIds: [],
        baseDrifted: false,
        leadership: null,
      };
    }

    const leadership: LeadershipState = {
      leaderId: request.resumingLeaderId,
      term: request.resumingTerm,
      acquiredAtMs: request.nowMs,
      lastHeartbeatMs: request.nowMs,
    };

    if (request.observedBaseSha !== pause.baseSha) {
      // The work is not wrong, it is unverified against this tree.
      return {
        schemaVersion: RESUME_COORDINATOR_SCHEMA_VERSION,
        outcome: "RESUMED_WITH_REVALIDATION",
        reason: `integration base moved from ${pause.baseSha} to ${request.observedBaseSha}; completed work must be revalidated against the new tree`,
        revalidateTaskIds: pause.completedTaskIds,
        baseDrifted: true,
        leadership,
      };
    }

    return {
      schemaVersion: RESUME_COORDINATOR_SCHEMA_VERSION,
      outcome: "RESUMED",
      reason: `base unchanged at ${pause.baseSha}; resuming ${pause.completedTaskIds.length} completed task(s) as verified`,
      revalidateTaskIds: [],
      baseDrifted: false,
      leadership,
    };
  }
}

function assertId(value: string, name: string): void {
  if (!value.trim()) throw new ResumeCoordinatorInputError(`${name} must not be empty`);
}
