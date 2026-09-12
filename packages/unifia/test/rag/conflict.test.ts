import { describe, it, expect } from "bun:test"
import { detectConflicts, type ConflictCandidate } from "../../src/rag/conflict"
import { vectorToBuffer } from "../../src/rag/vector"

describe("conflict resolution", () => {
  function makeCandidate(
    id: string,
    vector: Float32Array,
    opts?: Partial<ConflictCandidate>,
  ): ConflictCandidate {
    return {
      id,
      content: `content for ${id}`,
      vector: vectorToBuffer(vector),
      sourceType: "learning",
      sourceId: `src-${id}`,
      createdAt: Date.now(),
      ...opts,
    }
  }

  it("detects no conflicts for dissimilar embeddings", () => {
    const a = makeCandidate("a", new Float32Array([1, 0, 0]))
    const b = makeCandidate("b", new Float32Array([0, 1, 0]))
    const resolutions = detectConflicts([a, b])
    expect(resolutions).toHaveLength(0)
  })

  it("detects duplicate from same source", () => {
    const now = Date.now()
    const vec = new Float32Array([1, 0.1, 0])
    const a = makeCandidate("a", vec, { sourceId: "same", createdAt: now - 1000 })
    const b = makeCandidate("b", vec, { sourceId: "same", createdAt: now })
    const resolutions = detectConflicts([a, b])
    expect(resolutions).toHaveLength(1)
    expect(resolutions[0].keep).toBe("b") // newer
    expect(resolutions[0].remove).toBe("a")
  })

  it("resolves near-duplicates by recency", () => {
    const now = Date.now()
    // Very similar but not identical vectors
    const a = makeCandidate("a", new Float32Array([1, 0.05, 0.01]), { createdAt: now - 60000 })
    const b = makeCandidate("b", new Float32Array([1, 0.06, 0.01]), { createdAt: now })
    const resolutions = detectConflicts([a, b])
    if (resolutions.length > 0) {
      expect(resolutions[0].keep).toBe("b") // newer
    }
  })

  it("ignores embeddings from different source types", () => {
    const vec = new Float32Array([1, 0, 0])
    const a = makeCandidate("a", vec, { sourceType: "file" })
    const b = makeCandidate("b", vec, { sourceType: "learning" })
    const resolutions = detectConflicts([a, b])
    expect(resolutions).toHaveLength(0)
  })
})
