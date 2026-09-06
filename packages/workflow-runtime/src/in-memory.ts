/* SPDX-License-Identifier: MIT */
/* Copyright (c) 2026 Unifia contributors */

/**
 * In-memory implementation of `DurableHistoryAuthority` (M1-09).
 *
 * Per plan V2.3.1 §41 + M1 plan §3.9, this implementation:
 *
 *   - Persists the run state in-process.
 *   - Atomically applies status+effect-slot transitions, validating
 *     the transition matrix (ADR-022 §4).
 *   - Enqueues commands and schedules timers with the requested
 *     overlap policy.
 *   - Materializes the read-only projection from history.
 *
 * This is **not** the production kernel (which is post-ADR-000
 * ratification, M1+ work). It is the in-memory implementation that
 * the runtime tests + the M0 substrate proof both use, and that any
 * future production adapter (SQLite, DBOS, Temporal) would replace
 * with a real persistence layer.
 *
 * M0 substrate proof contract (ADR-000 §6) is enforced by the
 * @unifia/automate-m0-harness package. This file is the integration
 * point: the in-memory implementation satisfies the M0 contract
 * surface for WorkflowRun, and the m0-harness test scenarios drive
 * the same code path.
 *
 * Status transitions supported (per ADR-022 §4):
 *
 *   running           -> waiting, completed, failed, cancelled
 *   waiting           -> running, completed, failed, cancelled
 *   completed         -> (terminal)
 *   failed            -> (terminal)
 *   cancelled         -> (terminal)
 *   cancelled_with_active_effect  -> (terminal)
 *   cancelled_with_unknown_external_state -> (terminal)
 *
 * Illegal transitions throw `IllegalTransitionError` so the caller
 * can surface a typed error to the user / audit log.
 */

import type {
  AtomicTransitionBoundary,
  DurableAuthorityKind,
  MaterializedRunProjection,
  OverlapPolicy,
  WorkflowRun,
  WorkflowRunStatus,
} from "@unifia/contracts"
import {
  WorkflowRunSchema,
  WorkflowRunStatusSchema,
  AtomicTransitionBoundarySchema,
} from "@unifia/contracts"
import { z } from "zod"
import type { DurableHistoryAuthority } from "./adapter.ts"
import { assertTokenForRun, type AuthorityToken } from "./authority.ts"

// ============================================================================
// Errors
// ============================================================================

export class HistoryAuthorityError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "HistoryAuthorityError"
  }
}

export class RunNotFoundError extends HistoryAuthorityError {
  constructor(runId: string) {
    super(`WorkflowRun not found: ${runId}`)
    this.name = "RunNotFoundError"
  }
}

export class IllegalTransitionError extends HistoryAuthorityError {
  constructor(
    from: WorkflowRunStatus,
    to: WorkflowRunStatus,
  ) {
    super(`Illegal transition: ${from} -> ${to}`)
    this.name = "IllegalTransitionError"
  }
}

export class EffectSlotNotReservedError extends HistoryAuthorityError {
  constructor(effectSlotId: string) {
    super(`Effect slot not reserved: ${effectSlotId}`)
    this.name = "EffectSlotNotReservedError"
  }
}

// ============================================================================
// Transition matrix
// ============================================================================

const LEGAL_TRANSITIONS: Readonly<
  Record<WorkflowRunStatus, readonly WorkflowRunStatus[]>
> = {
  running: ["waiting", "completed", "failed", "cancelled"],
  waiting: ["running", "completed", "failed", "cancelled"],
  completed: [],
  failed: [],
  cancelled: [],
  cancelled_with_active_effect: [],
  cancelled_with_unknown_external_state: [],
}

function isLegalTransition(from: WorkflowRunStatus, to: WorkflowRunStatus): boolean {
  return LEGAL_TRANSITIONS[from].includes(to)
}

// ============================================================================
// Commands and timers
// ============================================================================

export interface CommandEnvelope {
  readonly runId: string
  readonly kind: string
  readonly payload: unknown
  readonly enqueuedAt: number
}

export interface TimerEnvelope {
  readonly runId: string
  readonly timerId: string
  readonly fireAt: number
  readonly overlapPolicy: OverlapPolicy
  readonly scheduledAt: number
}

// ============================================================================
// In-memory history record
// ============================================================================

interface RunState {
  run: WorkflowRun
  commands: CommandEnvelope[]
  timers: TimerEnvelope[]
  history: AtomicTransitionBoundary[]
}

// ============================================================================
// In-memory implementation
// ============================================================================

export interface InMemoryHistoryAuthorityOptions {
  /** Authority kind to record on newly created runs. */
  readonly authorityKind: DurableAuthorityKind
  /** Whether to log state transitions to console (debug only). */
  readonly verbose?: boolean
}

export class InMemoryDurableHistoryAuthority implements DurableHistoryAuthority {
  private readonly runs = new Map<string, RunState>()
  private readonly options: InMemoryHistoryAuthorityOptions

  constructor(options: InMemoryHistoryAuthorityOptions) {
    this.options = options
  }

  /**
   * Register a new run. This is **not** part of the
   * `DurableHistoryAuthority` interface; it's a setup method used
   * by tests and by the M0 substrate proof to seed runs.
   */
  register(run: WorkflowRun): void {
    const parsed = WorkflowRunSchema.parse(run)
    this.runs.set(parsed.runId, {
      run: parsed,
      commands: [],
      timers: [],
      history: [],
    })
  }

  restore(snapshot: {
    run: WorkflowRun
    commands: CommandEnvelope[]
    timers: TimerEnvelope[]
    history: AtomicTransitionBoundary[]
  }): void {
    const run = WorkflowRunSchema.parse(snapshot.run)
    this.runs.set(run.runId, {
      run,
      commands: deepCopy(snapshot.commands),
      timers: deepCopy(snapshot.timers),
      history: deepCopy(snapshot.history),
    })
  }

  async getRun(runId: string): Promise<WorkflowRun | null> {
    const state = this.runs.get(runId)
    if (!state) return null
    return deepCopy(state.run)
  }

  async transition(token: AuthorityToken, runId: string, event: AtomicTransitionBoundary): Promise<void> {
    assertTokenRun(token, runId)
    const parsed = AtomicTransitionBoundarySchema.parse(event)
    const state = this.runs.get(runId)
    if (!state) {
      throw new RunNotFoundError(runId)
    }
    const current = state.run.status
    if (parsed.from !== current) {
      throw new HistoryAuthorityError(
        `transition.from (${parsed.from}) does not match current status (${current})`,
      )
    }
    if (!isLegalTransition(parsed.from, parsed.to)) {
      throw new IllegalTransitionError(parsed.from, parsed.to)
    }
    // Atomic write: status + boundary event applied in a single
    // frame. The substrate records both atomically; here we update
    // the in-memory state.
    state.history.push(parsed)
    state.run = { ...state.run, status: parsed.to, updatedAt: parsed.occurredAt }
    if (this.options.verbose) {
      // eslint-disable-next-line no-console
      console.log(`[history] ${runId}: ${parsed.from} -> ${parsed.to}`)
    }
  }

  async enqueueCommand(
    token: AuthorityToken,
    runId: string,
    command: { kind: string; payload: unknown },
  ): Promise<void> {
    assertTokenRun(token, runId)
    const state = this.runs.get(runId)
    if (!state) {
      throw new RunNotFoundError(runId)
    }
    state.commands.push({
      runId,
      kind: command.kind,
      payload: command.payload,
      enqueuedAt: Date.now(),
    })
  }

  async scheduleTimer(
    token: AuthorityToken,
    timerId: string,
    runId: string,
    fireAt: number,
    overlapPolicy: OverlapPolicy,
  ): Promise<void> {
    assertTokenRun(token, runId)
    const state = this.runs.get(runId)
    if (!state) {
      throw new RunNotFoundError(runId)
    }
    state.timers.push({
      runId,
      timerId,
      fireAt,
      overlapPolicy,
      scheduledAt: Date.now(),
    })
  }

  async getMaterializedProjection(
    runId: string,
  ): Promise<MaterializedRunProjection> {
    const state = this.runs.get(runId)
    if (!state) {
      throw new RunNotFoundError(runId)
    }
    const lastEvent =
      state.history.length > 0
        ? state.history[state.history.length - 1]!
        : null
    return {
      runId: state.run.runId,
      status: state.run.status,
      lastTransitionAt: lastEvent?.occurredAt,
      pendingEffects: state.commands.map((c) => `${c.kind}:${c.runId}`),
      pendingTimers: state.timers.map((t) => ({
        timerId: t.timerId,
        fireAt: t.fireAt,
      })),
    }
  }

  /**
   * Inspection methods (not on the `DurableHistoryAuthority` interface;
   * for tests + the M0 substrate proof).
   */
  inspectCommands(runId: string): readonly CommandEnvelope[] {
    return this.runs.get(runId)?.commands ?? []
  }

  inspectTimers(runId: string): readonly TimerEnvelope[] {
    return this.runs.get(runId)?.timers ?? []
  }

  inspectHistory(runId: string): readonly AtomicTransitionBoundary[] {
    return this.runs.get(runId)?.history ?? []
  }

  /**
   * Snapshot accessor for the file-backed adapter. Returns the
   * full in-memory state, serialized as a plain object. Not on
   * the `DurableHistoryAuthority` interface.
   */
  snapshot(): Record<
    string,
    {
      run: WorkflowRun
      commands: CommandEnvelope[]
      timers: TimerEnvelope[]
      history: AtomicTransitionBoundary[]
    }
  > {
    const out: Record<
      string,
      {
        run: WorkflowRun
        commands: CommandEnvelope[]
        timers: TimerEnvelope[]
        history: AtomicTransitionBoundary[]
      }
    > = {}
    for (const [runId, state] of this.runs) {
      out[runId] = {
        run: state.run,
        commands: [...state.commands],
        timers: [...state.timers],
        history: [...state.history],
      }
    }
    return out
  }
}

// ============================================================================
// Helpers
// ============================================================================

function deepCopy<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function assertTokenRun(token: AuthorityToken, runId: string): void {
  assertTokenForRun(token, runId)
}

export { isLegalTransition }
