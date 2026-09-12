/* SPDX-License-Identifier: MIT */
/* Copyright (c) 2026 Unifia contributors */

import { describe, expect, test } from "bun:test"
import { DEFAULT_EXPRESSION_LIMITS, ExpressionError, evaluate, extractDependencies, parseExpression } from "../src/index"

describe("expression-runtime (ADR-003 bounded CEL)", () => {
  test("evaluates the corpus condition deterministically", () => {
    expect(evaluate("id == \u0027wf-1\u0027 && version == 1", { id: "wf-1", version: 1 })).toBe(true)
    expect(evaluate("x + y", { x: 2, y: 3 })).toBe(5)
    expect(evaluate("input.count > 3 && input.approved", { input: { count: 4, approved: true } })).toBe(true)
    expect(evaluate("!flag || fallback", { flag: true, fallback: false })).toBe(false)
    expect(evaluate("count >= 1 ? \u0027big\u0027 : \u0027small\u0027", { count: 0 })).toBe("small")
    expect(evaluate("items[0].name", { items: [{ name: "first" }] })).toBe("first")
  })

  test("structural equality and list indexing", () => {
    expect(evaluate("a == b", { a: [1, 2, 3], b: [1, 2, 3] })).toBe(true)
    expect(evaluate("list[1] == 2", { list: [1, 2, 3] })).toBe(true)
  })

  test("short-circuit avoids evaluating unknown branch identifiers", () => {
    expect(evaluate("false && undefinedThing", {})).toBe(false)
  })

  test("fail-closed: unknown identifier is a typed error, not undefined", () => {
    try { evaluate("nope + 1", {}); expect.unreachable() } catch (e) { expect((e as ExpressionError).code).toBe("EXPR_UNKNOWN_IDENTIFIER") }
  })

  test("fail-closed: no function calls, no member calls (isolation by construction)", () => {
    try { evaluate("eval(1)", {}); expect.unreachable() } catch (e) { expect((e as ExpressionError).code).toBe("EXPR_PARSE_ERROR") }
    try { evaluate("a.b()", {}); expect.unreachable() } catch (e) { expect((e as ExpressionError).code).toBe("EXPR_PARSE_ERROR") }
  })

  test("five bounded-eval limits fire with typed codes", () => {
    const limits = { ...DEFAULT_EXPRESSION_LIMITS, maxExpressionChars: 8 }
    try { parseExpression("a + b + ccc", limits); expect.unreachable() } catch (e) { expect((e as ExpressionError).code).toBe("EXPR_TOO_LONG") }
    try { parseExpression("1+1+1+1+1+1+1+1+1+1+1+1+1+1+1+1", { ...DEFAULT_EXPRESSION_LIMITS, maxAstNodes: 5 }); expect.unreachable() } catch (e) { expect((e as ExpressionError).code).toBe("EXPR_TOO_MANY_NODES") }
    const deep = "!".repeat(40) + "1"
    try { evaluate(deep, {}); expect.unreachable() } catch (e) { expect((e as ExpressionError).code).toBe("EXPR_DEPTH_EXCEEDED") }
    try { evaluate("\u0027" + "x".repeat(50) + "\u0027", {}, { ...DEFAULT_EXPRESSION_LIMITS, maxExpressionChars: 6000, maxStringLength: 10 }); expect.unreachable() } catch (e) { expect((e as ExpressionError).code).toBe("EXPR_STRING_TOO_LONG") }
    try { evaluate("[" + Array(200).fill(0).join(",") + "]", {}, { ...DEFAULT_EXPRESSION_LIMITS, maxExpressionChars: 10000, maxListLength: 100 }); expect.unreachable() } catch (e) { expect((e as ExpressionError).code).toBe("EXPR_LIST_TOO_LONG") }
  })

  test("determinism: same expression + env -> same result", () => {
    const a = evaluate("a * 3 - 1", { a: 7 })
    const b = evaluate("a * 3 - 1", { a: 7 })
    expect(a).toBe(20); expect(b).toBe(20)
  })

  test("dependency extraction walks the AST (root identifiers, sorted)", () => {
    expect(extractDependencies("input.count > 3 && user.role == \u0027admin\u0027")).toEqual(["input", "user"])
  })
})
