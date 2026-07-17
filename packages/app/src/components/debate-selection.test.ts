import { describe, expect, test } from "bun:test"
import { modelKey, validateDebateSelection, withCurrentPrimary, type DebateSelection } from "./debate-selection"

const primary = { providerID: "one", modelID: "primary" }
const annexes = [
  { providerID: "two", modelID: "first" },
  { providerID: "three", modelID: "second" },
]
const available = new Set([primary, ...annexes].map(modelKey))
const selection: DebateSelection = { primary, participants: annexes }

describe("validateDebateSelection", () => {
  test("accepts two distinct available annexes", () => {
    expect(validateDebateSelection(selection, available)).toBeUndefined()
  })

  test("accepts one annex because the primary counts as the second distinct model", () => {
    expect(validateDebateSelection({ primary, participants: annexes.slice(0, 1) }, available)).toBeUndefined()
  })

  test("rejects duplicates and the primary model", () => {
    expect(validateDebateSelection({ primary, participants: [annexes[0], annexes[0]] }, available)).toBe("duplicate-participant")
    expect(validateDebateSelection({ primary, participants: [primary, annexes[0]] }, available)).toBe("primary-selected")
  })

  test("rejects models that disappeared from the connected catalog", () => {
    expect(validateDebateSelection({ primary, participants: [annexes[0], { providerID: "gone", modelID: "model" }] }, available)).toBe("unavailable-model")
  })
})

test("withCurrentPrimary preserves annexes while refreshing the primary", () => {
  const next = withCurrentPrimary(selection, { providerID: "four", modelID: "latest" })
  expect(next).toEqual({ primary: { providerID: "four", modelID: "latest" }, participants: annexes })
  expect(next.participants).not.toBe(selection.participants)
})
