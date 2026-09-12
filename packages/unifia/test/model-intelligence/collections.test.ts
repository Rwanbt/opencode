/**
 * Tests for dynamic, versioned model collections (TEAM-C08) — filter
 * matching, definition versioning, and the mandatory-explicit-opt-in
 * guarantee for "elevated" trust collections (never silent auto-trust).
 */

import { describe, expect, test } from "bun:test"
import {
  createInMemoryCollectionStore,
  matchesFilter,
  emptyFilterCriteria,
  CollectionNotFoundError,
  DuplicateCollectionIdError,
  InvalidCollectionDefinitionError,
  InvalidOptInGrantError,
  OptInGrantNotFoundError,
  type FilterableModel,
  type CollectionFilterCriteria,
} from "../../src/model-intelligence/collections"
import type { ModelCapabilities } from "../../src/model-intelligence/schema"

function capabilities(overrides: Partial<ModelCapabilities> = {}): ModelCapabilities {
  return {
    structuredOutput: true,
    toolCalls: true,
    parallelToolCalls: true,
    visionInput: false,
    audioInput: false,
    videoInput: false,
    pdfInput: false,
    reasoning: false,
    caching: true,
    promptCaching: true,
    systemMessages: true,
    ...overrides,
  }
}

function model(overrides: Partial<FilterableModel> = {}): FilterableModel {
  return {
    providerID: "anthropic",
    modelID: "claude-sonnet-5",
    lifecycleStage: "general_eligible",
    capabilities: capabilities(),
    availabilityScore: 0.98,
    hasBenchmarkResult: true,
    ...overrides,
  }
}

// =====================================================================
// matchesFilter — pure function
// =====================================================================

describe("matchesFilter", () => {
  test("empty filter matches everything", () => {
    expect(matchesFilter(emptyFilterCriteria(), model())).toBe(true)
  })

  test("providerIDs filters out non-matching providers", () => {
    const filter: CollectionFilterCriteria = { ...emptyFilterCriteria(), providerIDs: ["openai"] }
    expect(matchesFilter(filter, model({ providerID: "anthropic" }))).toBe(false)
    expect(matchesFilter(filter, model({ providerID: "openai", modelID: "gpt-9" }))).toBe(true)
  })

  test("lifecycleStages restricts to listed stages", () => {
    const filter: CollectionFilterCriteria = { ...emptyFilterCriteria(), lifecycleStages: ["trusted_by_domain"] }
    expect(matchesFilter(filter, model({ lifecycleStage: "general_eligible" }))).toBe(false)
    expect(matchesFilter(filter, model({ lifecycleStage: "trusted_by_domain" }))).toBe(true)
  })

  test("minAvailabilityScore excludes models below the threshold or with unknown availability", () => {
    const filter: CollectionFilterCriteria = { ...emptyFilterCriteria(), minAvailabilityScore: 0.95 }
    expect(matchesFilter(filter, model({ availabilityScore: 0.9 }))).toBe(false)
    expect(matchesFilter(filter, model({ availabilityScore: null }))).toBe(false)
    expect(matchesFilter(filter, model({ availabilityScore: 0.95 }))).toBe(true)
  })

  test("requiresBenchmarkResult excludes unbenchmarked models", () => {
    const filter: CollectionFilterCriteria = { ...emptyFilterCriteria(), requiresBenchmarkResult: true }
    expect(matchesFilter(filter, model({ hasBenchmarkResult: false }))).toBe(false)
    expect(matchesFilter(filter, model({ hasBenchmarkResult: true }))).toBe(true)
  })

  test("requiredCapabilities requires every listed capability to be true", () => {
    const filter: CollectionFilterCriteria = {
      ...emptyFilterCriteria(),
      requiredCapabilities: { visionInput: true, toolCalls: true },
    }
    expect(matchesFilter(filter, model({ capabilities: capabilities({ visionInput: false, toolCalls: true }) }))).toBe(
      false,
    )
    expect(matchesFilter(filter, model({ capabilities: capabilities({ visionInput: true, toolCalls: true }) }))).toBe(
      true,
    )
  })

  test("explicitModelRefs pins a model in regardless of other criteria", () => {
    const filter: CollectionFilterCriteria = {
      ...emptyFilterCriteria(),
      providerIDs: ["openai"], // would otherwise exclude anthropic
      explicitModelRefs: [{ providerID: "anthropic", modelID: "claude-sonnet-5" }],
    }
    expect(matchesFilter(filter, model({ providerID: "anthropic", modelID: "claude-sonnet-5" }))).toBe(true)
  })

  test("all criteria are ANDed together (non-pinned path)", () => {
    const filter: CollectionFilterCriteria = {
      ...emptyFilterCriteria(),
      providerIDs: ["anthropic"],
      minAvailabilityScore: 0.9,
      requiresBenchmarkResult: true,
    }
    expect(matchesFilter(filter, model({ providerID: "anthropic", availabilityScore: 0.95, hasBenchmarkResult: true }))).toBe(
      true,
    )
    expect(matchesFilter(filter, model({ providerID: "anthropic", availabilityScore: 0.95, hasBenchmarkResult: false }))).toBe(
      false,
    )
  })
})

// =====================================================================
// CollectionStore.create — validation
// =====================================================================

describe("CollectionStore.create", () => {
  test("rejects empty id", () => {
    const store = createInMemoryCollectionStore()
    expect(() =>
      store.create({ id: "", name: "x", trustLevel: "standard", filter: emptyFilterCriteria() }),
    ).toThrow(InvalidCollectionDefinitionError)
  })

  test("rejects empty name", () => {
    const store = createInMemoryCollectionStore()
    expect(() =>
      store.create({ id: "col-1", name: "", trustLevel: "standard", filter: emptyFilterCriteria() }),
    ).toThrow(InvalidCollectionDefinitionError)
  })

  test("rejects duplicate id", () => {
    const store = createInMemoryCollectionStore()
    store.create({ id: "col-1", name: "My models", trustLevel: "standard", filter: emptyFilterCriteria() })
    expect(() =>
      store.create({ id: "col-1", name: "Other", trustLevel: "standard", filter: emptyFilterCriteria() }),
    ).toThrow(DuplicateCollectionIdError)
  })

  test("rejects out-of-range minAvailabilityScore", () => {
    const store = createInMemoryCollectionStore()
    expect(() =>
      store.create({
        id: "col-1",
        name: "x",
        trustLevel: "standard",
        filter: { ...emptyFilterCriteria(), minAvailabilityScore: 1.5 },
      }),
    ).toThrow(InvalidCollectionDefinitionError)
  })

  test("creates a collection at version 1", () => {
    const store = createInMemoryCollectionStore()
    const def = store.create({ id: "col-1", name: "My models", trustLevel: "standard", filter: emptyFilterCriteria() })
    expect(def.currentVersion).toBe(1)
    expect(store.get("col-1")).toEqual(def)
  })
})

// =====================================================================
// Versioning — updateFilter appends, never mutates
// =====================================================================

describe("CollectionStore versioning", () => {
  test("updateFilter bumps the version and retains history", () => {
    const store = createInMemoryCollectionStore()
    store.create({ id: "col-1", name: "My models", trustLevel: "standard", filter: emptyFilterCriteria() })

    const narrower: CollectionFilterCriteria = { ...emptyFilterCriteria(), providerIDs: ["anthropic"] }
    const updated = store.updateFilter("col-1", narrower, "narrow to anthropic only")

    expect(updated.currentVersion).toBe(2)
    const history = store.history("col-1")
    expect(history.length).toBe(2)
    expect(history[0].version).toBe(1)
    expect(history[1].version).toBe(2)
    expect(history[1].changeReason).toBe("narrow to anthropic only")
    expect(store.currentFilter("col-1")).toEqual(narrower)
    // prior version's filter is untouched
    expect(history[0].filter).toEqual(emptyFilterCriteria())
  })

  test("updateFilter rejects empty changeReason", () => {
    const store = createInMemoryCollectionStore()
    store.create({ id: "col-1", name: "My models", trustLevel: "standard", filter: emptyFilterCriteria() })
    expect(() => store.updateFilter("col-1", emptyFilterCriteria(), "")).toThrow(InvalidCollectionDefinitionError)
  })

  test("updateFilter on unknown collection throws CollectionNotFoundError", () => {
    const store = createInMemoryCollectionStore()
    expect(() => store.updateFilter("nope", emptyFilterCriteria(), "reason")).toThrow(CollectionNotFoundError)
  })

  test("history/currentFilter/get on unknown collection throw CollectionNotFoundError", () => {
    const store = createInMemoryCollectionStore()
    expect(() => store.history("nope")).toThrow(CollectionNotFoundError)
    expect(() => store.currentFilter("nope")).toThrow(CollectionNotFoundError)
    expect(store.get("nope")).toBeNull()
  })
})

// =====================================================================
// Opt-in grants — restricted to elevated collections
// =====================================================================

describe("CollectionStore opt-in grants", () => {
  test("rejects opt-in on a standard (non-elevated) collection", () => {
    const store = createInMemoryCollectionStore()
    store.create({ id: "col-1", name: "My models", trustLevel: "standard", filter: emptyFilterCriteria() })
    expect(() =>
      store.grantOptIn("col-1", { providerID: "anthropic", modelID: "claude-sonnet-5" }, "erwan", "trust it"),
    ).toThrow(InvalidOptInGrantError)
  })

  test("rejects empty grantedBy or reason", () => {
    const store = createInMemoryCollectionStore()
    store.create({ id: "col-1", name: "Trusted", trustLevel: "elevated", filter: emptyFilterCriteria() })
    const ref = { providerID: "anthropic", modelID: "claude-sonnet-5" }
    expect(() => store.grantOptIn("col-1", ref, "", "trust it")).toThrow(InvalidOptInGrantError)
    expect(() => store.grantOptIn("col-1", ref, "erwan", "")).toThrow(InvalidOptInGrantError)
  })

  test("grants and lists an opt-in on an elevated collection", () => {
    const store = createInMemoryCollectionStore()
    store.create({ id: "col-1", name: "Trusted", trustLevel: "elevated", filter: emptyFilterCriteria() })
    const ref = { providerID: "anthropic", modelID: "claude-sonnet-5" }
    const grant = store.grantOptIn("col-1", ref, "erwan", "manually reviewed and trusted")
    expect(grant.revokedAtUTC).toBeNull()
    expect(store.optIns("col-1").length).toBe(1)
    expect(store.activeOptIns("col-1").length).toBe(1)
  })

  test("revoking a non-existent grant throws OptInGrantNotFoundError", () => {
    const store = createInMemoryCollectionStore()
    store.create({ id: "col-1", name: "Trusted", trustLevel: "elevated", filter: emptyFilterCriteria() })
    const ref = { providerID: "anthropic", modelID: "claude-sonnet-5" }
    expect(() => store.revokeOptIn("col-1", ref, "erwan", "changed my mind")).toThrow(OptInGrantNotFoundError)
  })

  test("revokes an active grant; it disappears from activeOptIns but stays in optIns", () => {
    const store = createInMemoryCollectionStore()
    store.create({ id: "col-1", name: "Trusted", trustLevel: "elevated", filter: emptyFilterCriteria() })
    const ref = { providerID: "anthropic", modelID: "claude-sonnet-5" }
    store.grantOptIn("col-1", ref, "erwan", "trusted")
    const revoked = store.revokeOptIn("col-1", ref, "erwan", "no longer trusted")
    expect(revoked.revokedAtUTC).not.toBeNull()
    expect(store.activeOptIns("col-1").length).toBe(0)
    expect(store.optIns("col-1").length).toBe(1)
  })

  test("double-revoking the same grant throws (it is no longer active)", () => {
    const store = createInMemoryCollectionStore()
    store.create({ id: "col-1", name: "Trusted", trustLevel: "elevated", filter: emptyFilterCriteria() })
    const ref = { providerID: "anthropic", modelID: "claude-sonnet-5" }
    store.grantOptIn("col-1", ref, "erwan", "trusted")
    store.revokeOptIn("col-1", ref, "erwan", "reconsidered")
    expect(() => store.revokeOptIn("col-1", ref, "erwan", "again")).toThrow(OptInGrantNotFoundError)
  })

  test("optInEvents records granted and revoked as an append-only audit log", () => {
    const store = createInMemoryCollectionStore()
    store.create({ id: "col-1", name: "Trusted", trustLevel: "elevated", filter: emptyFilterCriteria() })
    const ref = { providerID: "anthropic", modelID: "claude-sonnet-5" }
    store.grantOptIn("col-1", ref, "erwan", "trusted")
    store.revokeOptIn("col-1", ref, "erwan", "reconsidered")
    const events = store.optInEvents("col-1")
    expect(events.map((e) => e.type)).toEqual(["granted", "revoked"])
  })

  test("onOptInEvent notifies subscribers synchronously", () => {
    const store = createInMemoryCollectionStore()
    store.create({ id: "col-1", name: "Trusted", trustLevel: "elevated", filter: emptyFilterCriteria() })
    const seen: string[] = []
    const unsubscribe = store.onOptInEvent((e) => seen.push(e.type))
    const ref = { providerID: "anthropic", modelID: "claude-sonnet-5" }
    store.grantOptIn("col-1", ref, "erwan", "trusted")
    expect(seen).toEqual(["granted"])
    unsubscribe()
    store.revokeOptIn("col-1", ref, "erwan", "later")
    expect(seen).toEqual(["granted"]) // unsubscribed — no further notifications
  })
})

// =====================================================================
// resolveMembers — the "never silent auto-trust" guarantee
// =====================================================================

describe("resolveMembers — standard collections", () => {
  test("standard collection membership is exactly the filter matches", () => {
    const store = createInMemoryCollectionStore()
    store.create({
      id: "col-1",
      name: "Anthropic models",
      trustLevel: "standard",
      filter: { ...emptyFilterCriteria(), providerIDs: ["anthropic"] },
    })
    const candidates = [
      model({ providerID: "anthropic", modelID: "claude-sonnet-5" }),
      model({ providerID: "openai", modelID: "gpt-9" }),
    ]
    const resolution = store.resolveMembers("col-1", candidates)
    expect(resolution.members).toEqual([{ providerID: "anthropic", modelID: "claude-sonnet-5" }])
    expect(resolution.filterMatchedButPendingOptIn).toEqual([])
  })

  test("resolveMembers on unknown collection throws CollectionNotFoundError", () => {
    const store = createInMemoryCollectionStore()
    expect(() => store.resolveMembers("nope", [])).toThrow(CollectionNotFoundError)
  })
})

describe("resolveMembers — elevated collections require explicit opt-in (never silent auto-trust)", () => {
  test("a broad/catch-all filter with ZERO opt-ins yields ZERO members, even though many models match", () => {
    const store = createInMemoryCollectionStore()
    store.create({
      id: "trusted-coding",
      name: "My trusted coding models",
      trustLevel: "elevated",
      filter: emptyFilterCriteria(), // catch-all: matches every candidate
    })
    const candidates = [
      model({ providerID: "anthropic", modelID: "claude-sonnet-5" }),
      model({ providerID: "openai", modelID: "gpt-9" }),
      model({ providerID: "google", modelID: "gemini-3" }),
    ]
    const resolution = store.resolveMembers("trusted-coding", candidates)
    expect(resolution.members).toEqual([])
    expect(resolution.filterMatchedButPendingOptIn.length).toBe(3)
  })

  test("only models with an active opt-in grant become members; the rest stay pending", () => {
    const store = createInMemoryCollectionStore()
    store.create({
      id: "trusted-coding",
      name: "My trusted coding models",
      trustLevel: "elevated",
      filter: emptyFilterCriteria(),
    })
    const candidates = [
      model({ providerID: "anthropic", modelID: "claude-sonnet-5" }),
      model({ providerID: "openai", modelID: "gpt-9" }),
    ]
    store.grantOptIn("trusted-coding", { providerID: "anthropic", modelID: "claude-sonnet-5" }, "erwan", "reviewed")

    const resolution = store.resolveMembers("trusted-coding", candidates)
    expect(resolution.members).toEqual([{ providerID: "anthropic", modelID: "claude-sonnet-5" }])
    expect(resolution.filterMatchedButPendingOptIn).toEqual([{ providerID: "openai", modelID: "gpt-9" }])
  })

  test("revoking an opt-in removes the model from members on the next resolution", () => {
    const store = createInMemoryCollectionStore()
    store.create({
      id: "trusted-coding",
      name: "My trusted coding models",
      trustLevel: "elevated",
      filter: emptyFilterCriteria(),
    })
    const ref = { providerID: "anthropic", modelID: "claude-sonnet-5" }
    const candidates = [model(ref)]
    store.grantOptIn("trusted-coding", ref, "erwan", "reviewed")
    expect(store.resolveMembers("trusted-coding", candidates).members).toEqual([ref])

    store.revokeOptIn("trusted-coding", ref, "erwan", "no longer trusted")
    const resolution = store.resolveMembers("trusted-coding", candidates)
    expect(resolution.members).toEqual([])
    expect(resolution.filterMatchedButPendingOptIn).toEqual([ref])
  })

  test("opt-in on a model that does not even match the filter has no effect (candidates list is authoritative)", () => {
    const store = createInMemoryCollectionStore()
    store.create({
      id: "anthropic-only",
      name: "Anthropic trusted",
      trustLevel: "elevated",
      filter: { ...emptyFilterCriteria(), providerIDs: ["anthropic"] },
    })
    // Opt in a model that is never passed as a candidate.
    store.grantOptIn("anthropic-only", { providerID: "openai", modelID: "gpt-9" }, "erwan", "reviewed")
    const candidates = [model({ providerID: "anthropic", modelID: "claude-sonnet-5" })]
    const resolution = store.resolveMembers("anthropic-only", candidates)
    expect(resolution.members).toEqual([])
    expect(resolution.filterMatchedButPendingOptIn).toEqual([{ providerID: "anthropic", modelID: "claude-sonnet-5" }])
  })

  test("resolution reflects the CURRENT filter version, not the version active when opt-in was granted", () => {
    const store = createInMemoryCollectionStore()
    store.create({
      id: "trusted-coding",
      name: "My trusted coding models",
      trustLevel: "elevated",
      filter: emptyFilterCriteria(),
    })
    const ref = { providerID: "anthropic", modelID: "claude-sonnet-5" }
    store.grantOptIn("trusted-coding", ref, "erwan", "reviewed")

    // Narrow the filter to exclude this provider entirely.
    store.updateFilter("trusted-coding", { ...emptyFilterCriteria(), providerIDs: ["openai"] }, "narrow scope")

    const resolution = store.resolveMembers("trusted-coding", [model(ref)])
    // The opt-in still exists, but the model no longer matches the current
    // filter, so it is not even a candidate — never a member, and not
    // reported as pending either (it was never a match to begin with).
    expect(resolution.members).toEqual([])
    expect(resolution.filterMatchedButPendingOptIn).toEqual([])
    expect(resolution.version).toBe(2)
  })
})
