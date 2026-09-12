import { Log } from "../util/log"

const log = Log.create({ service: "vector-store" })

/**
 * Abstract vector store interface.
 * Allows plugging in different backends (local SQLite, AnythingLLM, etc.)
 */
export interface VectorStore {
  readonly name: string

  search(
    query: string,
    options?: { topK?: number; projectID?: string },
  ): Promise<VectorStoreResult[]>
}

export interface VectorStoreResult {
  id: string
  content: string
  score: number
  source: string // "local" | "anythingllm" | etc.
  metadata?: Record<string, any>
}

/**
 * Composite vector store that queries multiple backends and merges results.
 */
export class CompositeVectorStore implements VectorStore {
  readonly name = "composite"
  private stores: VectorStore[] = []

  add(store: VectorStore) {
    this.stores.push(store)
    log.info("added vector store", { name: store.name })
  }

  async search(
    query: string,
    options?: { topK?: number; projectID?: string },
  ): Promise<VectorStoreResult[]> {
    const topK = options?.topK ?? 5

    // Query all stores in parallel
    const results = await Promise.all(
      this.stores.map(async (store) => {
        try {
          return await store.search(query, options)
        } catch (e) {
          log.warn("vector store search failed", { store: store.name, error: String(e) })
          return []
        }
      }),
    )

    // Merge and sort by score
    const merged = results
      .flat()
      .sort((a, b) => b.score - a.score)
      .slice(0, topK)

    return merged
  }
}

/**
 * AnythingLLM vector store adapter.
 * Proxies search requests to AnythingLLM's REST API.
 */
export class AnythingLLMVectorStore implements VectorStore {
  readonly name = "anythingllm"
  private workspaceSlugs?: string[]

  constructor(workspaceSlugs?: string[]) {
    this.workspaceSlugs = workspaceSlugs
  }

  async search(
    query: string,
    options?: { topK?: number },
  ): Promise<VectorStoreResult[]> {
    // Lazy import to avoid circular dependency
    const { AnythingLLMClient } = await import("../anythingllm/client")

    if (!AnythingLLMClient.isConfigured()) return []

    const results = await AnythingLLMClient.searchAll(
      query,
      this.workspaceSlugs,
      options?.topK ?? 5,
    )

    return results.flatMap((r) =>
      r.results.map((result) => ({
        id: `allm_${r.workspace}_${Math.random().toString(36).slice(2)}`,
        content: result.text,
        score: result.score,
        source: "anythingllm",
        metadata: { workspace: r.workspace, ...result.metadata },
      })),
    )
  }
}
