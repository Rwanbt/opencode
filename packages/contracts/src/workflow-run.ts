/* SPDX-License-Identifier: MIT */
/**
 * Workflow run identities + durable history boundary contracts —
 * Plan V2.3.1 §41 (DurableHistoryAuthority interface) + §43 (WorkflowRun
 * runtime type), M1 plan §3.9 (C-M1-09), ADR-004 + ADR-022.
 *
 * This module declares the **identity** and **boundary** of a durable
 * workflow run. The *implementation* of the `DurableHistoryAuthority`
 * interface (Native SQLite / DBOS Postgres / Temporal — ADR-000 still
 * PROPOSED at the time of writing) is deliberately *not* in this
 * package: see `packages/workflow-runtime/src/adapter.ts` for the TS
 * interface, and the M1 plan §3.9 for the locked-out implementation
 * timeline (post-ADR-000).
 *
 * Why a separate `workflow-run.ts` and not extending `workflow-ir.ts`?
 *   - The IR (§55, ADR-002) is the *editable + canonical* form of a
 *     workflow. A `WorkflowRun` is *runtime state* that the IR is
 *     promoted into, then mutated. Mixing the two would re-introduce
 *     the runtime-into-IR leak the IR refactor explicitly avoided.
 *   - The `MaterializedRunProjection` and `AtomicTransitionBoundary`
 *     types are read-only / event-bound, not canonical IR. They
 *     belong in their own file so a reader looking for "what does a
 *     run look like at time T" does not wade through nodes and edges.
 *
 * Why `restate` is deliberately excluded from `DurableAuthorityKindSchema`?
 *   - ADR-000 REQ-6: Restate is **rejected** at the substrate decision
 *     boundary because its journaling model does not satisfy ADR-004's
 *     `append-only` guarantee for `HistoryEvent` (Restate can compact).
 *     The schema enforces the rejection at the type / Zod boundary so
 *     a caller cannot smuggle `"restate"` past the compiler.
 *
 * Why all fields on `MaterializedRunProjectionSchema` are optional?
 *   - The projection is **derived** from the run's history by
 *     `materializeProjection(runId)` (plan §41). A partial projection
 *     is a valid intermediate state during replay — e.g. the `lastError`
 *     field only exists after a `failed` transition. Forcing the
 *     caller to materialise the full shape would force the substrate
 *     to maintain a parallel write-ahead copy of the projection, which
 *     ADR-004 explicitly forbids.
 *   - "Read-only" here means "the projection is the *output* of a read,
 *     not a write target". The schema enforces read-only-ness by
 *     requiring `materializeProjection` (an interface method) to be
 *     the only producer — there is no `updateProjection` method on
 *     the `DurableHistoryAuthority` interface.
 */
import { z } from "zod"
import { DeploymentScopeSchema } from "./scope.js"
import { OverlapPolicySchema } from "./timer.js"

/* ------------------------------------------------------------------ */
/* Status enum (Plan V2.3.1 §43)                                      */
/* ------------------------------------------------------------------ */

/**
 * The seven `WorkflowRunStatus` values.
 *
 * The three `cancelled*` states are **distinct on purpose** so a
 * cancelling run can carry a precise note about its exit shape:
 *
 * - `cancelled`                     : the run was cancelled cleanly;
 *                                    no in-flight effect or external
 *                                    resource has been mutated.
 * - `cancelled_with_active_effect`  : the run was cancelled but at
 *                                    least one `tool.*` effect is in
 *                                    flight or completed; the caller
 *                                    must inspect `pendingEffects`
 *                                    on the projection to know what
 *                                    to clean up.
 * - `cancelled_with_unknown_external_state` : the run was cancelled
 *                                    but at least one effect produced
 *                                    an `UNKNOWN_EXTERNAL_STATE` (TM-W-03
 *                                    — the executor does not know if
 *                                    the side effect happened). The
 *                                    caller MUST treat the affected
 *                                    external resource as "needs
 *                                    manual reconciliation"; this is
 *                                    the same status the recovery path
 *                                    uses after a substrate crash
 *                                    with non-deterministic replay
 *                                    (plan §38).
 *
 * `waiting` is distinct from `running` because a run can be paused
 * for human approval, queue back-pressure, or substrate-level
 * timer suspension. A `waiting` run still consumes no worker; a
 * `running` run does.
 *
 * `failed` is the terminal status for an uncaught exception that
 * exhausted every retry. It carries `lastError` on the projection.
 */
export const WorkflowRunStatusSchema = z.enum([
  "running",
  "waiting",
  "completed",
  "failed",
  "cancelled",
  "cancelled_with_active_effect",
  "cancelled_with_unknown_external_state",
])

export type WorkflowRunStatus = z.infer<typeof WorkflowRunStatusSchema>

/* ------------------------------------------------------------------ */
/* Durable authority substrate kind (Plan V2.3.1 §41, ADR-000)         */
/* ------------------------------------------------------------------ */

/**
 * The three substrate options ADR-000 is selecting between.
 *
 * - `native`   : the in-process SQLite / filesystem implementation
 *                (`@unifia/workflow-runtime/src/native-history.ts`,
 *                post-ADR-000). Best for single-tenant dev / on-prem.
 * - `dbos`     : DBOS-on-Postgres. Best for managed multi-tenant
 *                prod where Postgres is already the system of record.
 * - `temporal` : Temporal Cloud / self-hosted. Best for very long
 *                runs (months) and cross-language effectors.
 *
 * `restate` is **deliberately absent** (see file-level JSDoc). Any
 * attempt to parse a `WorkflowRun` with `durableAuthorityKind: "restate"`
 * is rejected at the Zod boundary with a `ZodError` so the violation
 * surfaces in the validation log, not at the substrate level 200 ms
 * later.
 */
export const DurableAuthorityKindSchema = z.enum(["native", "dbos", "temporal"])

export type DurableAuthorityKind = z.infer<typeof DurableAuthorityKindSchema>

/* ------------------------------------------------------------------ */
/* WorkflowRun — the runtime identity (Plan V2.3.1 §43)                */
/* ------------------------------------------------------------------ */

/**
 * The runtime state of one durable workflow execution.
 *
 * `runId` is the substrate-issued handle (UUID-v7 or substrate-native
 * id). `durableAuthorityId` is the substrate's pointer to the run
 * record in its own store — for `native` it is the rowid, for `dbos`
 * it is the workflow UUID, for `temporal` it is the workflowId + runId
 * pair joined with `/`. The two are kept distinct so the contract is
 * not tied to a particular substrate's internal id scheme.
 *
 * `triggerId` and `triggerEventId` together identify *why* the run
 * started (the trigger binding + the specific event that fired it).
 * Both are required so a `TriggerHistoryEntry` (post-M1-10) can be
 * resolved by `(runId, triggerEventId)` without an extra lookup.
 *
 * `createdAt` and `updatedAt` are millisecond Unix epoch (the IR
 * convention). `updatedAt` is bumped on every `AtomicTransitionBoundary`
 * that the substrate accepts.
 *
 * `status` is the seven-value `WorkflowRunStatusSchema` above. The
 * `AtomicTransitionBoundarySchema` is the only legal way to mutate
 * `status`; the substrate must validate the transition shape before
 * persisting it (the schema here only checks the *type* of the field,
 * not the *legality* of the transition — that policy is owned by
 * ADR-022 §4 transition matrix, not duplicated here).
 */
export const WorkflowRunSchema = z.object({
  /** Substrate-issued handle for this run. */
  runId: z
    .string()
    .min(1)
    .regex(/^\S(.*\S)?$/, "runId must not be empty or whitespace"),
  /** The `WorkflowDeployment.deploymentId` that owns this run. */
  deploymentId: z
    .string()
    .min(1)
    .regex(/^\S(.*\S)?$/, "deploymentId must not be empty or whitespace"),
  /** The `WorkflowVersion.versionId` this run is executing. */
  workflowVersionId: z
    .string()
    .min(1)
    .regex(/^\S(.*\S)?$/, "workflowVersionId must not be empty or whitespace"),
  /** The deployment scope (org/project/workspace + environment) — ADR-020. */
  deploymentScope: DeploymentScopeSchema,
  /** The `TriggerBinding.bindingId` that fired this run. */
  triggerId: z
    .string()
    .min(1)
    .regex(/^\S(.*\S)?$/, "triggerId must not be empty or whitespace"),
  /** The specific event id that fired this run (M1-10 will tighten this). */
  triggerEventId: z
    .string()
    .min(1)
    .regex(/^\S(.*\S)?$/, "triggerEventId must not be empty or whitespace"),
  /** The substrate's pointer to the run record (opaque, substrate-specific). */
  durableAuthorityId: z
    .string()
    .min(1)
    .regex(/^\S(.*\S)?$/, "durableAuthorityId must not be empty or whitespace"),
  /** The substrate kind (see `DurableAuthorityKindSchema`). */
  durableAuthorityKind: DurableAuthorityKindSchema,
  /** Current status of the run (see `WorkflowRunStatusSchema`). */
  status: WorkflowRunStatusSchema,
  /** Millisecond Unix epoch when the run was created. */
  createdAt: z.number().int().nonnegative(),
  /** Millisecond Unix epoch of the last accepted `AtomicTransitionBoundary`. */
  updatedAt: z.number().int().nonnegative(),
})

export type WorkflowRun = z.infer<typeof WorkflowRunSchema>

/* ------------------------------------------------------------------ */
/* MaterializedRunProjection — read-only derived view (Plan §41)      */
/* ------------------------------------------------------------------ */

/**
 * The read-only projection of a run, **derived** from its history by
 * `materializeProjection(runId)`. It is never written to directly.
 *
 * Every field is optional because partial projections are a valid
 * intermediate state during replay (e.g. before the run has any
 * `pendingTimers`, before any `tool.*` effect has produced a
 * `pendingEffects` entry, before any `failed` transition has set
 * `lastError`).
 *
 * `activeNodeId` is the id of the node currently being executed (or
 * awaiting decision); `undefined` when the run is in a terminal state
 * or in a substrate-level "before-first-node" state.
 *
 * `pendingEffects` is the list of effect-slot ids (M1-10 contract) that
 * are in flight or completed but not yet observed by the projection's
 * materialiser. A `cancelled_with_active_effect` run will have a
 * non-empty `pendingEffects` — the cancellation handler reads them to
 * decide which compensations to enqueue.
 *
 * `pendingTimers` is the list of timer ids the run is waiting on, with
 * the `fireAt` epoch. A `waiting` run will typically have exactly one
 * entry; a `running` run may have several (sub-flows with their own
 * timers). The list is `readonly` because a new timer is appended
 * only via `scheduleTimer` (interface method), not by mutating the
 * projection.
 *
 * `lastTransitionAt` is the `occurredAt` of the most recent
 * `AtomicTransitionBoundary` the substrate accepted. It is the
 * substrate's view of "when did this run last change shape", which is
 * not necessarily the same as `updatedAt` (a `updatedAt` bump on the
 * underlying `WorkflowRun` may also come from a non-status event like
 * an effect completion).
 *
 * `lastError` is the stringified error of the most recent
 * `failed` transition. It is `undefined` for any other status.
 */
export const MaterializedRunProjectionSchema = z.object({
  /** The run the projection belongs to (undefined until replay binds it). */
  runId: z.string().optional(),
  /** The current status (undefined during cold replay). */
  status: WorkflowRunStatusSchema.optional(),
  /** The node currently being executed or awaiting decision. */
  activeNodeId: z.string().optional(),
  /** Effect-slot ids in flight or completed but not observed. */
  pendingEffects: z.array(z.string()).readonly().optional(),
  /** Timer ids the run is waiting on, with their `fireAt` epoch. */
  pendingTimers: z
    .array(
      z.object({
        timerId: z.string(),
        fireAt: z.number().int().nonnegative(),
      }),
    )
    .readonly()
    .optional(),
  /** `occurredAt` of the most recent status transition. */
  lastTransitionAt: z.number().int().nonnegative().optional(),
  /** Stringified error of the most recent `failed` transition. */
  lastError: z.string().optional(),
})

export type MaterializedRunProjection = z.infer<typeof MaterializedRunProjectionSchema>

/* ------------------------------------------------------------------ */
/* AtomicTransitionBoundary — status + effect slot, atomic (Plan §41) */
/* ------------------------------------------------------------------ */

/**
 * A status change coupled with an effect-slot reservation, atomic
 * across the substrate boundary (plan §41, ADR-004). The substrate
 * MUST persist the status change and the effect-slot reservation as
 * a single unit (a single WAL frame on `native`, a single transaction
 * on `dbos`, a single `UpdateWorkflow` on `temporal`); a half-applied
 * transition would corrupt the run state.
 *
 * The coupling is why both `from` and `to` are required (not inferred
 * from `runId`): the substrate needs both to validate the transition
 * is legal (ADR-022 §4 matrix — `running → waiting` is legal,
 * `completed → running` is not, etc.). The schema here only enforces
 * the *types*; the legality matrix is owned by ADR-022 and lives in
 * `@unifia/workflow-runtime` (post-M1-09 / M1-11).
 *
 * `effectSlotId` is the M1-10-branded `EffectSlot` (the contract is
 * still RED for M1-10, so we accept a plain `string` here and tighten
 * to the brand when M1-10 lands). Every transition that **starts** an
 * effect MUST name a slot; transitions that only change status
 * (e.g. `running → waiting` for a non-effect node) still carry a slot
 * reservation (e.g. a "no-op" slot) so the substrate can keep its
 * single-writer-per-run invariant.
 *
 * `occurredAt` is the wall-clock millisecond epoch the transition
 * is observed. Substrates MUST NOT accept a transition with
 * `occurredAt` in the future; the substrate-level check is owned by
 * `@unifia/workflow-runtime` and is not duplicated in the schema.
 *
 * `isCompensating` discriminates the **forward** transitions
 * (`running → completed`, `running → failed`, …) from the
 * **compensating** transitions emitted by the cancellation handler
 * (`cancelled` → `cancelled_with_active_effect` after a
 * `tool.*` effect is reconciled, …). The default is `false` because
 * every transition is a forward transition unless the caller is
 * explicitly emitting a compensation. The projection's
 * `lastError` field is only set on a forward `*→ failed` transition,
 * not on a compensating one.
 */
export const AtomicTransitionBoundarySchema = z.object({
  /** Status before the transition. */
  from: WorkflowRunStatusSchema,
  /** Status after the transition. */
  to: WorkflowRunStatusSchema,
  /** The effect-slot id reserved as part of this transition (M1-10 will brand). */
  effectSlotId: z
    .string()
    .min(1)
    .regex(/^\S(.*\S)?$/, "effectSlotId must not be empty or whitespace"),
  /** Wall-clock millisecond epoch the transition is observed. */
  occurredAt: z.number().int().nonnegative(),
  /** `true` if this is a compensating transition emitted by the cancellation handler. */
  isCompensating: z.boolean().default(false),
})

export type AtomicTransitionBoundary = z.infer<typeof AtomicTransitionBoundarySchema>

// Re-export so callers that import from this file see OverlapPolicySchema
// next to `scheduleTimer`'s parameter. Authoritative definition lives in
// `timer.ts` (Plan V2.3.1 §101, ADR-022).
export { OverlapPolicySchema }
export type { OverlapPolicy } from "./timer.js"
