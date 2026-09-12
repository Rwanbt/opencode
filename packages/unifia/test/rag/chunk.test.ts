import { describe, it, expect } from "bun:test"
import { chunkCode, chunkText, hashContent } from "../../src/rag/chunk"

describe("chunking", () => {
  it("hashContent is deterministic", () => {
    const a = hashContent("hello world")
    const b = hashContent("hello world")
    expect(a).toBe(b)
    expect(a).toHaveLength(16)
  })

  it("hashContent differs for different content", () => {
    expect(hashContent("foo")).not.toBe(hashContent("bar"))
  })

  it("chunkCode: small file returns single chunk", () => {
    const content = 'function hello() {\n  return "world"\n}'
    const chunks = chunkCode(content, "test.ts")
    expect(chunks).toHaveLength(1)
    expect(chunks[0].content).toContain("File: test.ts")
    expect(chunks[0].content).toContain("function hello")
  })

  it("chunkCode: detects function boundaries", () => {
    const lines = []
    // Generate a file large enough to trigger boundary detection (>40 lines)
    for (let i = 0; i < 3; i++) {
      lines.push(`function fn${i}() {`)
      for (let j = 0; j < 15; j++) {
        lines.push(`  const x${j} = ${j}`)
      }
      lines.push("}")
      lines.push("")
    }
    const chunks = chunkCode(lines.join("\n"), "big.ts")
    expect(chunks.length).toBeGreaterThanOrEqual(3)
    expect(chunks[0].metadata.name).toBe("fn0")
    expect(chunks[0].metadata.kind).toBe("function")
  })

  it("chunkText: splits long text with overlap", () => {
    const text = "a".repeat(5000)
    const chunks = chunkText(text)
    expect(chunks.length).toBeGreaterThan(1)
    // Each chunk should have a chunkIndex
    expect(chunks[0].metadata.chunkIndex).toBe(0)
    expect(chunks[1].metadata.chunkIndex).toBe(1)
  })

  it("chunkText: empty text returns nothing", () => {
    const chunks = chunkText("   ")
    expect(chunks).toHaveLength(0)
  })
})
