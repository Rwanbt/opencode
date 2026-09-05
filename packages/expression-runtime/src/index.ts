/* SPDX-License-Identifier: MIT */
/* Copyright (c) 2026 Unifia contributors */

/**
 * Canonical expression runtime — hand-rolled bounded CEL interpreter
 * (ADR-003 Decision; cel-js rejected, broken on Bun).
 *
 * By construction the language has NO function calls and NO access
 * primitives (network / fs / process do not exist in the grammar) —
 * sandbox isolation is structural, not enforced.
 *
 * Evaluation is bounded (ADR-003 / plan §62 five limits). All
 * violations fail closed with typed codes. Deterministic: no clock,
 * no randomness.
 */

export type CelValue = number | string | boolean | null | CelValue[] | { [key: string]: CelValue }

export class ExpressionError extends Error {
  constructor(readonly code: string, message: string) { super(message); this.name = "ExpressionError" }
}

export interface ExpressionLimits {
  readonly maxExpressionChars: number
  readonly maxAstNodes: number
  readonly maxEvalDepth: number
  readonly maxStringLength: number
  readonly maxListLength: number
}

export const DEFAULT_EXPRESSION_LIMITS: ExpressionLimits = {
  maxExpressionChars: 1024, maxAstNodes: 256, maxEvalDepth: 32, maxStringLength: 4096, maxListLength: 1024,
}

type Tok = { kind: "num" | "str" | "id" | "op" | "eof"; text: string; pos: number }
const OPS = ["&&", "||", "==", "!=", "<=", ">=", "?", ":", "<", ">", "+", "-", "*", "/", "%", "!", "(", ")", ".", ",", "[", "]"]

function tokenize(src: string): Tok[] {
  const out: Tok[] = []
  let i = 0
  while (i < src.length) {
    const c = src[i]!
    if (c === " " || c === "\t" || c === "\n" || c === "\r") { i++; continue }
    if (c >= "0" && c <= "9") {
      let j = i
      while (j < src.length && src[j]! >= "0" && src[j]! <= "9") j++
      out.push({ kind: "num", text: src.slice(i, j), pos: i }); i = j; continue
    }
    if ((c >= "a" && c <= "z") || (c >= "A" && c <= "Z") || c === "_") {
      let j = i
      while (j < src.length && /[A-Za-z0-9_]/.test(src[j]!)) j++
      out.push({ kind: "id", text: src.slice(i, j), pos: i }); i = j; continue
    }
    if (c === "\"" || c === "\u0027") {
      const close = c
      let j = i + 1; let s = ""
      while (j < src.length && src[j] !== close) {
        if (src[j] === "\\") {
          const esc = src[j + 1]
          s += esc === "n" ? "\n" : esc === "t" ? "\t" : esc === "\\" ? "\\" : esc === "\"" ? "\"" : esc === "\u0027" ? "\u0027" : esc ?? ""
          j += 2; continue
        }
        s += src[j]; j++
      }
      if (j >= src.length) throw new ExpressionError("EXPR_PARSE_ERROR", "unterminated string literal")
      out.push({ kind: "str", text: s, pos: i }); i = j + 1; continue
    }
    const two = src.slice(i, i + 2)
    if (OPS.includes(two)) { out.push({ kind: "op", text: two, pos: i }); i += 2; continue }
    if (OPS.includes(c)) { out.push({ kind: "op", text: c, pos: i }); i++; continue }
    throw new ExpressionError("EXPR_PARSE_ERROR", `unexpected character ${JSON.stringify(c)} at ${i}`)
  }
  out.push({ kind: "eof", text: "", pos: src.length })
  return out
}

export interface CelAst { readonly source: string; readonly nodeCount: number; readonly root: AstNode }
export type AstNode =
  | { kind: "lit"; value: CelValue }
  | { kind: "id"; name: string }
  | { kind: "member"; object: AstNode; property: string }
  | { kind: "unary"; op: "!" | "-"; operand: AstNode }
  | { kind: "binary"; op: string; left: AstNode; right: AstNode }
  | { kind: "ternary"; condition: AstNode; then: AstNode; else: AstNode }
  | { kind: "list"; items: AstNode[] }

class Parser {
  private pos = 0
  private nodes = 0
  constructor(private readonly toks: Tok[], private readonly limits: ExpressionLimits, private readonly src: string) {}
  private peek(): Tok { return this.toks[this.pos]! }
  private next(): Tok { return this.toks[this.pos++]! }
  private expect(text: string): void {
    const t = this.next()
    if (t.text !== text) throw new ExpressionError("EXPR_PARSE_ERROR", `expected ${text} but got ${JSON.stringify(t.text)} at ${t.pos}`)
  }
  private track(node: AstNode): AstNode {
    this.nodes++
    if (this.nodes > this.limits.maxAstNodes) throw new ExpressionError("EXPR_TOO_MANY_NODES", `AST exceeds ${this.limits.maxAstNodes} nodes`)
    return node
  }
  parse(): CelAst {
    const root = this.parseTernary()
    if (this.peek().kind !== "eof") throw new ExpressionError("EXPR_PARSE_ERROR", `trailing tokens at ${this.peek().pos}`)
    return { source: this.src, nodeCount: this.nodes, root }
  }
  private parseTernary(): AstNode {
    const condition = this.parseOr()
    if (this.peek().text === "?") {
      this.next()
      const then = this.parseTernary()
      this.expect(":")
      return this.track({ kind: "ternary", condition, then, else: this.parseTernary() })
    }
    return condition
  }
  private parseOr(): AstNode {
    let left = this.parseAnd()
    while (this.peek().text === "||") { this.next(); left = this.track({ kind: "binary", op: "||", left, right: this.parseAnd() }) }
    return left
  }
  private parseAnd(): AstNode {
    let left = this.parseEquality()
    while (this.peek().text === "&&") { this.next(); left = this.track({ kind: "binary", op: "&&", left, right: this.parseEquality() }) }
    return left
  }
  private parseEquality(): AstNode {
    let left = this.parseComparison()
    while (this.peek().text === "==" || this.peek().text === "!=") { const op = this.next().text; left = this.track({ kind: "binary", op, left, right: this.parseComparison() }) }
    return left
  }
  private parseComparison(): AstNode {
    let left = this.parseAdditive()
    while (["<", ">", "<=", ">="].includes(this.peek().text)) { const op = this.next().text; left = this.track({ kind: "binary", op, left, right: this.parseAdditive() }) }
    return left
  }
  private parseAdditive(): AstNode {
    let left = this.parseMultiplicative()
    while (this.peek().text === "+" || this.peek().text === "-") { const op = this.next().text; left = this.track({ kind: "binary", op, left, right: this.parseMultiplicative() }) }
    return left
  }
  private parseMultiplicative(): AstNode {
    let left = this.parseUnary()
    while (["*", "/", "%"].includes(this.peek().text)) { const op = this.next().text; left = this.track({ kind: "binary", op, left, right: this.parseUnary() }) }
    return left
  }
  private parseUnary(): AstNode {
    const t = this.peek()
    if (t.text === "!") { this.next(); return this.track({ kind: "unary", op: "!", operand: this.parseUnary() }) }
    if (t.text === "-") { this.next(); return this.track({ kind: "unary", op: "-", operand: this.parseUnary() }) }
    return this.parsePostfix()
  }
  private parsePostfix(): AstNode {
    let node = this.parsePrimary()
    while (this.peek().text === "." || this.peek().text === "[") {
      if (this.peek().text === ".") {
        this.next()
        const id = this.next()
        if (id.kind !== "id") throw new ExpressionError("EXPR_PARSE_ERROR", `expected property name at ${id.pos}`)
        node = this.track({ kind: "member", object: node, property: id.text })
      } else {
        this.next()
        const index = this.parseTernary()
        this.expect("]")
        node = this.track({ kind: "binary", op: "[]", left: node, right: index })
      }
    }
    return node
  }
  private parsePrimary(): AstNode {
    const t = this.next()
    if (t.kind === "op" && t.text === "(") { const inner = this.parseTernary(); this.expect(")"); return inner }
    if (t.kind === "op" && t.text === "[") {
      const items: AstNode[] = []
      while (this.peek().text !== "]") { items.push(this.parseTernary()); if (this.peek().text === ",") this.next() }
      this.expect("]")
      if (items.length > this.limits.maxListLength) throw new ExpressionError("EXPR_LIST_TOO_LONG", `list exceeds ${this.limits.maxListLength} items`)
      return this.track({ kind: "list", items })
    }
    if (t.kind === "num") return this.track({ kind: "lit", value: Number(t.text) })
    if (t.kind === "str") {
      if (t.text.length > this.limits.maxStringLength) throw new ExpressionError("EXPR_STRING_TOO_LONG", `string literal exceeds ${this.limits.maxStringLength} chars`)
      return this.track({ kind: "lit", value: t.text })
    }
    if (t.kind === "id") {
      if (t.text === "true") return this.track({ kind: "lit", value: true })
      if (t.text === "false") return this.track({ kind: "lit", value: false })
      if (t.text === "null") return this.track({ kind: "lit", value: null })
      return this.track({ kind: "id", name: t.text })
    }
    throw new ExpressionError("EXPR_PARSE_ERROR", `unexpected token ${JSON.stringify(t.text)} at ${t.pos}`)
  }
}

export function parseExpression(source: string, limits: ExpressionLimits = DEFAULT_EXPRESSION_LIMITS): CelAst {
  if (source.length > limits.maxExpressionChars) throw new ExpressionError("EXPR_TOO_LONG", `expression exceeds ${limits.maxExpressionChars} chars`)
  return new Parser(tokenize(source), limits, source).parse()
}

function deepEquals(a: CelValue, b: CelValue): boolean {
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((v, i) => deepEquals(v, b[i]!))
  if (a !== null && b !== null && typeof a === "object" && typeof b === "object" && !Array.isArray(a) && !Array.isArray(b)) {
    const ka = Object.keys(a).sort(); const kb = Object.keys(b).sort()
    return ka.length === kb.length && ka.every((k, i) => k === kb[i] && deepEquals((a as { [key: string]: CelValue })[k]!, (b as { [key: string]: CelValue })[kb[i]!]!))
  }
  return a === b
}

function evalNode(node: AstNode, env: Record<string, unknown>, depth: number, limits: ExpressionLimits): CelValue {
  if (depth > limits.maxEvalDepth) throw new ExpressionError("EXPR_DEPTH_EXCEEDED", `evaluation depth exceeds ${limits.maxEvalDepth}`)
  const next = depth + 1
  switch (node.kind) {
    case "lit": return node.value
    case "id": {
      if (!(node.name in env)) throw new ExpressionError("EXPR_UNKNOWN_IDENTIFIER", `unknown identifier: ${node.name}`)
      return env[node.name] as CelValue
    }
    case "member": {
      const target = evalNode(node.object, env, next, limits)
      if (target === null || typeof target !== "object" || Array.isArray(target)) throw new ExpressionError("EXPR_TYPE_ERROR", `cannot access member .${node.property} on non-object`)
      return (target as { [key: string]: CelValue })[node.property] ?? null
    }
    case "unary": {
      const v = evalNode(node.operand, env, next, limits)
      if (node.op === "!") return !v
      if (typeof v !== "number") throw new ExpressionError("EXPR_TYPE_ERROR", "unary - requires a number")
      return -v
    }
    case "list": return node.items.map((item) => evalNode(item, env, next, limits))
    case "ternary": return evalNode(node.condition, env, next, limits) ? evalNode(node.then, env, next, limits) : evalNode(node.else, env, next, limits)
    case "binary": {
      if (node.op === "&&") return evalNode(node.left, env, next, limits) && evalNode(node.right, env, next, limits)
      if (node.op === "||") return evalNode(node.left, env, next, limits) || evalNode(node.right, env, next, limits)
      if (node.op === "[]") {
        const target = evalNode(node.left, env, next, limits)
        const index = evalNode(node.right, env, next, limits)
        if (!Array.isArray(target) || typeof index !== "number") throw new ExpressionError("EXPR_TYPE_ERROR", "indexing requires a list and a number")
        return target[index] ?? null
      }
      return evalBinary(node.op, evalNode(node.left, env, next, limits), evalNode(node.right, env, next, limits))
    }
  }
}

function evalBinary(op: string, a: CelValue, b: CelValue): CelValue {
  if (op === "==") return deepEquals(a, b)
  if (op === "!=") return !deepEquals(a, b)
  if (op === "+") {
    if (typeof a === "string" && typeof b === "string") {
      if (a.length + b.length > DEFAULT_EXPRESSION_LIMITS.maxStringLength) throw new ExpressionError("EXPR_STRING_TOO_LONG", "concatenation exceeds string limit")
      return a + b
    }
    if (typeof a === "number" && typeof b === "number") return a + b
    throw new ExpressionError("EXPR_TYPE_ERROR", "+ requires two numbers or two strings")
  }
  if (typeof a !== "number" || typeof b !== "number") throw new ExpressionError("EXPR_TYPE_ERROR", `operator ${op} requires numbers`)
  switch (op) {
    case "-": return a - b
    case "*": return a * b
    case "/": if (b === 0) throw new ExpressionError("EXPR_EVAL_ERROR", "division by zero"); return a / b
    case "%": if (b === 0) throw new ExpressionError("EXPR_EVAL_ERROR", "modulo by zero"); return a % b
    case "<": return a < b
    case ">": return a > b
    case "<=": return a <= b
    case ">=": return a >= b
  }
  throw new ExpressionError("EXPR_EVAL_ERROR", `unsupported operator ${op}`)
}

export function evaluateExpression(ast: CelAst, env: Record<string, unknown>, limits: ExpressionLimits = DEFAULT_EXPRESSION_LIMITS): CelValue {
  const result = evalNode(ast.root, env, 0, limits)
  return result
}

/** Convenience: parse + evaluate in one call. */
export function evaluate(source: string, env: Record<string, unknown>, limits: ExpressionLimits = DEFAULT_EXPRESSION_LIMITS): CelValue {
  return evaluateExpression(parseExpression(source, limits), env, limits)
}

/** AST-walker dependency extraction: root identifiers the expression reads. */
export function extractDependencies(source: string, limits: ExpressionLimits = DEFAULT_EXPRESSION_LIMITS): readonly string[] {
  const ast = parseExpression(source, limits)
  const roots = new Set<string>()
  const walk = (node: AstNode): void => {
    if (node.kind === "id") roots.add(node.name)
    else if (node.kind === "member") walk(node.object)
    else if (node.kind === "unary") walk(node.operand)
    else if (node.kind === "list") node.items.forEach(walk)
    else if (node.kind === "ternary") { walk(node.condition); walk(node.then); walk(node.else) }
    else if (node.kind === "binary") { walk(node.left); walk(node.right) }
  }
  walk(ast.root)
  return [...roots].sort()
}
