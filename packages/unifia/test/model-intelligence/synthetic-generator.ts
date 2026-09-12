/**
 * Générateur de modèles synthétiques pour TST-09 (500+ scale test).
 * Programme pur — pas d'I/O.
 */

import type { Model } from "../../src/model-intelligence/schema"

const PROVIDERS = [
  "alpha", "beta", "gamma", "delta", "epsilon", "zeta", "eta", "theta",
  "iota", "kappa", "lambda", "mu", "nu", "xi", "omicron", "pi",
  "rho", "sigma", "tau", "upsilon",
] as const

const FAMILIES = ["small", "medium", "large", "xlarge", "reasoning", "vision", "audio"] as const

const STATUSES = ["alpha", "beta", "active", "deprecated", "quarantined"] as const

const CURRENCIES = ["USD", "EUR", "GBP", "JPY"] as const

const baseUTC = "2026-07-21T00:00:00Z"
const validHash = "a".repeat(64)

export interface GenerateOptions {
  count?: number
  providersPerCount?: number
  seed?: number
}

export function generateSyntheticModels(options: GenerateOptions = {}): Model[] {
  const count = options.count ?? 500
  const seed = options.seed ?? 42
  const models: Model[] = []

  let rng = seed
  const next = () => {
    rng = (rng * 1103515245 + 12345) & 0x7fffffff
    return rng / 0x7fffffff
  }

  for (let i = 0; i < count; i++) {
    const providerID = PROVIDERS[i % PROVIDERS.length]!
    const family = FAMILIES[Math.floor(next() * FAMILIES.length)]!
    const status = STATUSES[Math.floor(next() * STATUSES.length)]!
    const currency = CURRENCIES[Math.floor(next() * CURRENCIES.length)]!

    const contextTotal = Math.floor(next() * 200_000) + 1000
    const outputTokens = Math.min(Math.floor(contextTotal * 0.1), 8192)
    const inputPrice = Math.round(next() * 30 * 100) / 100
    const outputPrice = Math.round(inputPrice * (2 + next() * 3) * 100) / 100

    const id = `${family}-model-${i}-${(i * 31).toString(36)}`
    const canonicalName = `${family}-${providerID}-${i}`

    models.push({
      id,
      providerID,
      canonicalName,
      family,
      aliases: [],
      capabilities: {
        structuredOutput: next() > 0.3,
        toolCalls: next() > 0.2,
        parallelToolCalls: next() > 0.5,
        visionInput: next() > 0.7,
        audioInput: next() > 0.85,
        videoInput: next() > 0.9,
        pdfInput: next() > 0.7,
        reasoning: next() > 0.5,
        caching: next() > 0.4,
        promptCaching: next() > 0.5,
        systemMessages: true,
      },
      modalities: {
        input: ["text"],
        output: ["text"],
      },
      contextWindow: {
        totalTokens: contextTotal,
        inputTokens: null,
        outputTokens,
      },
      reasoning: {
        supports: next() > 0.5,
        interleavedField: next() > 0.5 ? "reasoning_content" : null,
      },
      toolUse: {
        supports: next() > 0.3,
        parallelCalls: next() > 0.5,
      },
      temperature: {
        supports: next() > 0.2,
        range: null,
      },
      status,
      deprecationReason: status === "deprecated" ? "Replaced by newer version" : null,
      lifecycleStage:
        status === "active"
          ? "trusted_by_domain"
          : status === "beta"
            ? "general_eligible"
            : status === "alpha"
              ? "metadata_validated"
              : status === "deprecated"
                ? "deprecated"
                : "quarantined",
      releaseDateUTC: baseUTC,
      retirementDateUTC: status === "deprecated" ? baseUTC : null,
      pricing: {
        currency,
        unit: "per_1m_tokens",
        input: inputPrice,
        output: outputPrice,
        cacheRead: next() > 0.5 ? Math.round(inputPrice * 0.1 * 100) / 100 : null,
        cacheWrite: next() > 0.5 ? Math.round(inputPrice * 1.25 * 100) / 100 : null,
        reasoning: null,
        tiers: null,
      },
      sourceRefs: [
        {
          sourceID: "catalog:synthetic:test",
          observedAtUTC: baseUTC,
          sourceVersion: baseUTC,
          fieldHashes: { id: validHash },
        },
      ],
      health: {
        lastHealthCheckUTC: baseUTC,
        availabilityScore: next(),
        latencyP50Ms: Math.floor(next() * 1000),
        latencyP95Ms: Math.floor(next() * 3000) + 1000,
        errorRate1h: next() * 0.1,
        rateLimit: null,
        notes: null,
      },
      provenance: {
        sourceID: "catalog:synthetic:test",
        sourceVersion: baseUTC,
        sourceURL: "https://synthetic.test/api.json",
        fetchedAtUTC: baseUTC,
        rawHash: validHash,
        parserVersion: "1.0.0",
        transformHash: validHash,
        signatureRef: null,
      },
      lastSeenAtUTC: baseUTC,
    })
  }

  return models
}

export function countByProvider(models: Model[]): Map<string, number> {
  const map = new Map<string, number>()
  for (const m of models) {
    map.set(m.providerID, (map.get(m.providerID) ?? 0) + 1)
  }
  return map
}

export function countByStatus(models: Model[]): Map<string, number> {
  const map = new Map<string, number>()
  for (const m of models) {
    map.set(m.status, (map.get(m.status) ?? 0) + 1)
  }
  return map
}