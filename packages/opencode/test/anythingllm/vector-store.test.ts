import { describe, it, expect } from "bun:test"
import { CompositeVectorStore, type VectorStore, type VectorStoreResult } from "../../src/rag/vector-store"

// Mock vector store for testing
class MockVectorStore implements VectorStore {
  readonly name: string
  private results: VectorStoreResult[]

  constructor(name: string, results: VectorStoreResult[]) {
    this.name = name
    this.results = results
  }

  async search(): Promise<VectorStoreResult[]> {
    return this.results
  }
}

class FailingVectorStore implements VectorStore {
  readonly name = "failing"

  async search(): Promise<VectorStoreResult[]> {
    throw new Error("Connection failed")
  }
}

describe("CompositeVectorStore", () => {
  it("merges results from multiple stores sorted by score", async () => {
    const store1 = new MockVectorStore("local", [
      { id: "1", content: "local result", score: 0.8, source: "local" },
    ])
    const store2 = new MockVectorStore("remote", [
      { id: "2", content: "remote result", score: 0.9, source: "remote" },
    ])

    const composite = new CompositeVectorStore()
    composite.add(store1)
    composite.add(store2)

    const results = await composite.search("test query")
    expect(results).toHaveLength(2)
    expect(results[0].source).toBe("remote") // Higher score first
    expect(results[1].source).toBe("local")
  })

  it("limits results to topK", async () => {
    const store = new MockVectorStore("local", [
      { id: "1", content: "a", score: 0.9, source: "local" },
      { id: "2", content: "b", score: 0.8, source: "local" },
      { id: "3", content: "c", score: 0.7, source: "local" },
    ])

    const composite = new CompositeVectorStore()
    composite.add(store)

    const results = await composite.search("test", { topK: 2 })
    expect(results).toHaveLength(2)
  })

  it("handles store failures gracefully", async () => {
    const good = new MockVectorStore("good", [
      { id: "1", content: "ok", score: 0.8, source: "good" },
    ])
    const bad = new FailingVectorStore()

    const composite = new CompositeVectorStore()
    composite.add(good)
    composite.add(bad)

    const results = await composite.search("test")
    expect(results).toHaveLength(1)
    expect(results[0].source).toBe("good")
  })

  it("returns empty for no stores", async () => {
    const composite = new CompositeVectorStore()
    const results = await composite.search("test")
    expect(results).toHaveLength(0)
  })
})
