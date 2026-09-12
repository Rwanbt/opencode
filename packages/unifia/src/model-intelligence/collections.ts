/**
 * collections.ts — TEAM-C08: dynamic, versioned model collections with
 * mandatory explicit opt-in.
 *
 * A "collection" is a named, user-curated grouping of models defined by a
 * FILTER (criteria), not a frozen list of results. Re-evaluating a
 * collection against a fresh candidate list (e.g. after `sync.ts` commits
 * new models, or after `lifecycle.ts` promotes a model to a new stage)
 * always reflects the current registry — this module never persists a
 * point-in-time snapshot of "which models matched" as the source of truth,
 * only the filter DEFINITION and its version history. This is the
 * "dynamic" half of the card.
 *
 * ---------------------------------------------------------------------
 * Mandatory explicit opt-in — the "never silent auto-trust" half
 * ---------------------------------------------------------------------
 * Every collection carries a `trustLevel`:
 *   - "standard": an organizational grouping with no trust implication
 *     (e.g. "my python models"). Membership = whatever currently matches
 *     the filter. No opt-in bookkeeping needed or created.
 *   - "elevated": a collection whose membership is meant to carry some
 *     elevated-trust implication for its consumer (e.g. "my trusted coding
 *     models", intended to feed `lifecycle.ts`'s `grant_trust` explicit
 *     action — see that module's doc). For an elevated collection, a
 *     filter match is NECESSARY but never SUFFICIENT for membership: only
 *     models with an explicit, attributable, revocable `OptInGrant`
 *     recorded against THIS collection actually become members.
 *     `resolveMembers` returns filter matches that lack a grant in a
 *     separate `filterMatchedButPendingOptIn` list — visible, not
 *     swallowed — so nothing is silently excluded either.
 *
 * This guarantee holds regardless of how broad the filter is: an elevated
 * collection with an empty (catch-all) filter still starts with ZERO
 * members until each one is explicitly opted in, because the opt-in gate
 * is evaluated independently of the filter (see `resolveMembers`). There
 * is no code path in this module that grants elevated membership from
 * filter match alone.
 *
 * `lifecycle.ts` (this same card) and `collections.ts` are deliberately
 * NOT code-coupled: each is a self-contained, independently testable peer
 * module. The intended integration (a caller invoking
 * `collections.grantOptIn(...)` and then `lifecycle.transition(..., "trusted_by_domain", { explicitAction: { kind: "grant_trust", ... } })`
 * together) lives in whatever orchestration layer wires both modules up —
 * out of scope for this card, documented here for the next integrator.
 *
 * ---------------------------------------------------------------------
 * Versioning
 * ---------------------------------------------------------------------
 * `updateFilter()` never mutates a definition in place: it appends a new
 * `CollectionDefinitionVersion` (incrementing `version`) and retains every
 * prior version for audit — mirrors `pricing.ts`'s `PriceSnapshot` history
 * approach (append, never overwrite).
 *
 * ---------------------------------------------------------------------
 * Storage shape
 * ---------------------------------------------------------------------
 * Follows the `HealthWindowStore` (health.ts, C06) / `PricingStore`
 * (pricing.ts, C04) convention: a `CollectionStore` interface plus one
 * in-memory implementation (`createInMemoryCollectionStore`), so a real
 * persistence backend can implement the same interface later without
 * changing any caller. Chosen over a class-only design (like
 * `PricingStore`) because collection opt-in grants are exactly the kind
 * of durable, audit-sensitive user data that is very likely to need a
 * real backend before pricing history or lifecycle transitions would
 * (opt-ins directly gate trust) — an interface boundary here is not
 * speculative, it is the same boundary `health.ts` already drew for its
 * comparably sensitive redacted-observation data.
 *
 * Allowed by TEAM-C08 scope manifest:
 *   - creation: packages/unifia/src/model-intelligence/collections.ts
 */

import { NamedError } from "@unifia/util/error"
import z from "zod"
import { isoUtcNow } from "./schema"
import type { ModelCapabilities } from "./schema"
import type { LifecycleStage } from "./lifecycle"

// =====================================================================
// 1. Core reference & filter types
// =====================================================================

export interface ModelRef {
  providerID: string
  modelID: string
}

function refKey(ref: ModelRef): string {
  return `${ref.providerID}::${ref.modelID}`
}

function refEquals(a: ModelRef, b: ModelRef): boolean {
  return a.providerID === b.providerID && a.modelID === b.modelID
}

/**
 * The minimal shape of a model needed to evaluate a filter. Deliberately
 * NOT the full frozen `Model` type (schema.ts) — a collection filter only
 * ever needs a handful of signals, and requiring a full `Model` object
 * would force every caller/test to construct one. Callers project their
 * `Model` (+ health + benchmark data) into this shape.
 */
export interface FilterableModel {
  providerID: string
  modelID: string
  lifecycleStage: LifecycleStage
  capabilities: ModelCapabilities
  /** Mirrors `Model.health.availabilityScore`. `null` = never probed. */
  availabilityScore: number | null
  /** Mirrors `benchmarks.ts::ModelBenchmarkProfile.results.length > 0`. */
  hasBenchmarkResult: boolean
}

/**
 * Serializable filter criteria — never arbitrary code, so a definition can
 * be persisted, diffed, and re-evaluated deterministically. All fields are
 * "AND"ed together except `explicitModelRefs`, which is an "OR" (manual
 * pinning in addition to whatever else matches).
 */
export interface CollectionFilterCriteria {
  providerIDs: string[] | null
  lifecycleStages: LifecycleStage[] | null
  minAvailabilityScore: number | null
  requiresBenchmarkResult: boolean
  requiredCapabilities: Partial<Record<keyof ModelCapabilities, boolean>> | null
  /** Manually pinned models, included regardless of the other criteria (still subject to opt-in gating on "elevated" collections). */
  explicitModelRefs: ModelRef[] | null
}

export function emptyFilterCriteria(): CollectionFilterCriteria {
  return {
    providerIDs: null,
    lifecycleStages: null,
    minAvailabilityScore: null,
    requiresBenchmarkResult: false,
    requiredCapabilities: null,
    explicitModelRefs: null,
  }
}

/**
 * Pure filter evaluation — exported for direct unit testing independent of
 * any store. `true` means the model is a CANDIDATE; for "elevated"
 * collections, candidacy alone is never membership (see module doc).
 */
export function matchesFilter(filter: CollectionFilterCriteria, model: FilterableModel): boolean {
  const explicitMatch = filter.explicitModelRefs?.some((r) => refEquals(r, model)) ?? false
  if (explicitMatch) return true

  if (filter.providerIDs && !filter.providerIDs.includes(model.providerID)) return false
  if (filter.lifecycleStages && !filter.lifecycleStages.includes(model.lifecycleStage)) return false
  if (filter.minAvailabilityScore !== null) {
    if (model.availabilityScore === null || model.availabilityScore < filter.minAvailabilityScore) return false
  }
  if (filter.requiresBenchmarkResult && !model.hasBenchmarkResult) return false
  if (filter.requiredCapabilities) {
    for (const [key, required] of Object.entries(filter.requiredCapabilities)) {
      if (required && !model.capabilities[key as keyof ModelCapabilities]) return false
    }
  }
  return true
}

// =====================================================================
// 2. Collection definition & versioning
// =====================================================================

export const CollectionTrustLevelSchema = z.enum(["standard", "elevated"])
export type CollectionTrustLevel = z.infer<typeof CollectionTrustLevelSchema>

export interface CollectionDefinitionVersion {
  version: number
  filter: CollectionFilterCriteria
  recordedAtUTC: string
  changeReason: string
}

export interface CollectionDefinition {
  id: string
  name: string
  trustLevel: CollectionTrustLevel
  currentVersion: number
  createdAtUTC: string
  updatedAtUTC: string
}

export interface CreateCollectionInput {
  id: string
  name: string
  trustLevel: CollectionTrustLevel
  filter: CollectionFilterCriteria
}

// =====================================================================
// 3. Opt-in grants (elevated collections only)
// =====================================================================

export interface OptInGrant {
  collectionID: string
  providerID: string
  modelID: string
  grantedBy: string
  reason: string
  grantedAtUTC: string
  /** `null` while active; set the moment the grant is revoked. Never deleted — revocation is itself an audited event. */
  revokedAtUTC: string | null
}

export interface OptInEvent {
  type: "granted" | "revoked"
  collectionID: string
  providerID: string
  modelID: string
  actor: string
  reason: string
  atUTC: string
}

// =====================================================================
// 4. Resolution result
// =====================================================================

export interface CollectionResolution {
  collectionID: string
  version: number
  trustLevel: CollectionTrustLevel
  /** Final resolved membership — for "elevated" collections, always a subset of active opt-ins. */
  members: ModelRef[]
  /**
   * "elevated" only: models that matched the filter but have no active
   * opt-in grant recorded against this collection. Always populated (never
   * silently dropped) so a UI can prompt the user, and so a test can prove
   * the gate is real rather than just "empty because nothing matched".
   */
  filterMatchedButPendingOptIn: ModelRef[]
  resolvedAtUTC: string
}

// =====================================================================
// 5. Typed errors
// =====================================================================

export const CollectionNotFoundError = NamedError.create(
  "CollectionNotFoundError",
  z.object({
    collectionID: z.string(),
    message: z.string(),
  }),
)

export const DuplicateCollectionIdError = NamedError.create(
  "DuplicateCollectionIdError",
  z.object({
    collectionID: z.string(),
    message: z.string(),
  }),
)

export const InvalidCollectionDefinitionError = NamedError.create(
  "InvalidCollectionDefinitionError",
  z.object({
    collectionID: z.string(),
    reason: z.enum(["empty_id", "empty_name", "empty_change_reason", "invalid_min_availability"]),
    message: z.string(),
  }),
)

export const InvalidOptInGrantError = NamedError.create(
  "InvalidOptInGrantError",
  z.object({
    collectionID: z.string(),
    providerID: z.string(),
    modelID: z.string(),
    reason: z.enum(["empty_granted_by", "empty_reason", "not_elevated_collection"]),
    message: z.string(),
  }),
)

export const OptInGrantNotFoundError = NamedError.create(
  "OptInGrantNotFoundError",
  z.object({
    collectionID: z.string(),
    providerID: z.string(),
    modelID: z.string(),
    message: z.string(),
  }),
)

// =====================================================================
// 6. Validation helpers
// =====================================================================

function assertValidFilter(collectionID: string, filter: CollectionFilterCriteria): void {
  if (filter.minAvailabilityScore !== null) {
    if (
      !Number.isFinite(filter.minAvailabilityScore) ||
      filter.minAvailabilityScore < 0 ||
      filter.minAvailabilityScore > 1
    ) {
      throw new InvalidCollectionDefinitionError({
        collectionID,
        reason: "invalid_min_availability",
        message: `minAvailabilityScore must be a finite number in [0, 1], got ${filter.minAvailabilityScore}`,
      })
    }
  }
}

// =====================================================================
// 7. CollectionStore interface + in-memory implementation
// =====================================================================

export interface CollectionStore {
  create(input: CreateCollectionInput): CollectionDefinition
  get(id: string): CollectionDefinition | null
  list(): CollectionDefinition[]
  /** Appends a new version (never mutates a prior one). Throws if `id` is unknown. */
  updateFilter(id: string, filter: CollectionFilterCriteria, changeReason: string): CollectionDefinition
  /** Full version history, oldest first. */
  history(id: string): CollectionDefinitionVersion[]
  /** The filter criteria of the current (latest) version. Throws if `id` is unknown. */
  currentFilter(id: string): CollectionFilterCriteria

  /** Records an explicit opt-in grant. Throws on a "standard" (non-elevated) collection — opt-ins are only meaningful where trust is elevated. */
  grantOptIn(collectionID: string, ref: ModelRef, grantedBy: string, reason: string): OptInGrant
  /** Revokes a previously granted opt-in. Throws if no grant exists for this (collection, model) pair. */
  revokeOptIn(collectionID: string, ref: ModelRef, revokedBy: string, reason: string): OptInGrant
  /** All grants recorded for this collection (active AND revoked — revocation status visible on each). */
  optIns(collectionID: string): OptInGrant[]
  /** Only the currently-active (non-revoked) grants. */
  activeOptIns(collectionID: string): OptInGrant[]
  /** Full append-only opt-in audit log, optionally filtered by collection. */
  optInEvents(collectionID?: string): OptInEvent[]
  onOptInEvent(listener: (event: OptInEvent) => void): () => void

  /**
   * Resolves current membership against a caller-supplied candidate list
   * (the "dynamic" evaluation — never a cached result). Throws if `id` is
   * unknown.
   */
  resolveMembers(collectionID: string, candidates: FilterableModel[]): CollectionResolution
}

export function createInMemoryCollectionStore(): CollectionStore {
  const definitions = new Map<string, CollectionDefinition>()
  const versions = new Map<string, CollectionDefinitionVersion[]>()
  const grants = new Map<string, Map<string, OptInGrant>>()
  const optInLog: OptInEvent[] = []
  const optInListeners: Array<(event: OptInEvent) => void> = []

  function requireDefinition(id: string): CollectionDefinition {
    const def = definitions.get(id)
    if (!def) {
      throw new CollectionNotFoundError({
        collectionID: id,
        message: `no collection registered with id "${id}"`,
      })
    }
    return def
  }

  const store: CollectionStore = {
    create(input) {
      if (input.id.length === 0) {
        throw new InvalidCollectionDefinitionError({
          collectionID: input.id,
          reason: "empty_id",
          message: "collection id must not be empty",
        })
      }
      if (input.name.length === 0) {
        throw new InvalidCollectionDefinitionError({
          collectionID: input.id,
          reason: "empty_name",
          message: "collection name must not be empty",
        })
      }
      if (definitions.has(input.id)) {
        throw new DuplicateCollectionIdError({
          collectionID: input.id,
          message: `collection id "${input.id}" already exists`,
        })
      }
      assertValidFilter(input.id, input.filter)

      const now = isoUtcNow()
      const definition: CollectionDefinition = {
        id: input.id,
        name: input.name,
        trustLevel: input.trustLevel,
        currentVersion: 1,
        createdAtUTC: now,
        updatedAtUTC: now,
      }
      definitions.set(input.id, definition)
      versions.set(input.id, [
        { version: 1, filter: input.filter, recordedAtUTC: now, changeReason: "initial definition" },
      ])
      grants.set(input.id, new Map())
      return definition
    },

    get(id) {
      return definitions.get(id) ?? null
    },

    list() {
      return [...definitions.values()]
    },

    updateFilter(id, filter, changeReason) {
      const definition = requireDefinition(id)
      if (changeReason.length === 0) {
        throw new InvalidCollectionDefinitionError({
          collectionID: id,
          reason: "empty_change_reason",
          message: "changeReason must not be empty — every version bump must be attributable",
        })
      }
      assertValidFilter(id, filter)

      const history = versions.get(id) ?? []
      const nextVersion = definition.currentVersion + 1
      const now = isoUtcNow()
      history.push({ version: nextVersion, filter, recordedAtUTC: now, changeReason })
      versions.set(id, history)

      const updated: CollectionDefinition = { ...definition, currentVersion: nextVersion, updatedAtUTC: now }
      definitions.set(id, updated)
      return updated
    },

    history(id) {
      requireDefinition(id)
      return [...(versions.get(id) ?? [])]
    },

    currentFilter(id) {
      const definition = requireDefinition(id)
      const history = versions.get(id) ?? []
      const current = history.find((v) => v.version === definition.currentVersion)
      // Invariant: every tracked definition always has its current version
      // present in history (create() and updateFilter() always push
      // together) — if this ever fires, it is a bug in this module, not a
      // caller error, so a plain assertion-style throw is appropriate.
      if (!current) throw new Error(`invariant violated: collection "${id}" has no version ${definition.currentVersion} in history`)
      return current.filter
    },

    grantOptIn(collectionID, ref, grantedBy, reason) {
      const definition = requireDefinition(collectionID)
      if (definition.trustLevel !== "elevated") {
        throw new InvalidOptInGrantError({
          collectionID,
          providerID: ref.providerID,
          modelID: ref.modelID,
          reason: "not_elevated_collection",
          message: `collection "${collectionID}" is "${definition.trustLevel}", not "elevated" — opt-in grants are only meaningful on elevated collections`,
        })
      }
      if (grantedBy.length === 0) {
        throw new InvalidOptInGrantError({
          collectionID,
          providerID: ref.providerID,
          modelID: ref.modelID,
          reason: "empty_granted_by",
          message: "grantedBy must not be empty — an opt-in grant must always be attributable",
        })
      }
      if (reason.length === 0) {
        throw new InvalidOptInGrantError({
          collectionID,
          providerID: ref.providerID,
          modelID: ref.modelID,
          reason: "empty_reason",
          message: "reason must not be empty — an opt-in grant must always be explained",
        })
      }

      const now = isoUtcNow()
      const grant: OptInGrant = {
        collectionID,
        providerID: ref.providerID,
        modelID: ref.modelID,
        grantedBy,
        reason,
        grantedAtUTC: now,
        revokedAtUTC: null,
      }
      const collectionGrants = grants.get(collectionID) ?? new Map<string, OptInGrant>()
      collectionGrants.set(refKey(ref), grant)
      grants.set(collectionID, collectionGrants)

      const event: OptInEvent = {
        type: "granted",
        collectionID,
        providerID: ref.providerID,
        modelID: ref.modelID,
        actor: grantedBy,
        reason,
        atUTC: now,
      }
      optInLog.push(event)
      for (const listener of optInListeners) listener(event)

      return grant
    },

    revokeOptIn(collectionID, ref, revokedBy, reason) {
      requireDefinition(collectionID)
      const collectionGrants = grants.get(collectionID) ?? new Map<string, OptInGrant>()
      const existing = collectionGrants.get(refKey(ref))
      if (!existing || existing.revokedAtUTC !== null) {
        throw new OptInGrantNotFoundError({
          collectionID,
          providerID: ref.providerID,
          modelID: ref.modelID,
          message: `no active opt-in grant found for ${ref.providerID}/${ref.modelID} on collection "${collectionID}"`,
        })
      }

      const now = isoUtcNow()
      const revoked: OptInGrant = { ...existing, revokedAtUTC: now }
      collectionGrants.set(refKey(ref), revoked)
      grants.set(collectionID, collectionGrants)

      const event: OptInEvent = {
        type: "revoked",
        collectionID,
        providerID: ref.providerID,
        modelID: ref.modelID,
        actor: revokedBy,
        reason,
        atUTC: now,
      }
      optInLog.push(event)
      for (const listener of optInListeners) listener(event)

      return revoked
    },

    optIns(collectionID) {
      requireDefinition(collectionID)
      return [...(grants.get(collectionID) ?? new Map()).values()]
    },

    activeOptIns(collectionID) {
      return store.optIns(collectionID).filter((g) => g.revokedAtUTC === null)
    },

    optInEvents(collectionID) {
      if (!collectionID) return [...optInLog]
      return optInLog.filter((e) => e.collectionID === collectionID)
    },

    onOptInEvent(listener) {
      optInListeners.push(listener)
      return () => {
        const idx = optInListeners.indexOf(listener)
        if (idx >= 0) optInListeners.splice(idx, 1)
      }
    },

    resolveMembers(collectionID, candidates) {
      const definition = requireDefinition(collectionID)
      const filter = store.currentFilter(collectionID)
      const matched = candidates.filter((m) => matchesFilter(filter, m))
      const matchedRefs: ModelRef[] = matched.map((m) => ({ providerID: m.providerID, modelID: m.modelID }))
      const resolvedAtUTC = isoUtcNow()

      if (definition.trustLevel === "standard") {
        return {
          collectionID,
          version: definition.currentVersion,
          trustLevel: definition.trustLevel,
          members: matchedRefs,
          filterMatchedButPendingOptIn: [],
          resolvedAtUTC,
        }
      }

      const active = store.activeOptIns(collectionID)
      const members: ModelRef[] = []
      const pending: ModelRef[] = []
      for (const ref of matchedRefs) {
        const hasActiveGrant = active.some((g) => g.providerID === ref.providerID && g.modelID === ref.modelID)
        if (hasActiveGrant) members.push(ref)
        else pending.push(ref)
      }

      return {
        collectionID,
        version: definition.currentVersion,
        trustLevel: definition.trustLevel,
        members,
        filterMatchedButPendingOptIn: pending,
        resolvedAtUTC,
      }
    },
  }

  return store
}
