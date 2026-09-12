/**
 * Connecteur source : models.dev (https://models.dev/api.json)
 *
 * Licence : MIT (Copyright (c) 2025 models.dev)
 * Provenance : MIT, vérifié par A05 §3 (gh api repos/anomalyco/models.dev/license)
 * Confiance : official
 *
 * Le connecteur fetch le JSON, parse les providers/models, et les expose
 * via ParsedSource pour ingestion par Registry.
 */

import {
  DEFAULT_FETCH_OPTIONS,
  type FetchOptions,
  type ParsedSource,
  type ParseOptions,
  type SourceConnector,
} from "../source"
import { canonicalParseOptions, hashContent } from "../source"
import { isoUtcNow } from "../schema"

const MODELS_DEV_LICENSE = "MIT"
const MODELS_DEV_COPYRIGHT = "Copyright (c) 2025 models.dev"
const MODELS_DEV_LICENSE_URL = "https://github.com/anomalyco/models.dev/blob/main/LICENSE"
const MODELS_DEV_API_URL = "https://models.dev/api.json"

export const ModelsDevConnector: SourceConnector = {
  id: "catalog:models.dev:api.json",
  type: "catalog",
  licenseCode: MODELS_DEV_LICENSE,
  copyrightNotice: MODELS_DEV_COPYRIGHT,
  licenseFileURL: MODELS_DEV_LICENSE_URL,
  confidenceLevel: "official",

  async fetch(fetchOpts: FetchOptions = {}): Promise<string> {
    const opts = { ...DEFAULT_FETCH_OPTIONS, ...fetchOpts }
    let lastError: Error | undefined
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const controller = new AbortController()
        const timer = setTimeout(() => controller.abort(), opts.timeoutMs)
        const response = await fetch(MODELS_DEV_API_URL, {
          headers: { "User-Agent": opts.userAgent },
          signal: opts.signal ?? controller.signal,
        })
        clearTimeout(timer)
        if (response.status === 429) {
          await sleep(backoffMs(attempt))
          continue
        }
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`)
        }
        return await response.text()
      } catch (e) {
        lastError = e as Error
        if (attempt < 3) await sleep(backoffMs(attempt))
      }
    }
    throw lastError ?? new Error("models.dev fetch failed after 3 attempts")
  },

  parse(raw: string, opts: ParseOptions): ParsedSource {
    let json: Record<string, unknown>
    try {
      json = JSON.parse(raw)
    } catch (e) {
      throw new Error(`SourceParseError: invalid JSON: ${(e as Error).message}`)
    }

    const providers: unknown[] = []
    const models: unknown[] = []

    for (const [providerID, providerData] of Object.entries(json)) {
      const provider = providerData as Record<string, unknown>
      const providerName = (provider.name as string) ?? providerID
      const envVars = Array.isArray(provider.env) ? (provider.env as string[]) : []
      const npm = (provider.npm as string | undefined) ?? null
      const api = (provider.api as string | undefined) ?? null

      providers.push({
        id: providerID,
        name: providerName,
        sdk: npm,
        api: api ? { baseURL: api } : null,
        envVars,
        capabilities: {
          tools: true,
          structuredOutput: true,
          streaming: true,
          visionInput: false,
          audioIO: false,
          videoIO: false,
          pdfInput: false,
          functionCallingStrict: false,
          systemPrompts: true,
        },
        modalitiesSupported: {
          input: ["text"],
          output: ["text"],
        },
        status: "active",
        deprecationReason: null,
        addedAtUTC: opts.sourceVersion,
        removedAtUTC: null,
        docsURL: null,
        privacyPolicyRef: null,
        regionPolicy: {
          allowedRegions: [],
          dataResidencyRequired: false,
        },
        aliases: [],
      })

      const modelsRecord = (provider.models as Record<string, unknown>) ?? {}
      for (const [modelID, modelData] of Object.entries(modelsRecord)) {
        const m = modelData as Record<string, unknown>
        models.push(convertModel(providerID, providerName, modelID, m, opts))
      }
    }

    return {
      providers,
      models,
      aliases: [],
      metadata: {
        sourceID: "catalog:models.dev:api.json",
        sourceVersion: opts.sourceVersion,
        fetchedAtUTC: opts.sourceVersion,
        rawHash: opts.rawHash,
        parserVersion: opts.parserVersion,
      },
    }
  },
}

function convertModel(
  providerID: string,
  providerName: string,
  modelID: string,
  m: Record<string, unknown>,
  opts: ParseOptions,
): unknown {
  const cost = (m.cost as Record<string, unknown>) ?? {}
  const limit = (m.limit as Record<string, unknown>) ?? {}
  const modalities = (m.modalities as Record<string, unknown>) ?? {}

  return {
    id: modelID,
    providerID,
    canonicalName: (m.name as string) ?? modelID,
    family: (m.family as string) ?? null,
    aliases: [],
    capabilities: {
      structuredOutput: true,
      toolCalls: Boolean(m.tool_call),
      parallelToolCalls: false,
      visionInput: Boolean(m.attachment),
      audioInput: false,
      videoInput: false,
      pdfInput: false,
      reasoning: Boolean(m.reasoning),
      caching: false,
      promptCaching: false,
      systemMessages: true,
    },
    modalities: {
      input: normalizeModalities(modalities.input),
      output: normalizeModalities(modalities.output),
    },
    contextWindow: {
      totalTokens: Number(limit.context ?? 0),
      inputTokens: typeof limit.input === "number" ? Number(limit.input) : null,
      outputTokens: Number(limit.output ?? 0),
    },
    reasoning: {
      supports: Boolean(m.reasoning),
      interleavedField: typeof m.interleaved === "object" && m.interleaved
        ? (((m.interleaved as Record<string, unknown>).field as string) ?? null)
        : null,
    },
    toolUse: {
      supports: Boolean(m.tool_call),
      parallelCalls: false,
    },
    temperature: {
      supports: Boolean(m.temperature),
      range: null,
    },
    status: normalizeStatus(m.status as string | undefined),
    deprecationReason: null,
    lifecycleStage: "metadata_validated",
    releaseDateUTC: typeof m.release_date === "string" ? m.release_date : null,
    retirementDateUTC: null,
    pricing: {
      currency: "USD",
      unit: "per_1m_tokens",
      input: Number(cost.input ?? 0),
      output: Number(cost.output ?? 0),
      cacheRead: typeof cost.cache_read === "number" ? Number(cost.cache_read) : null,
      cacheWrite: typeof cost.cache_write === "number" ? Number(cost.cache_write) : null,
      reasoning: null,
      tiers: null,
    },
    sourceRefs: [
      {
        sourceID: "catalog:models.dev:api.json",
        observedAtUTC: opts.sourceVersion,
        sourceVersion: opts.sourceVersion,
        fieldHashes: {
          id: hashContent(modelID),
          name: hashContent(String((m.name as string) ?? modelID)),
        },
      },
    ],
    health: {
      lastHealthCheckUTC: isoUtcNow(),
      availabilityScore: 0.95,
      latencyP50Ms: null,
      latencyP95Ms: null,
      errorRate1h: 0,
      rateLimit: null,
      notes: null,
    },
    provenance: {
      sourceID: "catalog:models.dev:api.json",
      sourceVersion: opts.sourceVersion,
      sourceURL: MODELS_DEV_API_URL,
      fetchedAtUTC: opts.sourceVersion,
      rawHash: opts.rawHash,
      parserVersion: opts.parserVersion,
      transformHash: hashContent(`${providerID}:${modelID}:${providerName}`),
      signatureRef: null,
    },
    lastSeenAtUTC: opts.sourceVersion,
  }
}

function normalizeModalities(value: unknown): string[] {
  if (!Array.isArray(value)) return ["text"]
  const valid = ["text", "audio", "image", "video", "pdf"]
  return value.filter((v): v is string => typeof v === "string" && valid.includes(v))
}

function normalizeStatus(s: string | undefined): string {
  if (s === "alpha" || s === "beta" || s === "deprecated") return s
  return "active"
}

function backoffMs(attempt: number): number {
  return Math.min(1000 * 2 ** attempt, 8000) + Math.random() * 250
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export function buildModelsDevConnector(overrides?: Partial<FetchOptions>): SourceConnector {
  if (!overrides) return ModelsDevConnector
  return {
    ...ModelsDevConnector,
    fetch: (opts?: FetchOptions) =>
      ModelsDevConnector.fetch({ ...overrides, ...opts }),
  }
}

export { canonicalParseOptions }