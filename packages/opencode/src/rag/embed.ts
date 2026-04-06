/**
 * Embedding generation using the Vercel AI SDK.
 * Supports any provider that implements embeddingModel() (OpenAI, Google, etc.)
 */
import { embed, embedMany } from "ai"
import { createOpenAI } from "@ai-sdk/openai"
import { createGoogleGenerativeAI } from "@ai-sdk/google"
import { Log } from "../util/log"
import { Config } from "../config/config"

const log = Log.create({ service: "rag.embed" })

export type EmbeddingProvider = "openai" | "google"
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
  log.info("generated embedding", { tokens: result.usage?.tokens ?? 0, dimensions: result.embedding.length })
  return {
    embedding: new Float32Array(result.embedding),
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
  log.info("generated embeddings", {
    count: texts.length,
    tokens: result.usage?.tokens ?? 0,
  })
  return {
    embeddings: result.embeddings.map((e) => new Float32Array(e)),
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
