/**
 * lifecycle.ts — TEAM-C08: model lifecycle state machine.
 *
 * `schema.ts` (C01, frozen) already defines the 8-state `LifecycleStage`
 * enum on `Model.lifecycleStage` (schema.ts:106-115) but ships no state
 * machine — nothing in the codebase validates or enforces transitions
 * between those states before this card. This module is that state
 * machine: it does not touch `schema.ts` (not exported there, frozen) and
 * does not redefine the enum — `LifecycleStageSchema` below is a direct
 * reference to `Model.shape.lifecycleStage` (the exact zod enum instance
 * schema.ts already constructs), so there is exactly one place in the
 * codebase where the 8 stage names are spelled out.
 *
 * ---------------------------------------------------------------------
 * Transition graph — happy path + exceptional states
 * ---------------------------------------------------------------------
 *
 *   discovered ─────────► metadata_validated ─────────► probed
 *                                                          │
 *                                                          ▼
 *                                                 low_risk_eligible
 *                                                          │
 *                                                          ▼
 *                                                  general_eligible
 *                                                          │
 *                                                          ▼
 *                                                 trusted_by_domain
 *
 *   From low_risk_eligible, general_eligible, trusted_by_domain:
 *     ──► deprecated   (model was eligible/trusted for use; now retired —
 *                        always carries a replacement policy, see below)
 *
 *   From ANY non-terminal state (discovered .. trusted_by_domain):
 *     ──► quarantined  (emergency safety/policy removal — no elapsed-time
 *                        or health precondition; a perfectly healthy model
 *                        can be quarantined immediately)
 *
 *   deprecated and quarantined are TERMINAL: zero outgoing transitions.
 *   Re-review of a quarantined/deprecated model is a new-record decision
 *   made by an operator outside this module (e.g. registering a new model
 *   record via C01 ingestion), not a state-machine transition — keeping
 *   the graph acyclic makes "which stages can still change" a structural,
 *   inspectable fact instead of something only provable by tracing history.
 *
 * Rationale for NOT allowing deprecated from discovered/metadata_validated/
 * probed: "deprecated" means "this was offered for use and is now retired
 * in favor of something else" — a model still in onboarding was never
 * offered for use, so there is nothing to retire. If an early-stage model
 * needs to be rejected, `quarantined` is the correct (and available)
 * transition.
 *
 * ---------------------------------------------------------------------
 * Promotion conditions
 * ---------------------------------------------------------------------
 * Every FORWARD (happy-path) transition is gated by explicit, testable
 * conditions evaluated from a `TransitionEvidence` bundle the caller
 * supplies (never inferred, never defaulted silently):
 *
 *   discovered -> metadata_validated:
 *     independentSourceCount >= 1 — at least one source has actually
 *     observed this model. (Once a `Model` object legally exists per
 *     schema.ts, `sourceRefs.min(1)` already guarantees this — but this
 *     transition can be evaluated on a not-yet-fully-validated candidate
 *     during ingestion, so the check is asserted here too rather than
 *     assumed.)
 *
 *   metadata_validated -> probed:
 *     independentSourceCount >= 1 (same rationale — metadata validation
 *     does not itself add sources, so the count is simply re-affirmed).
 *     No health/benchmark precondition: entering probation is the step
 *     that produces the first health signal, so requiring one before
 *     entering probation would be circular.
 *
 *   probed -> low_risk_eligible:
 *     - minimum probation window elapsed (`MIN_PROBATION_MS`, 24h): a
 *       single lucky health check is not evidence of stability.
 *     - a health signal exists at all (`health !== null`): probation
 *       without a single recorded probe cannot promote — there is
 *       nothing to evaluate.
 *     - `health.availabilityScore >= LOW_RISK_MIN_AVAILABILITY` (0.8) and
 *       `health.errorRate1h <= LOW_RISK_MAX_ERROR_RATE` (0.2): loose
 *       thresholds appropriate for "low risk" contexts only (this is
 *       intentionally the least strict gate in the chain).
 *     These are the only two signals `health.ts` (frozen, C06) actually
 *     produces per `ModelHealth` (schema.ts:78-86) — no invented signal.
 *
 *   low_risk_eligible -> general_eligible:
 *     - longer elapsed window (`MIN_LOW_RISK_MS`, 7 days): general
 *       availability is a materially bigger blast radius than low-risk
 *       use, so the model must prove stability over a longer horizon.
 *     - stricter health thresholds (`GENERAL_MIN_AVAILABILITY` 0.95,
 *       `GENERAL_MAX_ERROR_RATE` 0.05).
 *     - `hasBenchmarkResult === true`: general availability additionally
 *       requires demonstrated capability data (`benchmarks.ts`, frozen,
 *       C05), not just uptime — an unbenchmarked model may be "up" but
 *       nobody has verified it is actually good at anything.
 *
 *   general_eligible -> trusted_by_domain:
 *     - same elapsed-window/health/benchmark data gates as above, evaluated
 *       over the longest window (`MIN_GENERAL_ELIGIBLE_MS`, 14 days), PLUS
 *     - a mandatory `explicitAction: { kind: "grant_trust" }` (see below).
 *       Trust is a curation decision, not a derived one: health and
 *       benchmark data can justify *eligibility* to be trusted, but they
 *       can never BE the trust grant themselves — that is exactly the
 *       "never silent auto-trust" doctrine this card also applies to
 *       collections.ts. In practice, this explicit action is expected to
 *       be issued by the same event that opts a model into an
 *       "elevated"-trust collection (see collections.ts), though the two
 *       modules are intentionally not code-coupled — each is independently
 *       testable and the caller is the one that wires the two decisions
 *       together.
 *
 *   ANY -> quarantined:
 *     requires `explicitAction: { kind: "quarantine" }` — no data-driven
 *     gate. Quarantine is a human/operator safety override, always
 *     available, never blocked by "not enough evidence yet".
 *
 *   ANY (low_risk_eligible | general_eligible | trusted_by_domain) -> deprecated:
 *     requires `explicitAction: { kind: "deprecate" }` carrying a mandatory
 *     replacement policy (`replacement: ReplacementRef` OR
 *     `explicitlyNoReplacement: true` — the caller must say one or the
 *     other; omitting both is rejected). A deprecation signal with no
 *     replacement guidance is, per this card's acceptance criteria,
 *     incomplete — this module makes it structurally impossible to skip.
 *
 * All rejections (structural: edge not in the graph; conditional:
 * promotion conditions unmet; procedural: missing mandatory explicit
 * action or replacement policy) throw a typed error — nothing here ever
 * silently allows or silently no-ops a transition attempt (fail closed,
 * consistent with the rest of this program's doctrine).
 *
 * ---------------------------------------------------------------------
 * Clock — injected at construction, never accepted as per-call evidence
 * ---------------------------------------------------------------------
 * `LifecycleStore` takes a `clock: () => string` at construction (default
 * `isoUtcNow`), and it is the SOLE source of every timestamp the store
 * ever persists — `initialize()`'s entry time, `transition()`'s `atUTC`
 * and the resulting `enteredAtUTC`/audit-log timestamps, and the "now"
 * used to evaluate every elapsed-time promotion condition. `TransitionEvidence`
 * carries no timestamp field at all: a caller cannot supply "now" any more
 * than it can supply "when did this model enter its current stage" (the
 * latter was already excluded from evidence for the same reason). This
 * closes a real gap in an earlier draft — see `elapsedMs`'s doc comment
 * for the specifics — where an optional `evidence.nowUTC` field let a
 * caller both bypass elapsed-time gates (a far-future timestamp defeats
 * `MIN_PROBATION_MS` etc. with zero real elapsed time) and corrupt the
 * persisted audit trail (the spoofed value was what got written back as
 * `enteredAtUTC`). Tests that need deterministic control over elapsed
 * time inject their own fake `clock` at construction (e.g. a closure over
 * a mutable counter) rather than passing a timestamp per call — the same
 * technique, just scoped to the trusted construction boundary instead of
 * the untrusted per-call evidence bundle.
 *
 * Allowed by TEAM-C08 scope manifest:
 *   - creation: packages/unifia/src/model-intelligence/lifecycle.ts
 */

import { NamedError } from "@unifia/util/error"
import z from "zod"
import { Model, isoUtcNow } from "./schema"
import type { ModelHealth } from "./schema"

// =====================================================================
// 1. Stage enum — reused, never redefined
// =====================================================================

/**
 * The exact zod enum `schema.ts` builds for `Model.lifecycleStage`. Not a
 * copy — a reference. `LIFECYCLE_STAGES` below is derived from this at
 * runtime so the 8 stage names exist in exactly one place in the codebase.
 */
export const LifecycleStageSchema = Model.shape.lifecycleStage
export type LifecycleStage = z.infer<typeof LifecycleStageSchema>

export const LIFECYCLE_STAGES: readonly LifecycleStage[] = LifecycleStageSchema.options

const TERMINAL_STAGES: ReadonlySet<LifecycleStage> = new Set(["deprecated", "quarantined"])

export function isTerminalStage(stage: LifecycleStage): boolean {
  return TERMINAL_STAGES.has(stage)
}

// =====================================================================
// 2. Transition graph
// =====================================================================

const HAPPY_PATH_TRANSITIONS: Record<LifecycleStage, readonly LifecycleStage[]> = {
  discovered: ["metadata_validated"],
  metadata_validated: ["probed"],
  probed: ["low_risk_eligible"],
  low_risk_eligible: ["general_eligible"],
  general_eligible: ["trusted_by_domain"],
  trusted_by_domain: [],
  deprecated: [],
  quarantined: [],
}

/** Stages from which "deprecated" is a valid exceptional transition. */
const DEPRECATABLE_FROM: ReadonlySet<LifecycleStage> = new Set([
  "low_risk_eligible",
  "general_eligible",
  "trusted_by_domain",
])

/**
 * The full, explicit valid-transition graph: happy path plus the
 * exceptional edges (quarantine from any non-terminal stage; deprecation
 * from the three "was eligible for use" stages). Computed once at module
 * load — never mutated.
 */
export const LIFECYCLE_TRANSITIONS: Readonly<Record<LifecycleStage, readonly LifecycleStage[]>> = (() => {
  const graph = {} as Record<LifecycleStage, LifecycleStage[]>
  for (const stage of LIFECYCLE_STAGES) {
    const edges = [...HAPPY_PATH_TRANSITIONS[stage]]
    if (!isTerminalStage(stage)) edges.push("quarantined")
    if (DEPRECATABLE_FROM.has(stage)) edges.push("deprecated")
    graph[stage] = edges
  }
  return graph
})()

export function validTransitionsFrom(stage: LifecycleStage): readonly LifecycleStage[] {
  return LIFECYCLE_TRANSITIONS[stage]
}

export function isStructurallyValidTransition(from: LifecycleStage, to: LifecycleStage): boolean {
  return LIFECYCLE_TRANSITIONS[from].includes(to)
}

// =====================================================================
// 3. Promotion condition thresholds — documented, defensible constants
// =====================================================================

/** Minimum time a model must remain in `probed` before `low_risk_eligible`. */
export const MIN_PROBATION_MS = 24 * 60 * 60 * 1000 // 24h — a single healthy probe is not stability evidence.
/** Minimum time a model must remain in `low_risk_eligible` before `general_eligible`. */
export const MIN_LOW_RISK_MS = 7 * 24 * 60 * 60 * 1000 // 7 days — general availability is a materially bigger blast radius.
/** Minimum time a model must remain in `general_eligible` before `trusted_by_domain`. */
export const MIN_GENERAL_ELIGIBLE_MS = 14 * 24 * 60 * 60 * 1000 // 14 days — trust is the highest-stakes promotion.

export const LOW_RISK_MIN_AVAILABILITY = 0.8
export const LOW_RISK_MAX_ERROR_RATE = 0.2
export const GENERAL_MIN_AVAILABILITY = 0.95
export const GENERAL_MAX_ERROR_RATE = 0.05

// =====================================================================
// 4. Evidence & explicit-action types
// =====================================================================

export interface ReplacementRef {
  providerID: string
  modelID: string
}

/**
 * A human/operator decision. Required for every transition into
 * `quarantined`, `deprecated`, or `trusted_by_domain` — these three
 * outcomes are never derived from health/benchmark data alone (see
 * module doc). `actor` and `reason` are mandatory so the decision is
 * always attributable and explained, never anonymous.
 */
export type ExplicitLifecycleAction =
  | { kind: "quarantine"; actor: string; reason: string }
  | {
      kind: "deprecate"
      actor: string
      reason: string
      replacement: ReplacementRef | null
      /**
       * Must be `true` when `replacement` is `null` — forces the caller to
       * make an explicit statement ("yes, there really is no replacement")
       * rather than omitting guidance by accident. See
       * `MissingReplacementPolicyError`.
       */
      explicitlyNoReplacement: boolean
    }
  | { kind: "grant_trust"; actor: string; reason: string }

export interface TransitionEvidence {
  /** Number of independent sources that have observed this model (mirrors `Model.sourceRefs.length`). */
  independentSourceCount: number
  /** Latest aggregated health signal (`Model.health`, or `health.ts::HealthWindowStore.aggregate()` output). `null` = never probed. */
  health: ModelHealth | null
  /** Whether at least one benchmark result is attached to this model (`benchmarks.ts::ModelBenchmarkProfile.results.length > 0`). */
  hasBenchmarkResult: boolean
  /** Required for `quarantined` / `deprecated` / `trusted_by_domain` — see `ExplicitLifecycleAction`. */
  explicitAction?: ExplicitLifecycleAction | null
}

// =====================================================================
// 5. Typed errors
// =====================================================================

export const InvalidLifecycleTransitionError = NamedError.create(
  "InvalidLifecycleTransitionError",
  z.object({
    providerID: z.string(),
    modelID: z.string(),
    from: LifecycleStageSchema,
    to: LifecycleStageSchema,
    message: z.string(),
  }),
)

export const LifecyclePromotionConditionsNotMetError = NamedError.create(
  "LifecyclePromotionConditionsNotMetError",
  z.object({
    providerID: z.string(),
    modelID: z.string(),
    from: LifecycleStageSchema,
    to: LifecycleStageSchema,
    unmetConditions: z.array(z.string()),
    message: z.string(),
  }),
)

export const MissingExplicitActionError = NamedError.create(
  "MissingExplicitActionError",
  z.object({
    providerID: z.string(),
    modelID: z.string(),
    to: LifecycleStageSchema,
    requiredActionKind: z.enum(["quarantine", "deprecate", "grant_trust"]),
    message: z.string(),
  }),
)

export const MissingReplacementPolicyError = NamedError.create(
  "MissingReplacementPolicyError",
  z.object({
    providerID: z.string(),
    modelID: z.string(),
    message: z.string(),
  }),
)

export const UnknownModelStageError = NamedError.create(
  "UnknownModelStageError",
  z.object({
    providerID: z.string(),
    modelID: z.string(),
    message: z.string(),
  }),
)

// =====================================================================
// 6. Promotion condition evaluation (pure, testable)
// =====================================================================

function elapsedMs(enteredAtUTC: string, nowUTC: string): number {
  return new Date(nowUTC).getTime() - new Date(enteredAtUTC).getTime()
}

/**
 * Pushes an elapsed-time gate check onto `unmet`. Fails CLOSED on a
 * non-finite `elapsed` (malformed/unparseable `enteredAtUTC` or `nowUTC`
 * — `new Date(...).getTime()` yields `NaN` for either) rather than
 * silently letting `NaN < thresholdMs` evaluate to `false` and be
 * mistaken for "threshold satisfied". This is the second half of the F1
 * fix: clock injection (see module doc) removes the ability for a caller
 * to supply an adversarial timestamp at all, but this check is kept as a
 * defense-in-depth backstop against a misbehaving injected `clock`
 * function — the module's documented "fail closed" guarantee must hold
 * even if that trust boundary is ever violated by a future caller.
 */
function pushElapsedGate(unmet: string[], elapsed: number, thresholdMs: number, label: string): void {
  if (!Number.isFinite(elapsed)) {
    unmet.push(
      `elapsed time for the "${label}" duration requirement could not be computed (non-finite result) — failing closed`,
    )
    return
  }
  if (elapsed < thresholdMs) {
    unmet.push(`minimum ${label} duration not met (elapsed=${elapsed}ms < required=${thresholdMs}ms)`)
  }
}

/**
 * Evaluates the DATA-DRIVEN promotion conditions for a happy-path forward
 * transition. Does NOT evaluate the structural graph (see
 * `isStructurallyValidTransition`) or the explicit-action requirement for
 * quarantine/deprecate/trust (see `requiredExplicitActionKind`) — those are
 * separate, orthogonal gates composed together in `LifecycleStore.transition`.
 *
 * `enteredAtUTC` (when the model entered `from`) and `nowUTC` (the
 * evaluation instant) are SEPARATE parameters rather than fields on
 * `TransitionEvidence` on purpose: both are facts the state machine itself
 * is authoritative about — `enteredAtUTC` recorded the moment the previous
 * transition was applied, `nowUTC` read from the store's injected `clock`
 * — so neither is ever accepted as caller-supplied evidence. A caller
 * cannot spoof "this model has been in probation for 3 days" by claiming
 * a favorable `now`: `LifecycleStore.transition` always supplies both
 * values from its own tracked state and its own clock, never from the
 * caller's claim. (An earlier draft accepted `nowUTC` as an optional field
 * on `TransitionEvidence`, which reopened exactly this hole — fixed by
 * moving the clock to construction-time injection instead. See the module
 * doc's "Clock" section.)
 *
 * Returns every unmet condition (not just the first) so a caller — or a
 * test — can see the full picture of what is missing, not just a single
 * boolean.
 */
export function evaluatePromotionConditions(
  from: LifecycleStage,
  to: LifecycleStage,
  enteredAtUTC: string,
  nowUTC: string,
  evidence: TransitionEvidence,
): { allowed: boolean; unmetConditions: string[] } {
  const unmet: string[] = []
  const elapsed = elapsedMs(enteredAtUTC, nowUTC)

  const edge = `${from}->${to}`
  switch (edge) {
    case "discovered->metadata_validated":
    case "metadata_validated->probed": {
      if (evidence.independentSourceCount < 1) {
        unmet.push("requires at least one independent sourceRef (independentSourceCount >= 1)")
      }
      break
    }
    case "probed->low_risk_eligible": {
      pushElapsedGate(unmet, elapsed, MIN_PROBATION_MS, "probation")
      if (!evidence.health) {
        unmet.push("no health signal recorded during probation (a probe result is required)")
      } else {
        if (evidence.health.availabilityScore < LOW_RISK_MIN_AVAILABILITY) {
          unmet.push(
            `availabilityScore too low (${evidence.health.availabilityScore} < ${LOW_RISK_MIN_AVAILABILITY})`,
          )
        }
        if (evidence.health.errorRate1h > LOW_RISK_MAX_ERROR_RATE) {
          unmet.push(`errorRate1h too high (${evidence.health.errorRate1h} > ${LOW_RISK_MAX_ERROR_RATE})`)
        }
      }
      break
    }
    case "low_risk_eligible->general_eligible": {
      pushElapsedGate(unmet, elapsed, MIN_LOW_RISK_MS, "low-risk")
      if (!evidence.health) {
        unmet.push("no health signal recorded (a probe result is required)")
      } else {
        if (evidence.health.availabilityScore < GENERAL_MIN_AVAILABILITY) {
          unmet.push(`availabilityScore too low (${evidence.health.availabilityScore} < ${GENERAL_MIN_AVAILABILITY})`)
        }
        if (evidence.health.errorRate1h > GENERAL_MAX_ERROR_RATE) {
          unmet.push(`errorRate1h too high (${evidence.health.errorRate1h} > ${GENERAL_MAX_ERROR_RATE})`)
        }
      }
      if (!evidence.hasBenchmarkResult) {
        unmet.push("general availability requires at least one attached benchmark result")
      }
      break
    }
    case "general_eligible->trusted_by_domain": {
      pushElapsedGate(unmet, elapsed, MIN_GENERAL_ELIGIBLE_MS, "general-eligible")
      if (!evidence.health) {
        unmet.push("no health signal recorded (a probe result is required)")
      } else {
        if (evidence.health.availabilityScore < GENERAL_MIN_AVAILABILITY) {
          unmet.push(`availabilityScore too low (${evidence.health.availabilityScore} < ${GENERAL_MIN_AVAILABILITY})`)
        }
        if (evidence.health.errorRate1h > GENERAL_MAX_ERROR_RATE) {
          unmet.push(`errorRate1h too high (${evidence.health.errorRate1h} > ${GENERAL_MAX_ERROR_RATE})`)
        }
      }
      if (!evidence.hasBenchmarkResult) {
        unmet.push("trust requires at least one attached benchmark result")
      }
      // The mandatory `grant_trust` explicit action is checked separately —
      // see `requiredExplicitActionKind` / `LifecycleStore.transition`.
      break
    }
    default:
      // Exceptional edges (-> quarantined, -> deprecated) have no
      // data-driven gate: they are enforced structurally via the explicit
      // action requirement only.
      break
  }

  return { allowed: unmet.length === 0, unmetConditions: unmet }
}

/** Which `ExplicitLifecycleAction.kind` is mandatory for a transition into `to`, or `null` if none is required. */
export function requiredExplicitActionKind(to: LifecycleStage): ExplicitLifecycleAction["kind"] | null {
  if (to === "quarantined") return "quarantine"
  if (to === "deprecated") return "deprecate"
  if (to === "trusted_by_domain") return "grant_trust"
  return null
}

// =====================================================================
// 7. LifecycleStore — stateful, injectable-friendly transition engine
//
// Mirrors the `PricingStore` (pricing.ts, TEAM-C04) / `HealthWindowStore`
// (health.ts, TEAM-C06) convention: an in-memory store holding current
// state plus an append-only audit log, exposing a synchronous
// subscribe/publish hook. No hidden singleton — callers construct their
// own instance and inject it wherever needed.
// =====================================================================

export interface LifecycleTransitionRecord {
  providerID: string
  modelID: string
  from: LifecycleStage
  to: LifecycleStage
  atUTC: string
  unmetConditionsChecked: string[]
  explicitAction: ExplicitLifecycleAction | null
  deprecationSignal: DeprecationSignal | null
}

export interface DeprecationPolicy {
  replacement: ReplacementRef | null
  explicitlyNoReplacement: boolean
}

export interface DeprecationSignal {
  type: "lifecycle.model.deprecated"
  providerID: string
  modelID: string
  atUTC: string
  reason: string
  actor: string
  /** Human-readable warning — always present, never optional. */
  warning: string
  policy: DeprecationPolicy
}

function modelKey(providerID: string, modelID: string): string {
  return `${providerID}::${modelID}`
}

function buildDeprecationSignal(
  providerID: string,
  modelID: string,
  action: Extract<ExplicitLifecycleAction, { kind: "deprecate" }>,
  atUTC: string,
): DeprecationSignal {
  const replacementText = action.replacement
    ? `use ${action.replacement.providerID}/${action.replacement.modelID} instead`
    : "no replacement is currently designated"
  return {
    type: "lifecycle.model.deprecated",
    providerID,
    modelID,
    atUTC,
    reason: action.reason,
    actor: action.actor,
    warning: `Model ${providerID}/${modelID} is deprecated as of ${atUTC} (${action.reason}); ${replacementText}.`,
    policy: {
      replacement: action.replacement,
      explicitlyNoReplacement: action.explicitlyNoReplacement,
    },
  }
}

export class LifecycleStore {
  private readonly current = new Map<string, { stage: LifecycleStage; enteredAtUTC: string }>()
  private readonly log: LifecycleTransitionRecord[] = []
  private readonly listeners: Array<(record: LifecycleTransitionRecord) => void> = []
  private readonly clock: () => string

  /**
   * `clock` is the SOLE source of every timestamp this store ever
   * persists (see the module doc's "Clock" section for the full
   * rationale). Defaults to `isoUtcNow()` — real wall-clock time — but
   * tests inject a fake clock here (e.g. a closure over a mutable
   * counter) to get deterministic control over elapsed-time promotion
   * conditions without ever exposing a timestamp on the untrusted
   * per-call `TransitionEvidence`.
   */
  constructor(clock: () => string = isoUtcNow) {
    this.clock = clock
  }

  /**
   * Registers a model at `discovered` (the only legal entry point into the
   * state machine). Throws if the model is already tracked — re-initializing
   * would silently discard transition history, which this store never does.
   * The entry timestamp always comes from `this.clock()` — never a caller
   * parameter — for the same reason `transition()`'s `atUTC` does (see
   * module doc "Clock" section / F1 fix).
   */
  initialize(providerID: string, modelID: string): void {
    const key = modelKey(providerID, modelID)
    if (this.current.has(key)) {
      throw new InvalidLifecycleTransitionError({
        providerID,
        modelID,
        from: "discovered",
        to: "discovered",
        message: `model ${providerID}/${modelID} is already tracked; initialize() must only be called once`,
      })
    }
    this.current.set(key, { stage: "discovered", enteredAtUTC: this.clock() })
  }

  /** Current stage + when it was entered. Throws if the model was never `initialize()`d — never silently defaults to `discovered`. */
  getStage(providerID: string, modelID: string): { stage: LifecycleStage; enteredAtUTC: string } {
    const entry = this.current.get(modelKey(providerID, modelID))
    if (!entry) {
      throw new UnknownModelStageError({
        providerID,
        modelID,
        message: `model ${providerID}/${modelID} has no tracked lifecycle stage; call initialize() first`,
      })
    }
    return entry
  }

  isTracked(providerID: string, modelID: string): boolean {
    return this.current.has(modelKey(providerID, modelID))
  }

  /** Full transition audit log, optionally filtered to one model. */
  history(providerID?: string, modelID?: string): LifecycleTransitionRecord[] {
    if (!providerID) return [...this.log]
    return this.log.filter((r) => r.providerID === providerID && (!modelID || r.modelID === modelID))
  }

  onTransition(listener: (record: LifecycleTransitionRecord) => void): () => void {
    this.listeners.push(listener)
    return () => {
      const idx = this.listeners.indexOf(listener)
      if (idx >= 0) this.listeners.splice(idx, 1)
    }
  }

  /**
   * Attempts a transition. Composes THREE independent gates, in order,
   * every one of which can reject:
   *   1. structural — is `to` reachable from the current stage at all?
   *   2. procedural — does `to` require a mandatory `explicitAction`
   *      (quarantine/deprecate/grant_trust), and if so is it present with
   *      the matching `kind` (and, for deprecate, a complete replacement
   *      policy)?
   *   3. conditional — for happy-path forward transitions, are the
   *      data-driven promotion conditions satisfied (see
   *      `evaluatePromotionConditions`)?
   *
   * Any failing gate throws a typed error; the store is left completely
   * unchanged (no partial application). On success the new stage is
   * recorded, an audit entry is appended, and subscribers are notified
   * synchronously.
   */
  transition(
    providerID: string,
    modelID: string,
    to: LifecycleStage,
    evidence: TransitionEvidence,
  ): LifecycleTransitionRecord {
    const { stage: from, enteredAtUTC } = this.getStage(providerID, modelID)
    const atUTC = this.clock()

    if (!isStructurallyValidTransition(from, to)) {
      throw new InvalidLifecycleTransitionError({
        providerID,
        modelID,
        from,
        to,
        message: `transition ${from} -> ${to} is not in the valid lifecycle graph (valid targets from ${from}: ${validTransitionsFrom(from).join(", ") || "<none, terminal stage>"})`,
      })
    }

    const requiredKind = requiredExplicitActionKind(to)
    let deprecationSignal: DeprecationSignal | null = null

    if (requiredKind) {
      const action = evidence.explicitAction ?? null
      if (!action || action.kind !== requiredKind) {
        throw new MissingExplicitActionError({
          providerID,
          modelID,
          to,
          requiredActionKind: requiredKind,
          message: `transition to ${to} requires an explicit "${requiredKind}" action; ${action ? `got "${action.kind}"` : "none was provided"}`,
        })
      }
      if (action.kind === "deprecate") {
        if (action.replacement === null && action.explicitlyNoReplacement !== true) {
          throw new MissingReplacementPolicyError({
            providerID,
            modelID,
            message:
              "deprecate action must specify either a `replacement` model reference or `explicitlyNoReplacement: true` — a deprecation without replacement guidance is not allowed",
          })
        }
        deprecationSignal = buildDeprecationSignal(providerID, modelID, action, atUTC)
      }
    }

    let unmetConditionsChecked: string[] = []
    if (!requiredKind) {
      // Only happy-path forward transitions reach here (quarantine/deprecate/
      // trust all have a requiredKind and were already gated above).
      const evaluation = evaluatePromotionConditions(from, to, enteredAtUTC, atUTC, evidence)
      unmetConditionsChecked = evaluation.unmetConditions
      if (!evaluation.allowed) {
        throw new LifecyclePromotionConditionsNotMetError({
          providerID,
          modelID,
          from,
          to,
          unmetConditions: evaluation.unmetConditions,
          message: `promotion conditions not met for ${from} -> ${to}: ${evaluation.unmetConditions.join("; ")}`,
        })
      }
    } else if (to === "trusted_by_domain") {
      // trusted_by_domain is BOTH gated by the explicit grant_trust action
      // (checked above) AND by the same data-driven conditions as any other
      // forward promotion (elapsed time, health, benchmark presence) — the
      // explicit action alone is necessary but not sufficient.
      const evaluation = evaluatePromotionConditions(from, to, enteredAtUTC, atUTC, evidence)
      unmetConditionsChecked = evaluation.unmetConditions
      if (!evaluation.allowed) {
        throw new LifecyclePromotionConditionsNotMetError({
          providerID,
          modelID,
          from,
          to,
          unmetConditions: evaluation.unmetConditions,
          message: `promotion conditions not met for ${from} -> ${to}: ${evaluation.unmetConditions.join("; ")}`,
        })
      }
    }

    this.current.set(modelKey(providerID, modelID), { stage: to, enteredAtUTC: atUTC })

    const record: LifecycleTransitionRecord = {
      providerID,
      modelID,
      from,
      to,
      atUTC,
      unmetConditionsChecked,
      explicitAction: evidence.explicitAction ?? null,
      deprecationSignal,
    }
    this.log.push(record)
    for (const listener of this.listeners) listener(record)

    return record
  }
}
