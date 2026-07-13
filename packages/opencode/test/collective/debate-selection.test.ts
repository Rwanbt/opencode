import { describe, expect, test } from "bun:test"
import { Collective } from "../../src/collective/types"

describe("Collective.DebateSelection", () => {
  const primary = { providerID: "openai", modelID: "gpt-5" }
  const participants = [
    { providerID: "anthropic", modelID: "claude-sonnet" },
    { providerID: "google", modelID: "gemini-pro" },
  ]

  test("accepts one primary and two parallel participants", () => {
    const result = Collective.DebateSelection.safeParse({ primary, participants })
    expect(result.success).toBe(true)
  })

  test("rejects a single participant", () => {
    const result = Collective.DebateSelection.safeParse({
      primary,
      participants: [participants[0]],
    })
    expect(result.success).toBe(false)
  })

  test("rejects zero participants", () => {
    const result = Collective.DebateSelection.safeParse({ primary, participants: [] })
    expect(result.success).toBe(false)
  })

  test("accepts more than two parallel participants", () => {
    const result = Collective.DebateSelection.safeParse({
      primary,
      participants: [...participants, { providerID: "xai", modelID: "grok" }],
    })
    expect(result.success).toBe(true)
  })
})