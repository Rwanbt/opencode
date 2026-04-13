/**
 * RAG (Retrieval-Augmented Generation) system.
 *
 * Indexes code files, compaction summaries, and learnings into embeddings.
 * Provides semantic search to inject relevant context into the system prompt.
 */
import { eq, and, inArray } from "drizzle-orm"
import { ulid } from "ulid"
import { EmbeddingTable } from "./rag.sql"
import { BM25DocTable } from "./bm25.sql"
import { vectorToBuffer, bufferToVector, topK } from "./vector"
import { generateEmbedding, generateEmbeddings, getEmbeddingConfig, type EmbeddingModelConfig, type EmbeddingProvider } from "./embed"
import { tokenize, termFrequency, searchBM25, type BM25Doc } from "./bm25"
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

  /** Check if RAG is enabled. Auto-enables with BM25 when no config present. */
  export async function isEnabled(): Promise<boolean> {
    const cfg = await Config.get()
    const ragConfig = cfg?.experimental?.rag
    if (ragConfig?.enabled === false) return false
    if (ragConfig?.enabled === true) return true
    // Auto-enable: BM25 is always available as fallback
    return true
  }

  /** Detect which embedding/search provider to use. */
  export async function getActiveProvider(): Promise<EmbeddingProvider> {
    const cfg = await Config.get()
    const ragConfig = cfg?.experimental?.rag

    // 1. Explicit config
    if (ragConfig?.provider) return ragConfig.provider as EmbeddingProvider

    // 2. Cloud API key available
    if (ragConfig?.api_key) return ragConfig.provider as EmbeddingProvider ?? "openai"

    // 3. llama-server running with embedding support
    try {
      const resp = await fetch("http://127.0.0.1:14097/v1/embeddings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ input: "test", model: "local" }),
        signal: AbortSignal.timeout(2000),
      })
      if (resp.ok) return "local"
    } catch {}

    // 4. Fallback: BM25 always works
    return "bm25"
  }

  /** Index a single file into the RAG store. */
  export async function indexFile(projectID: ProjectID, filePath: string): Promise<number> {
    if (!(await isEnabled())) return 0
    const provider = await getActiveProvider()
    const content = await Filesystem.readText(filePath)
    if (!content.trim()) return 0

    const relativePath = path.relative(Instance.worktree, filePath)
    const chunks = chunkCode(content, relativePath)
    if (chunks.length === 0) return 0

    if (provider === "bm25") return indexBM25Chunks(projectID, "file", relativePath, chunks)
    const config = await getEmbeddingConfig()
    return indexVectorChunks(projectID, "file", relativePath, chunks, config)
  }

  /** Index a compaction summary. */
  export async function indexSummary(projectID: ProjectID, sessionID: string, summary: string): Promise<number> {
    if (!(await isEnabled())) return 0
    const provider = await getActiveProvider()
    const chunks = chunkText(`Session summary:\n\n${summary}`, { sessionID })

    if (provider === "bm25") return indexBM25Chunks(projectID, "summary", sessionID, chunks)
    const config = await getEmbeddingConfig()
    return indexVectorChunks(projectID, "summary", sessionID, chunks, config)
  }

  /** Index a learning entry. */
  export async function indexLearning(projectID: ProjectID, filePath: string, content: string): Promise<number> {
    if (!(await isEnabled())) return 0
    const provider = await getActiveProvider()
    const chunks = chunkText(`Learning:\n\n${content}`, { file: filePath })

    if (provider === "bm25") return indexBM25Chunks(projectID, "learning", filePath, chunks)
    const config = await getEmbeddingConfig()
    return indexVectorChunks(projectID, "learning", filePath, chunks, config)
  }

  /** Index multiple files in batch. */
  export async function indexFiles(projectID: ProjectID, filePaths: string[]): Promise<number> {
    if (!(await isEnabled())) return 0
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

  /** Search across all indexed content (vector or BM25 depending on provider). */
  export async function search(
    projectID: ProjectID,
    query: string,
    options?: { topK?: number; sourceTypes?: string[]; minSimilarity?: number },
  ): Promise<SearchResult[]> {
    if (!(await isEnabled())) return []
    const provider = await getActiveProvider()
    const k = options?.topK ?? DEFAULT_TOP_K

    if (provider === "bm25") {
      return bm25Search(projectID, query, k, options?.sourceTypes)
    }
    return vectorSearch(projectID, query, k, options?.minSimilarity ?? MIN_SIMILARITY, options?.sourceTypes)
  }

  /** BM25 keyword search. */
  async function bm25Search(
    projectID: ProjectID,
    query: string,
    k: number,
    sourceTypes?: string[],
  ): Promise<SearchResult[]> {
    const db = Database.Client()
    const conditions = [eq(BM25DocTable.project_id, projectID)]
    if (sourceTypes?.length) {
      conditions.push(inArray(BM25DocTable.source_type, sourceTypes))
    }

    const rows = db.select().from(BM25DocTable).where(and(...conditions)).all()
    if (rows.length === 0) return []

    const docs: BM25Doc[] = rows.map((r) => ({
      id: r.id,
      tf: r.tokens as Record<string, number>,
      docLength: r.doc_length,
    }))

    const scored = searchBM25(query, docs, k)

    // Hydrate results
    const resultIds = scored.map((s) => s.id)
    if (resultIds.length === 0) return []

    const hydrated = db.select().from(BM25DocTable).where(inArray(BM25DocTable.id, resultIds)).all()
    const hydMap = new Map(hydrated.map((h) => [h.id, h]))

    return scored.map((s) => {
      const row = hydMap.get(s.id)!
      return {
        id: s.id,
        content: row.content,
        score: s.score,
        sourceType: row.source_type,
        sourceId: row.source_id,
        metadata: {},
      }
    })
  }

  /** Vector-based semantic search (OpenAI/Google/local embeddings). */
  async function vectorSearch(
    projectID: ProjectID,
    query: string,
    k: number,
    minSim: number,
    sourceTypes?: string[],
  ): Promise<SearchResult[]> {
    const config = await getEmbeddingConfig()
    const { embedding: queryVec } = await generateEmbedding(query, config)

    const db = Database.Client()
    const conditions = [eq(EmbeddingTable.project_id, projectID)]
    if (sourceTypes?.length) {
      conditions.push(inArray(EmbeddingTable.source_type, sourceTypes))
    }

    const rows = db.select().from(EmbeddingTable).where(and(...conditions)).all()
    if (rows.length === 0) return []

    const candidates = rows.map((r) => ({
      id: r.id,
      vector: bufferToVector(r.vector as Buffer),
    }))

    const results = topK(queryVec, candidates, k)
    const resultIds = results.filter((r) => r.score >= minSim).map((r) => r.id)
    if (resultIds.length === 0) return []

    const hydrated = db.select().from(EmbeddingTable).where(inArray(EmbeddingTable.id, resultIds)).all()
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
      const cfg = await Config.get()
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

  /** Get stats about the RAG index for a project (both vector and BM25). */
  export async function stats(projectID: ProjectID): Promise<{
    total: number
    bySource: Record<string, number>
  }> {
    const db = Database.Client()
    const bySource: Record<string, number> = {}

    const embRows = db.select().from(EmbeddingTable).where(eq(EmbeddingTable.project_id, projectID)).all()
    for (const row of embRows) {
      bySource[row.source_type] = (bySource[row.source_type] ?? 0) + 1
    }

    const bm25Rows = db.select().from(BM25DocTable).where(eq(BM25DocTable.project_id, projectID)).all()
    for (const row of bm25Rows) {
      bySource[row.source_type] = (bySource[row.source_type] ?? 0) + 1
    }

    return { total: embRows.length + bm25Rows.length, bySource }
  }

  // ─── Internal ─────────────────────────────────────────────────────────

  /** Index chunks using BM25 (keyword-based, no neural embeddings needed). */
  async function indexBM25Chunks(
    projectID: ProjectID,
    sourceType: string,
    sourceId: string,
    chunks: Chunk[],
  ): Promise<number> {
    const db = Database.Client()

    // Check existing hashes
    const existingRows = db
      .select({ content_hash: BM25DocTable.content_hash })
      .from(BM25DocTable)
      .where(and(eq(BM25DocTable.project_id, projectID), eq(BM25DocTable.source_type, sourceType), eq(BM25DocTable.source_id, sourceId)))
      .all()
    const existingHashes = new Set(existingRows.map((r) => r.content_hash))

    const newChunks = chunks.filter((c) => !existingHashes.has(c.hash))
    if (newChunks.length === 0) return 0

    // Remove old docs for this source
    db.delete(BM25DocTable)
      .where(and(eq(BM25DocTable.project_id, projectID), eq(BM25DocTable.source_type, sourceType), eq(BM25DocTable.source_id, sourceId)))
      .run()

    // Insert all chunks with their TF maps
    let indexed = 0
    for (const chunk of chunks) {
      const tokens = tokenize(chunk.content)
      const tf = termFrequency(tokens)
      db.insert(BM25DocTable)
        .values({
          id: ulid(),
          project_id: projectID,
          source_type: sourceType,
          source_id: sourceId,
          content: chunk.content,
          content_hash: chunk.hash,
          tokens: tf,
          doc_length: tokens.length,
          time_created: Date.now(),
          time_updated: Date.now(),
        })
        .run()
      indexed++
    }

    log.info("indexed bm25 chunks", { sourceType, sourceId, total: indexed })
    return indexed
  }

  /** Index chunks using neural embeddings (OpenAI/Google/local). */
  async function indexVectorChunks(
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
