import { describe, it, expect } from "bun:test"
import { cosineSimilarity, vectorToBuffer, bufferToVector, topK } from "../../src/rag/vector"

describe("vector operations", () => {
  it("cosineSimilarity: identical vectors return 1", () => {
    const a = new Float32Array([1, 2, 3])
    expect(cosineSimilarity(a, a)).toBeCloseTo(1.0, 5)
  })

  it("cosineSimilarity: orthogonal vectors return 0", () => {
    const a = new Float32Array([1, 0])
    const b = new Float32Array([0, 1])
    expect(cosineSimilarity(a, b)).toBeCloseTo(0.0, 5)
  })

  it("cosineSimilarity: opposite vectors return -1", () => {
    const a = new Float32Array([1, 2, 3])
    const b = new Float32Array([-1, -2, -3])
    expect(cosineSimilarity(a, b)).toBeCloseTo(-1.0, 5)
  })

  it("cosineSimilarity: dimension mismatch throws", () => {
    const a = new Float32Array([1, 2])
    const b = new Float32Array([1, 2, 3])
    expect(() => cosineSimilarity(a, b)).toThrow("Dimension mismatch")
  })

  it("vectorToBuffer/bufferToVector roundtrip", () => {
    const original = new Float32Array([0.1, 0.5, -0.3, 1.0])
    const buf = vectorToBuffer(original)
    const restored = bufferToVector(buf)
    expect(restored.length).toBe(original.length)
    for (let i = 0; i < original.length; i++) {
      expect(restored[i]).toBeCloseTo(original[i], 5)
    }
  })

  it("topK returns correct order", () => {
    const query = new Float32Array([1, 0, 0])
    const candidates = [
      { id: "a", vector: new Float32Array([0, 1, 0]) }, // orthogonal
      { id: "b", vector: new Float32Array([1, 0, 0]) }, // identical
      { id: "c", vector: new Float32Array([0.9, 0.1, 0]) }, // close
    ]
    const results = topK(query, candidates, 2)
    expect(results).toHaveLength(2)
    expect(results[0].id).toBe("b")
    expect(results[1].id).toBe("c")
    expect(results[0].score).toBeGreaterThan(results[1].score)
  })
})
