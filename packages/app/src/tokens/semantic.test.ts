import { describe, expect, test } from "bun:test"
import { SEMANTIC_TOKENS, SEMANTIC_CSS_VARS, semanticTokensCssBlock, type SemanticToken } from "./semantic"

describe("semantic tokens", () => {
  test("every token has a stable CSS variable name", () => {
    const keys = Object.keys(SEMANTIC_TOKENS) as SemanticToken[]
    for (const key of keys) {
      expect(SEMANTIC_CSS_VARS[key]).toStartWith("--")
    }
  })

  test("CSS variables are unique (no collision between tokens)", () => {
    const vars = Object.values(SEMANTIC_CSS_VARS)
    expect(new Set(vars).size).toBe(vars.length)
  })

  test("every CSS variable resolves to a non-empty string value", () => {
    const keys = Object.keys(SEMANTIC_TOKENS) as SemanticToken[]
    for (const key of keys) {
      expect(SEMANTIC_TOKENS[key].length).toBeGreaterThan(0)
    }
  })

  test("semanticTokensCssBlock emits a parseable :root block", () => {
    const block = semanticTokensCssBlock()
    expect(block).toStartWith(":root {")
    expect(block.trimEnd().endsWith("}")).toBe(true)
    // Every token gets a CSS line (one per key, indented). Filter
    // out the :root { opener which also contains a colon.
    const lines = block
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.startsWith("--") && line.includes(":"))
    expect(lines.length).toBe(Object.keys(SEMANTIC_TOKENS).length)
  })

  test("severity colours cover the four standard states", () => {
    expect(SEMANTIC_TOKENS.textDanger).toBeDefined()
    expect(SEMANTIC_TOKENS.textWarning).toBeDefined()
    expect(SEMANTIC_TOKENS.textSuccess).toBeDefined()
    expect(SEMANTIC_TOKENS.textInfo).toBeDefined()
  })
})
