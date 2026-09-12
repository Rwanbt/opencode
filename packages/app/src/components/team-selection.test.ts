import { describe, expect, test } from "bun:test"
import {
  MAX_TEAM_MODELS,
  MIN_TEAM_MODELS,
  normalizeTeamSelection,
  planTeamToggle,
  teamModelKey,
  validateTeamSelection,
  type TeamSelection,
} from "@/context/team-selection"

const models = [
  { providerID: "one", modelID: "first" },
  { providerID: "two", modelID: "second" },
]
const available = new Set(models.map(teamModelKey))
const selection: TeamSelection = { models }

// The SPA fallback answers an unknown `/team/config` with HTTP 200 and this body,
// which the SDK surfaces as a plain string in `data`.
const SPA_FALLBACK_BODY = '<!doctype html>\n<html lang="en"><body><div id="root"></div></body></html>'

describe("normalizeTeamSelection", () => {
  test("returns undefined for an absent selection", () => {
    expect(normalizeTeamSelection(undefined)).toBeUndefined()
    expect(normalizeTeamSelection(null)).toBeUndefined()
  })

  test("returns undefined for the SPA fallback HTML served by a stale sidecar", () => {
    expect(normalizeTeamSelection(SPA_FALLBACK_BODY)).toBeUndefined()
  })

  test("returns undefined when models is missing or not an array", () => {
    expect(normalizeTeamSelection({})).toBeUndefined()
    expect(normalizeTeamSelection({ models: undefined })).toBeUndefined()
    expect(normalizeTeamSelection({ models: "two" })).toBeUndefined()
  })

  test("returns undefined when a model lacks providerID or modelID", () => {
    expect(normalizeTeamSelection({ models: [{ providerID: "one" }] })).toBeUndefined()
    expect(normalizeTeamSelection({ models: [{ modelID: "first" }] })).toBeUndefined()
    expect(normalizeTeamSelection({ models: [{ providerID: "", modelID: "first" }] })).toBeUndefined()
    expect(normalizeTeamSelection({ models: [null] })).toBeUndefined()
  })

  test("accepts a valid selection and strips unknown fields", () => {
    expect(normalizeTeamSelection({ models: [{ providerID: "one", modelID: "first", extra: 1 }] })).toEqual({
      models: [{ providerID: "one", modelID: "first" }],
    })
  })

  test("accepts an empty model list so the caller can decide it is not configured yet", () => {
    expect(normalizeTeamSelection({ models: [] })).toEqual({ models: [] })
  })
})

describe("validateTeamSelection", () => {
  test("accepts two distinct available models", () => {
    expect(validateTeamSelection(selection, available)).toBe(true)
  })

  test("rejects fewer than two models", () => {
    expect(validateTeamSelection(undefined, available)).toBe(false)
    expect(validateTeamSelection({ models: [] }, available)).toBe(false)
    expect(validateTeamSelection({ models: models.slice(0, 1) }, available)).toBe(false)
  })

  test("rejects duplicates", () => {
    expect(validateTeamSelection({ models: [models[0], models[0]] }, available)).toBe(false)
  })

  test("rejects models that disappeared from the connected catalog when fewer than two remain valid", () => {
    expect(validateTeamSelection({ models: [models[0], { providerID: "gone", modelID: "model" }] }, available)).toBe(
      false,
    )
  })

  test("accepts a selection where some models disappeared, as long as two distinct ones remain available", () => {
    // Regression: a 7-model selection with one disconnected provider used to
    // invalidate the whole thing ("Team models not configured") even with 6
    // perfectly usable models left.
    const larger: TeamSelection = {
      models: [
        ...models,
        { providerID: "gone-one", modelID: "model" },
        { providerID: "gone-two", modelID: "model" },
      ],
    }
    expect(validateTeamSelection(larger, available)).toBe(true)
  })

  test("does not throw when handed a malformed selection", () => {
    expect(validateTeamSelection({} as TeamSelection, available)).toBe(false)
    expect(validateTeamSelection(SPA_FALLBACK_BODY as unknown as TeamSelection, available)).toBe(false)
  })
})

describe("planTeamToggle", () => {
  // Regression: the selector used to persist every toggle. The server rejects anything
  // below MIN_TEAM_MODELS with HTTP 400 and the component only advanced `selected()` after
  // a successful save, so the first pick of an empty selection failed forever — reaching
  // two models required passing through one. Staging the sub-minimal step is what breaks
  // that loop, so these two assertions are the actual guard.
  test("stages the first pick instead of persisting it", () => {
    expect(planTeamToggle([], models[0])).toEqual({ action: "stage", models: [models[0]] })
  })

  test("persists on the toggle that reaches the minimum", () => {
    expect(planTeamToggle([models[0]], models[1])).toEqual({ action: "persist", models })
  })

  test("never plans to persist a selection the server would reject", () => {
    const plan = planTeamToggle([], models[0])
    expect(plan.action === "persist" && plan.models.length >= MIN_TEAM_MODELS).toBe(false)
  })

  test("removes above the minimum and persists the result", () => {
    const third = { providerID: "three", modelID: "third" }
    expect(planTeamToggle([...models, third], third)).toEqual({ action: "persist", models })
  })

  test("rejects a removal that would drop below the minimum", () => {
    expect(planTeamToggle(models, models[0])).toEqual({ action: "reject", reason: "minimum" })
  })

  test("rejects an addition beyond the maximum", () => {
    const full = Array.from({ length: MAX_TEAM_MODELS }, (_, index) => ({
      providerID: "provider",
      modelID: `model-${index}`,
    }))
    expect(planTeamToggle(full, { providerID: "provider", modelID: "extra" })).toEqual({
      action: "reject",
      reason: "maximum",
    })
  })

  test("does not mutate the current selection", () => {
    const current = [models[0]]
    planTeamToggle(current, models[1])
    expect(current).toEqual([models[0]])
  })

  test("strips extra fields from the toggled model", () => {
    const plan = planTeamToggle([], { ...models[0], name: "First" } as never)
    expect(plan).toEqual({ action: "stage", models: [models[0]] })
  })
})
