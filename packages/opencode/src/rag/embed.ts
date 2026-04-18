/**
 * Embedding generation using the Vercel AI SDK.
 * Supports any provider that implements embeddingModel() (OpenAI, Google, etc.)
 */
import { embed, embedMany } from "ai"
import { createOpenAI } from "@ai-sdk/openai"
import { createGoogleGenerativeAI } from "@ai-sdk/google"
import { z } from "zod"
import { Log } from "../util/log"
import { Config } from "../config/config"

const log = Log.create({ service: "rag.embed" })

// S2.V2: the Vercel AI SDK already types the response, but a hostile or
// buggy provider (e.g. a self-hosted OpenAI-compatible endpoint returning
// malformed JSON that passes through `ai.embed`) can still feed us
// non-numeric arrays, wrong dimensions, or NaNs that would corrupt vector
// math downstream. Validate explicitly.
const VectorSchema = z.array(z.number().finite()).min(1)

function assertVector(vec: unknown, expected?: number): number[] {
  const parsed = VectorSchema.safeParse(vec)
  if (!parsed.success) {
    throw new Error(`embedding: invalid vector shape (${parsed.error.message})`)
  }
  if (expected !== undefined && parsed.data.length !== expected) {
    throw new Error(
      `embedding: dimension mismatch — expected ${expected}, got ${parsed.data.length}`,
    )
  }
  return parsed.data
}

export type EmbeddingProvider = "openai" | "google" | "local" | "bm25"
export type EmbeddingModelConfig = {
  provider: EmbeddingProvider
  model: string
  dimensions: number
}

const DEFAULT_CONFIG: EmbeddingModelConfig = {
  provider: "openai",
  model: "text-embedding-3-small",
  dimensions: 1536,
}

async function getEmbeddingModel(config?: EmbeddingModelConfig) {
  const cfg = config ?? DEFAULT_CONFIG
  const ragConfig = (await Config.get())?.experimental?.rag
  const apiKey = ragConfig?.api_key

  switch (cfg.provider) {
    case "openai": {
      const openai = createOpenAI({
        ...(apiKey ? { apiKey } : {}),
      })
      return openai.embeddingModel(cfg.model)
    }
    case "google": {
      const google = createGoogleGenerativeAI({
        ...(apiKey ? { apiKey } : {}),
      })
      return google.textEmbeddingModel(cfg.model)
    }
    case "local": {
      // llama-server exposes /v1/embeddings compatible with OpenAI SDK
      const local = createOpenAI({
        baseURL: "http://127.0.0.1:14097/v1",
        apiKey: "not-needed",
      })
      return local.embeddingModel(cfg.model || "local")
    }
    case "bm25":
      throw new Error("BM25 provider does not use neural embeddings")
    default:
      throw new Error(`Unsupported embedding provider: ${cfg.provider}`)
  }
}

/** Generate embedding for a single text. */
export async function generateEmbedding(
  text: string,
  config?: EmbeddingModelConfig,
): Promise<{ embedding: Float32Array; tokens: number }> {
  const model = await getEmbeddingModel(config)
  const result = await embed({ model, value: text })
  const vec = assertVector(result.embedding, config?.dimensions)
  log.info("generated embedding", { tokens: result.usage?.tokens ?? 0, dimensions: vec.length })
  return {
    embedding: new Float32Array(vec),
    tokens: result.usage?.tokens ?? 0,
  }
}

/** Generate embeddings for multiple texts in batch. */
export async function generateEmbeddings(
  texts: string[],
  config?: EmbeddingModelConfig,
): Promise<{ embeddings: Float32Array[]; tokens: number }> {
  if (texts.length === 0) return { embeddings: [], tokens: 0 }
  const model = await getEmbeddingModel(config)
  const result = await embedMany({ model, values: texts })
  if (!Array.isArray(result.embeddings) || result.embeddings.length !== texts.length) {
    throw new Error(
      `embedding: batch size mismatch — sent ${texts.length}, got ${
        Array.isArray(result.embeddings) ? result.embeddings.length : "non-array"
      }`,
    )
  }
  const validated = result.embeddings.map((e) => assertVector(e, config?.dimensions))
  log.info("generated embeddings", {
    count: texts.length,
    tokens: result.usage?.tokens ?? 0,
  })
  return {
    embeddings: validated.map((e) => new Float32Array(e)),
    tokens: result.usage?.tokens ?? 0,
  }
}

/** Get the configured embedding model settings, falling back to defaults. */
export async function getEmbeddingConfig(): Promise<EmbeddingModelConfig> {
  const ragConfig = (await Config.get())?.experimental?.rag
  if (!ragConfig) return DEFAULT_CONFIG
  return {
    provider: (ragConfig.provider as EmbeddingProvider) ?? DEFAULT_CONFIG.provider,
    model: ragConfig.model ?? DEFAULT_CONFIG.model,
    dimensions: ragConfig.dimensions ?? DEFAULT_CONFIG.dimensions,
  }
}
