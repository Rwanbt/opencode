import { describe, expect, test } from "bun:test"
import { TeamSelection, orderTeamModels } from "../../src/team/selection"

describe("TeamSelection", () => {
  test("accepts two distinct models", () => {
    expect(TeamSelection.parse({ models: [{ providerID: "one", modelID: "a" }, { providerID: "two", modelID: "b" }] })).toEqual({
      models: [{ providerID: "one", modelID: "a" }, { providerID: "two", modelID: "b" }],
    })
  })

  test("rejects duplicate models", () => {
    expect(() => TeamSelection.parse({ models: [{ providerID: "one", modelID: "a" }, { providerID: "one", modelID: "a" }] })).toThrow()
  })

  test("requires at least two models", () => {
    expect(() => TeamSelection.parse({ models: [{ providerID: "one", modelID: "a" }] })).toThrow()
  })
})

describe("orderTeamModels", () => {
  const selection = TeamSelection.parse({
    models: [
      { providerID: "google", modelID: "flash" },
      { providerID: "minimax", modelID: "m3" },
      { providerID: "mistral", modelID: "medium" },
    ],
  })

  test("moves the assigned worker model to the front of its fallback pool", () => {
    expect(orderTeamModels(selection, { providerID: "minimax", modelID: "m3" })).toEqual([
      { providerID: "minimax", modelID: "m3" },
      { providerID: "google", modelID: "flash" },
      { providerID: "mistral", modelID: "medium" },
    ])
  })

  test("preserves user order when the session primary is outside the worker pool", () => {
    expect(orderTeamModels(selection, { providerID: "openai", modelID: "primary" })).toEqual(selection.models)
  })

  test("does not mutate the persisted selection", () => {
    orderTeamModels(selection, { providerID: "mistral", modelID: "medium" })
    expect(selection.models[0]).toEqual({ providerID: "google", modelID: "flash" })
  })
})
