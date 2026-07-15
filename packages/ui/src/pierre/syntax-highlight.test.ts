import { expect, test } from "bun:test"

const pierreSource = await Bun.file(new URL("./index.ts", import.meta.url)).text()

test("read-only viewer keeps every OpenCode syntax token colored under CSP", () => {
  for (const token of [
    "comment", "regexp", "string", "keyword", "primitive", "operator",
    "variable", "property", "type", "constant", "punctuation", "object",
    "critical", "warning", "info", "unknown",
  ]) {
    expect(pierreSource).toContain(`span[style*=\"--syntax-${token}\"]`)
  }
})