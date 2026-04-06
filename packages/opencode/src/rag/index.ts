/**
 * RAG (Retrieval-Augmented Generation) system.
 *
 * Indexes code files, compaction summaries, and learnings into embeddings.
 * Provides semantic search to inject relevant context into the system prompt.
 */
import { eq, and, inArray } from "drizzle-orm"
import { ulid } from "ulid"
import { EmbeddingTable } from "./rag.sql"
import { vectorToBuffer, bufferToVector, topK } from "./vector"
import { generateEmbedding, generateEmbeddings, getEmbeddingConfig, type EmbeddingModelConfig } from "./embed"
import { chunkCode, chunkText, hashContent, type Chunk } from "./chunk"
import { Log } from "../util/log"
import { Filesystem } from "../util/filesystem"
import { Database } from "../storage/db"
import { Instance } from "../project/instance"
import { Config } from "../config/config"
import type { ProjectID } from "../project/schema"
import path from "path"

const log = Log.create({ service: "rag" })
const MAX_BATCH_SIZE = 50
const DEFAULT_TOP_K = 5
const MIN_SIMILARITY = 0.3

export namespace RAG {
  export interface SearchResult {
    id: string
    content: string
    score: number
    sourceType: string
    sourceId: string
    metadata: Record<string, unknown>
  }

  /** Check if RAG is enabled via config. */
  export function isEnabled(): boolean {
    const cfg = Config.info()
    return cfg?.experimental?.rag?.enabled === true
  }

  /** Index a single file into the RAG store. */
  export async function indexFile(projectID: ProjectID, filePath: string): Promise<number> {
    if (!isEnabled()) return 0
    const config = getEmbeddingConfig()
    const content = await Filesystem.readText(filePath)
    if (!content.trim()) return 0

    const relativePath = path.relative(Instance.worktree, filePath)
    const chunks = chunkCode(content, relativePath)
    if (chunks.length === 0) return 0

    return indexChunks(projectID, "file", relativePath, chunks, config)
  }

  /** Index a compaction summary. */
  export async function indexSummary(projectID: ProjectID, sessionID: string, summary: string): Promise<number> {
    if (!isEnabled()) return 0
    const config = getEmbeddingConfig()
    const chunks = chunkText(`Session summary:\n\n${summary}`, { sessionID })
    return indexChunks(projectID, "summary", sessionID, chunks, config)
  }

  /** Index a learning entry. */
  export async function indexLearning(projectID: ProjectID, filePath: string, content: string): Promise<number> {
    if (!isEnabled()) return 0
    const config = getEmbeddingConfig()
    const chunks = chunkText(`Learning:\n\n${content}`, { file: filePath })
    return indexChunks(projectID, "learning", filePath, chunks, config)
  }

  /** Index multiple files in batch. */
  export async function indexFiles(projectID: ProjectID, filePaths: string[]): Promise<number> {
    if (!isEnabled()) return 0
    let total = 0
    for (const fp of filePaths) {
      try {
        total += await indexFile(projectID, fp)
      } catch (e) {
        log.warn("failed to index file", { file: fp, error: e })
      }
    }
    return total
  }

  /** Semantic search across all indexed content. */
  export async function search(
    projectID: ProjectID,
    query: string,
    options?: { topK?: number; sourceTypes?: string[]; minSimilarity?: number },
  ): Promise<SearchResult[]> {
    if (!isEnabled()) return []
    const config = getEmbeddingConfig()
    const k = options?.topK ?? DEFAULT_TOP_K
    const minSim = options?.minSimilarity ?? MIN_SIMILARITY

    // Generate query embedding
    const { embedding: queryVec } = await generateEmbedding(query, config)

    // Load candidate vectors from DB
    const db = Database.Client()
    const conditions = [eq(EmbeddingTable.project_id, projectID)]
    if (options?.sourceTypes?.length) {
      conditions.push(inArray(EmbeddingTable.source_type, options.sourceTypes))
    }

    const rows = db.select().from(EmbeddingTable).where(and(...conditions)).all()

    if (rows.length === 0) return []

    // Compute similarity in JS
    const candidates = rows.map((r) => ({
      id: r.id,
      vector: bufferToVector(r.vector as Buffer),
    }))

    const results = topK(queryVec, candidates, k)

    // Hydrate results with content
    const resultIds = results.filter((r) => r.score >= minSim).map((r) => r.id)
    if (resultIds.length === 0) return []

    const hydrated = db
      .select()
      .from(EmbeddingTable)
      .where(inArray(EmbeddingTable.id, resultIds))
      .all()

    const hydMap = new Map(hydrated.map((h) => [h.id, h]))

    let localResults = results
      .filter((r) => r.score >= minSim)
      .map((r) => {
        const row = hydMap.get(r.id)!
        return {
          id: r.id,
          content: row.content,
          score: r.score,
          sourceType: row.source_type,
          sourceId: row.source_id,
          metadata: (row.metadata as Record<string, unknown>) ?? {},
        }
      })

    // Optionally merge with AnythingLLM vector store results
    try {
      const cfg = Config.info()
      if (cfg?.experimental?.anythingllm?.vector_bridge) {
        const { AnythingLLMVectorStore } = await import("./vector-store")
        const store = new AnythingLLMVectorStore(cfg.experimental.anythingllm.workspaces)
        const remoteResults = await store.search(query, { topK: k })
        const merged = [...localResults, ...remoteResults.map((r) => ({
          id: r.id,
          content: r.content,
          score: r.score,
          sourceType: r.source,
          sourceId: r.id,
          metadata: r.metadata ?? {},
        }))]
        merged.sort((a, b) => b.score - a.score)
        return merged.slice(0, k)
      }
    } catch {}

    return localResults
  }

  /** Format search results as context for the system prompt. */
  export function formatContext(results: SearchResult[]): string {
    if (results.length === 0) return ""
    const sections = results.map((r, i) => {
      const source =
        r.sourceType === "file"
          ? `File: ${r.sourceId}`
          : r.sourceType === "summary"
            ? `Session summary`
            : `Learning`
      return `[${i + 1}] ${source} (relevance: ${(r.score * 100).toFixed(0)}%)\n${r.content}`
    })
    return `<rag-context>\nThe following context was retrieved from the project's knowledge base:\n\n${sections.join("\n\n---\n\n")}\n</rag-context>`
  }

  /** Remove all embeddings for a specific source. */
  export async function removeSource(projectID: ProjectID, sourceType: string, sourceId: string): Promise<void> {
    const db = Database.Client()
    db.delete(EmbeddingTable)
      .where(
        and(
          eq(EmbeddingTable.project_id, projectID),
          eq(EmbeddingTable.source_type, sourceType),
          eq(EmbeddingTable.source_id, sourceId),
        ),
      )
      .run()
  }

  /** Get stats about the RAG index for a project. */
  export async function stats(projectID: ProjectID): Promise<{
    total: number
    bySource: Record<string, number>
  }> {
    const db = Database.Client()
    const rows = db.select().from(EmbeddingTable).where(eq(EmbeddingTable.project_id, projectID)).all()
    const bySource: Record<string, number> = {}
    for (const row of rows) {
      bySource[row.source_type] = (bySource[row.source_type] ?? 0) + 1
    }
    return { total: rows.length, bySource }
  }

  // ─── Internal ─────────────────────────────────────────────────────────

  async function indexChunks(
    projectID: ProjectID,
    sourceType: string,
    sourceId: string,
    chunks: Chunk[],
    config: EmbeddingModelConfig,
  ): Promise<number> {
    const db = Database.Client()

    // Check for existing hashes to avoid re-embedding unchanged content
    const existingRows = db
      .select({ content_hash: EmbeddingTable.content_hash })
      .from(EmbeddingTable)
      .where(
        and(
          eq(EmbeddingTable.project_id, projectID),
          eq(EmbeddingTable.source_type, sourceType),
          eq(EmbeddingTable.source_id, sourceId),
        ),
      )
      .all()
    const existingHashes = new Set(existingRows.map((r) => r.content_hash))

    // Filter to only new/changed chunks
    const newChunks = chunks.filter((c) => !existingHashes.has(c.hash))
    if (newChunks.length === 0) {
      log.info("no new chunks to index", { sourceType, sourceId })
      return 0
    }

    // Remove old embeddings for this source (we'll replace them)
    db.delete(EmbeddingTable)
      .where(
        and(
          eq(EmbeddingTable.project_id, projectID),
          eq(EmbeddingTable.source_type, sourceType),
          eq(EmbeddingTable.source_id, sourceId),
        ),
      )
      .run()

    // Generate embeddings in batches
    let indexed = 0
    for (let i = 0; i < chunks.length; i += MAX_BATCH_SIZE) {
      const batch = chunks.slice(i, i + MAX_BATCH_SIZE)
      const texts = batch.map((c) => c.content)

      try {
        const { embeddings } = await generateEmbeddings(texts, config)

        for (let j = 0; j < batch.length; j++) {
          db.insert(EmbeddingTable)
            .values({
              id: ulid(),
              project_id: projectID,
              source_type: sourceType,
              source_id: sourceId,
              content: batch[j].content,
              vector: vectorToBuffer(embeddings[j]),
              model: config.model,
              dimensions: config.dimensions,
              metadata: batch[j].metadata,
              content_hash: batch[j].hash,
              time_created: Date.now(),
              time_updated: Date.now(),
            })
            .run()
          indexed++
        }
      } catch (e) {
        log.warn("failed to generate embeddings for batch", { sourceType, sourceId, batch: i, error: e })
      }
    }

    log.info("indexed chunks", { sourceType, sourceId, total: indexed })
    return indexed
  }
}
