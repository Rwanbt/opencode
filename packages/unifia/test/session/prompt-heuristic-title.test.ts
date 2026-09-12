import { describe, expect, test } from "bun:test"
import { deriveHeuristicTitle } from "../../src/session/prompt"

describe("deriveHeuristicTitle", () => {
  test("returns the message as-is when short", () => {
    expect(deriveHeuristicTitle("hey")).toBe("hey")
  })

  test("trims surrounding whitespace", () => {
    expect(deriveHeuristicTitle("  hey there  \n")).toBe("hey there")
  })

  test("takes the first non-empty line of a multi-line message", () => {
    expect(deriveHeuristicTitle("\n\nFix the login bug\n\nSteps to reproduce:\n1. ...")).toBe("Fix the login bug")
  })

  test("truncates long messages to 100 chars with an ellipsis", () => {
    const long = "a".repeat(150)
    const result = deriveHeuristicTitle(long)
    expect(result?.length).toBe(100)
    expect(result?.endsWith("...")).toBe(true)
    expect(result?.startsWith("a".repeat(97))).toBe(true)
  })

  test("does not truncate a message exactly at the 100 char boundary", () => {
    const exact = "b".repeat(100)
    expect(deriveHeuristicTitle(exact)).toBe(exact)
  })

  test("returns undefined for an empty string", () => {
    expect(deriveHeuristicTitle("")).toBeUndefined()
  })

  test("returns undefined for whitespace-only content", () => {
    expect(deriveHeuristicTitle("   \n\t\n   ")).toBeUndefined()
  })

  test("strips control characters", () => {
    expect(deriveHeuristicTitle("hey\x00\x07there")).toBe("heythere")
  })

  test("preserves a code block's first line as the title", () => {
    expect(deriveHeuristicTitle("```python\nprint('hi')\n```")).toBe("```python")
  })

  test("preserves emoji and non-ASCII content", () => {
    expect(deriveHeuristicTitle("réparer le bug 🐛 dans l'éditeur")).toBe("réparer le bug 🐛 dans l'éditeur")
  })
})
