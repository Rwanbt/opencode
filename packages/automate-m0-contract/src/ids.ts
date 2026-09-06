/* SPDX-License-Identifier: MIT */
/* Copyright (c) 2026 Unifia contributors */

/**
 * Identities and scopes of the M0 canonical contract (ADR-000 §17-§19).
 *
 * Every id here is a branded string. The brands are compile-time only —
 * they cost nothing at runtime, and they stop the single most likely
 * category of M0 bug: passing a `WorkflowRunId` where a
 * `LogicalInvocationId` belongs. Two candidates written in different
 * languages must agree on *which* identity is which, and the type system
 * is the cheapest place to enforce that on the TypeScript side.
 *
 * ADR-000 §18 is explicit that the concrete representation — UUID, ULID,
 * or another opaque format — is **not decided here**. So these are opaque
 * strings with a well-formedness floor, not a format.
 */

/* ------------------------------------------------------------------ */
/* Branding                                                            */
/* ------------------------------------------------------------------ */

declare const brand: unique symbol

type Branded<Name extends string> = string & { readonly [brand]: Name }

/* ------------------------------------------------------------------ */
/* Workflow identities (§17, §18)                                      */
/* ------------------------------------------------------------------ */

/** Immutable identity of a workflow version a run is pinned to (§33). */
export type WorkflowVersionId = Branded<"WorkflowVersionId">

/** Globally unique — never a store-local row id or a local counter (§18). */
export type WorkflowDeploymentId = Branded<"WorkflowDeploymentId">

/** Globally unique. Distinct from `WorkflowDefinition.id` (§5). */
export type WorkflowRunId = Branded<"WorkflowRunId">

/**
 * Stable across retry, restart, authority reacquisition and projection
 * rebuild (§19). A run holds 1..N of these.
 */
export type LogicalInvocationId = Branded<"LogicalInvocationId">

/** A single attempt at one logical invocation. New on every retry (§19). */
export type AttemptId = Branded<"AttemptId">

/** Never reusable in a way that could designate another request (§36). */
export type ApprovalId = Branded<"ApprovalId">

export type DurableTimerId = Branded<"DurableTimerId">

/** Opaque identity of one effect, derived from an EffectKey (§20). */
export type EffectId = Branded<"EffectId">

/* ------------------------------------------------------------------ */
/* Scopes (§17)                                                        */
/* ------------------------------------------------------------------ */

/**
 * Durable ownership carried by the run itself.
 *
 * §6 is the reason this is on the run: the Workbench Server's in-memory
 * `workflowId → workspaceId` map MUST NOT remain the source of truth for a
 * run's scope, and §82 lists "in-memory map as durable run ownership
 * authority" among the absolute prohibitions. Resume, cancel, inspect and
 * approve must all re-derive authorization from durable information.
 */
export interface OwnershipScope {
  readonly organizationId: string
  readonly workspaceId: string
  readonly projectId?: string
}

export interface DeploymentScope {
  readonly ownershipScope: OwnershipScope
  readonly environmentId: string
}

/* ------------------------------------------------------------------ */
/* Authority identity (§14, §16)                                       */
/* ------------------------------------------------------------------ */

/**
 * Which durable authority owns a run. Immutable for the life of the run
 * (§14) — a live authority migration is forbidden; changing it requires a
 * new run, or an explicit offline migration performed while no previous
 * authority can execute.
 *
 * Authoritative candidate matrix (M0 final closure, 2026-09-04):
 *   - UNIFIA_NATIVE             : TRUE FINALIST A
 *                                 real native SQLite via `bun:sqlite`,
 *                                 in-process + multi-process mode
 *   - DBOS_GO_SQLITE            : TRUE FINALIST B (not yet built)
 *                                 must actually use DBOS v1.0.0 Go APIs
 *                                 (DBOS Context, RegisterWorkflow, ...);
 *                                 placeholder value, no result file yet
 *   - CUSTOM_GO_SQLITE_CONTROL  : CONTROL (the Go binary that uses
 *                                 custom SQLite + blank DBOS import)
 *                                 kept to validate the harness and
 *                                 Unifia-owned semantics; does NOT vote
 *                                 in the ADR-000 A/B decision
 *
 * Historical note: the previous binary was misattributed to
 * `DBOS_GO_SQLITE` even though it used custom tables + a blank DBOS
 * import. It is now correctly labeled `CUSTOM_GO_SQLITE_CONTROL`.
 * Result files written before this rename still carry the legacy
 * `DBOS_GO_SQLITE` value; the harness reads them as
 * `CUSTOM_GO_SQLITE_CONTROL` when applying the per-candidate
 * governance rules.
 */
export const AUTHORITY_KINDS = ["UNIFIA_NATIVE", "DBOS_GO_SQLITE", "CUSTOM_GO_SQLITE_CONTROL"] as const
export type AuthorityKind = (typeof AUTHORITY_KINDS)[number]

/**
 * Resolve a legacy `DBOS_GO_SQLITE` kind to its current attribution
 * `CUSTOM_GO_SQLITE_CONTROL`. New evidence must use the new name
 * directly; this helper is only for reading historical result files.
 *
 * IMPORTANT (per Erwan review 2026-09-04): from CP6.4 onwards
 * `DBOS_GO_SQLITE` is a LEGITIMATE candidate identity (the real
 * DBOS v1.0.0 Go candidate once built). Therefore a bare
 * `DBOS_GO_SQLITE` string MUST NOT be silently re-interpreted
 * as `CUSTOM_GO_SQLITE_CONTROL`. The migration is provenance-
 * aware:
 *
 *   - The historical (pre-CP6.3) `M0_RESULTS_DBOS_GO_SQLITE.json`
 *     was produced by the custom Go + custom SQLite control.
 *     That file is archived at
 *     `docs/automation-v2/m0/archive/pre-cp6-3-attribution-repair/`
 *     and any reader that needs to consume the archived data
 *     must pass `provenance: "PRE_CP6_3_LEGACY"` to this function
 *     to receive `CUSTOM_GO_SQLITE_CONTROL`.
 *
 *   - For new evidence, the result file declares its own
 *     `candidate` value with full provenance metadata
 *     (`executionSubstrate`, `realDbosApisUsed`, etc.). The
 *     reader uses that metadata directly and does not call
 *     this function.
 *
 *   - This function is therefore a SAFETY NET for the
 *     transition period only, and it does NOT silently
 *     rewrite `DBOS_GO_SQLITE` to `CUSTOM_GO_SQLITE_CONTROL`
 *     without explicit provenance.
 */
export interface MigrationProvenance {
  /**
   * If `true`, the caller asserts that the artifact was
   * produced by the pre-CP6.3 Go binary (custom SQLite +
   * blank DBOS import). The function then resolves
   * `DBOS_GO_SQLITE` to `CUSTOM_GO_SQLITE_CONTROL`.
   * If `false` or omitted, `DBOS_GO_SQLITE` is treated as
   * the legitimate future candidate identity.
   */
  readonly preCP63LegacyAttribution?: boolean
}

export function normalizeAuthorityKind(
  kind: string,
  provenance: MigrationProvenance = {},
): AuthorityKind {
  if (kind === "CUSTOM_GO_SQLITE_CONTROL" || kind === "UNIFIA_NATIVE") {
    return kind
  }
  if (kind === "DBOS_GO_SQLITE") {
    if (provenance.preCP63LegacyAttribution === true) {
      return "CUSTOM_GO_SQLITE_CONTROL"
    }
    // Legitimate future candidate identity. No migration.
    return "DBOS_GO_SQLITE"
  }
  if (kind === "DBOS_GO_SQLITE_LEGACY" || kind === "DBOS_GO_SQLITE_CONTROL") {
    // Explicit legacy aliases always resolve to the control.
    return "CUSTOM_GO_SQLITE_CONTROL"
  }
  throw new Error(`Unknown AuthorityKind: ${kind}`)
}

export type AuthorityProtocolVersion = number

/**
 * A logical fencing epoch (§16). After generation N+1 activates, N must no
 * longer be able to commit authoritative state, authorize new external
 * dispatch, or complete an authoritative transition.
 *
 * An external substrate is **not required** to expose an integer by this
 * name — §16 asks it to demonstrate an equivalent stale-owner rejection
 * property. The harness measures the property, not the field.
 */
export type AuthorityGeneration = number

/** Schema version of the persisted state (§34). */
export type SchemaVersion = number

/* ------------------------------------------------------------------ */
/* Well-formedness                                                     */
/* ------------------------------------------------------------------ */

export class IdentityError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "IdentityError"
  }
}

/**
 * The floor every opaque identity must clear: non-empty, no surrounding
 * whitespace, and bounded.
 *
 * §18 forbids deriving business order from an id's encoding, so this
 * checks *shape* and nothing else — no UUID pattern, no ULID pattern.
 * Pinning a format here would quietly decide what §18 leaves open.
 */
export const MAX_IDENTITY_LENGTH = 256

export function assertWellFormedIdentity(value: string, label: string): void {
  if (typeof value !== "string") {
    throw new IdentityError(`${label} must be a string, got ${typeof value}`)
  }
  if (value.length === 0) {
    throw new IdentityError(`${label} must not be empty`)
  }
  if (value.trim() !== value) {
    throw new IdentityError(`${label} must not carry surrounding whitespace`)
  }
  if (value.length > MAX_IDENTITY_LENGTH) {
    throw new IdentityError(
      `${label} must be at most ${MAX_IDENTITY_LENGTH} characters, got ${value.length}`,
    )
  }
}

/** Narrow an opaque string into a branded identity, checking the floor. */
export function asIdentity<T extends Branded<string>>(value: string, label: string): T {
  assertWellFormedIdentity(value, label)
  return value as T
}

export const asWorkflowRunId = (value: string): WorkflowRunId =>
  asIdentity<WorkflowRunId>(value, "WorkflowRunId")
export const asWorkflowVersionId = (value: string): WorkflowVersionId =>
  asIdentity<WorkflowVersionId>(value, "WorkflowVersionId")
export const asWorkflowDeploymentId = (value: string): WorkflowDeploymentId =>
  asIdentity<WorkflowDeploymentId>(value, "WorkflowDeploymentId")
export const asLogicalInvocationId = (value: string): LogicalInvocationId =>
  asIdentity<LogicalInvocationId>(value, "LogicalInvocationId")
export const asAttemptId = (value: string): AttemptId =>
  asIdentity<AttemptId>(value, "AttemptId")
export const asApprovalId = (value: string): ApprovalId =>
  asIdentity<ApprovalId>(value, "ApprovalId")
export const asDurableTimerId = (value: string): DurableTimerId =>
  asIdentity<DurableTimerId>(value, "DurableTimerId")
export const asEffectId = (value: string): EffectId =>
  asIdentity<EffectId>(value, "EffectId")
