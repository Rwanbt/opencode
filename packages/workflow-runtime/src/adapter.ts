/* SPDX-License-Identifier: MIT */
/**
 * DurableHistoryAuthority adapter — Plan V2.3.1 §41, M1 plan §3.9 (C-M1-09).
 *
 * **This file is interface-only. No implementation is committed.**
 *
 * The five method signatures below are the substrate-agnostic
 * contract every concrete authority (`native` SQLite, `dbos`
 * Postgres, `temporal` Cloud) MUST satisfy. The implementations are
 * blocked on ADR-000 — at the time of writing, ADR-000 is still
 * PROPOSED, and committing a physical implementation before the
 * substrate decision is locked would create a re-write tax (plan
 * §626, §736).
 *
 * The companion contract half lives in
 * `packages/contracts/src/workflow-run.ts`:
 *
 *   - `WorkflowRunSchema`               — the runtime identity
 *   - `MaterializedRunProjectionSchema`  — the read-only derived view
 *   - `AtomicTransitionBoundarySchema`   — the atomic status+slot pair
 *   - `WorkflowRunStatusSchema`         — 7 documented statuses
 *   - `DurableAuthorityKindSchema`      — 3 documented substrates
 *                                         (`restate` deliberately
 *                                         excluded, ADR-000 REQ-6)
 *
 * Why an *interface* and not a Zod-validated *factory*? The contract
 * is type-level (the shape of a substrate's API surface) — a Zod
 * schema for a method signature would be runtime-only and would
 * duplicate TypeScript's own checker. A TS `interface` is the right
 * level: the implementation can be `InMemory` (for tests), a
 * `DbosHistoryAuthority` (post-ADR-000), or a `TemporalHistoryAuthority`
 * (post-ADR-000), and every consumer of the contract gets static
 * exhaustiveness checks for free.
 *
 * Why the *parameter* of `enqueueCommand` is `{ kind, payload }` and
 * not a discriminated union? The command *kinds* are an open set
 * owned by the effect-runtime (C-M1-13+, post-ADR-004). Pinning a
 * closed enum here would force a breaking change every time a new
 * effector family lands (plan §55, ADR-002). The substrate's only
 * obligation is to durably persist the envelope; the kind decoding
 * is the effect-runtime's concern, not the substrate's.
 */
import type {
  AtomicTransitionBoundary,
  MaterializedRunProjection,
  OverlapPolicy,
  WorkflowRun,
} from "@unifia/contracts"
import type { AuthorityToken } from "./authority.ts"

/**
 * The substrate-agnostic durable history contract.
 *
 * Every method is `async` because the three physical substrates
 * (Native SQLite, DBOS Postgres, Temporal Cloud) all involve I/O.
 * An in-memory implementation used in tests is also async (returning
 * resolved promises) so the consumer never branches on
 * "in-memory vs remote".
 *
 * The interface is **deliberately not generic over the substrate
 * kind**. The substrate is identified per-run by
 * `WorkflowRun.durableAuthorityKind`; a single
 * `DurableHistoryAuthority` instance is expected to be the registry
 * for one substrate (so a multi-substrate control plane maintains a
 * `Map<DurableAuthorityKind, DurableHistoryAuthority>`).
 *
 * Method semantics — see plan §41, M1 plan §3.9 acceptance (a)-(f):
 *
 *   - `getRun(runId)`              : returns the current
 *                                    `WorkflowRun` (the durable
 *                                    state) or `null` if the run is
 *                                    not registered. The return is
 *                                    a deep copy so callers can
 *                                    mutate it freely.
 *   - `transition(runId, event)`   : atomically apply an
 *                                    `AtomicTransitionBoundary`. The
 *                                    substrate MUST validate the
 *                                    transition matrix (ADR-022 §4)
 *                                    and the effect-slot reservation
 *                                    before persisting. A half-applied
 *                                    transition is a substrate bug
 *                                    (plan §41, ADR-004).
 *   - `enqueueCommand(...)`        : durably enqueue a command for
 *                                    the run's executor. The
 *                                    `payload` is opaque to the
 *                                    substrate (it is the
 *                                    effect-runtime's job to decode
 *                                    `kind`); the substrate only
 *                                    guarantees at-least-once
 *                                    delivery within the run's
 *                                    linear history.
 *   - `scheduleTimer(...)`         : schedule a substrate-side timer
 *                                    that fires `runId` at
 *                                    `fireAt` (millisecond Unix
 *                                    epoch). `overlapPolicy` is the
 *                                    same enum the scheduler uses
 *                                    (timer.ts) so the substrate
 *                                    can apply the same overlap
 *                                    rules. The `timerId` is
 *                                    caller-issued and must be
 *                                    unique within the run.
 *   - `getMaterializedProjection(runId)` : derive a
 *                                    `MaterializedRunProjection`
 *                                    from the run's history. The
 *                                    projection is the *output* of
 *                                    a read — there is no
 *                                    `updateProjection` method
 *                                    because ADR-004 forbids
 *                                    write-access to the
 *                                    projection.
 */
export interface DurableHistoryAuthority {
  /**
   * Read the current durable state of a run.
   *
   * @param runId  the substrate-issued run id (matches
   *               `WorkflowRun.runId`).
   * @returns      the run, or `null` if the run is not registered.
   *               Returns a deep copy so callers may mutate it.
   */
  getRun(runId: string): Promise<WorkflowRun | null>

  /**
   * Atomically apply a status+effect-slot transition.
   *
   * The substrate MUST validate:
   *   - `from` matches the run's current status
   *     (the substrate keeps the linear history).
   *   - `from → to` is a legal transition per ADR-022 §4
   *     (e.g. `running → completed` is legal,
   *     `completed → running` is not — except in the
   *     substrate-level replay rebind case which is a
   *     substrate concern, not a caller concern).
   *   - The `effectSlotId` is reserved as part of the same
   *     atomic write. A reservation that succeeds without
   *     the status change (or vice versa) is a substrate
   *     bug — the substrate's WAL must capture both in a
   *     single frame.
   *
   * @param runId   the run to transition.
   * @param event   the boundary event to apply. The schema
   *                already enforces the type-level shape;
   *                the substrate enforces the policy.
   * @throws        if the transition is illegal (substrate
   *                returns a typed error) or the run does
   *                not exist.
   */
  transition(token: AuthorityToken, runId: string, event: AtomicTransitionBoundary): Promise<void>

  /**
   * Enqueue a command for the run's executor.
   *
   * The `kind` is the effect-runtime's discriminator (e.g.
   * `"tool.http"`, `"human.approval"`). The substrate stores the
   * envelope as-is and the effect-runtime decodes it on
   * consumption. This indirection keeps the substrate stable
   * as new effect families are added (plan §55).
   *
   * @param runId    the run the command targets.
   * @param command  the command envelope.
   *                 - `kind`    : an opaque string (open set,
   *                              owned by the effect-runtime).
   *                 - `payload` : opaque to the substrate.
   */
  enqueueCommand(
    token: AuthorityToken,
    runId: string,
    command: { kind: string; payload: unknown },
  ): Promise<void>

  /**
   * Schedule a substrate-side timer.
   *
   * The substrate MUST guarantee the timer fires at-or-after
   * `fireAt` (millisecond Unix epoch) and at-most-once per
   * `timerId`. The `overlapPolicy` is the same enum the
   * scheduler uses; the substrate applies it locally (e.g.
   * `forbid` on a still-firing timer is a no-op, `replace`
   * cancels the previous timer).
   *
   * @param timerId        caller-issued unique id within
   *                       the run.
   * @param runId          the run the timer targets.
   * @param fireAt         millisecond Unix epoch.
   * @param overlapPolicy  the overlap policy to apply on
   *                       conflict with a previous timer.
   */
  scheduleTimer(
    token: AuthorityToken,
    timerId: string,
    runId: string,
    fireAt: number,
    overlapPolicy: OverlapPolicy,
  ): Promise<void>

  /**
   * Derive the read-only projection of a run from its history.
   *
   * The substrate MUST re-derive on every call (no caching that
   * could drift from the linear history). The projection's
   * fields are all optional (see
   * `MaterializedRunProjectionSchema`) so a partial projection
   * is a valid intermediate state during replay.
   *
   * @param runId  the run to project.
   * @returns      the projection, or `null` if the run is not
   *               registered. A deep copy is returned.
   */
  getMaterializedProjection(runId: string): Promise<MaterializedRunProjection | null>
}

// Implementation deferred to ADR-000 (Native / DBOS / Temporal).
//
// The class implementations (`NativeHistoryAuthority`,
// `DbosHistoryAuthority`, `TemporalHistoryAuthority`) are *not*
// committed in this card. They will land in subsequent cards after
// ADR-000 is decided. The interface above is the only thing
// `@unifia/workflow-runtime` exports from this file.
