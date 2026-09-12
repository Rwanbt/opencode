import { describe, test, expect } from "bun:test"
import { Token } from "../../src/util/token"

describe("Token", () => {
  test("estimate returns 0 for empty", () => {
    expect(Token.estimate("")).toBe(0)
    expect(Token.estimate(null as any)).toBe(0)
  })
  test("count for GPT-4 encodes hello world as 2 tokens", () => {
    expect(Token.count("hello world", "gpt-4")).toBe(2)
  })
})
