/**
 * Ingestion pipeline : parse → validate → dedup → record.
 *
 * Étapes (cf. plan §6.4 transactionnel staging → validate → diff → commit → event) :
 *   1. fetch depuis SourceConnector
 *   2. parse pour obtenir ParsedSource
 *   3. validate chaque provider/model contre le schéma Zod
 *   4. dedup par (providerID, modelID)
 *   5. construire Registry hydraté
 */

import type { Source } from "./schema"
import { Provider, Model, Alias, Registry, type HealthSnapshot, type ProvenanceRecord, isoUtcNow } from "./schema"
import { SCHEMA_VERSION, GENERATOR_VERSION } from "./schema-version"
import { SourceValidationError } from "./errors"
import { hashContent } from "./source"

export interface IngestOptions {
  sourceID: string
  sourceVersion: string
  parserVersion: string
  rawHash: string
}

export interface IngestResult {
  providers: Provider[]
  models: Model[]
  aliases: Alias[]
  sources: Source[]
  provenances: ProvenanceRecord[]
  health: HealthSnapshot
  skipped: Array<{ kind: "provider" | "model" | "alias"; id: string; reason: string }>
}

export function ingest(parsed: {
  providers: unknown[]
  models: unknown[]
  aliases: unknown[]
  metadata: {
    sourceID: string
    sourceVersion: string
    fetchedAtUTC: string
    rawHash: string
    parserVersion: string
  }
}): IngestResult {
  const providers: Provider[] = []
  const models: Model[] = []
  const aliases: Alias[] = []
  const skipped: IngestResult["skipped"] = []

  for (const raw of parsed.providers) {
    const result = Provider.safeParse(raw)
    if (!result.success) {
      skipped.push({
        kind: "provider",
        id: (raw as Record<string, unknown>).id as string,
        reason: result.error.issues[0]?.message ?? "unknown validation error",
      })
      continue
    }
    providers.push(result.data)
  }

  for (const raw of parsed.models) {
    const result = Model.safeParse(raw)
    if (!result.success) {
      skipped.push({
        kind: "model",
        id: `${(raw as Record<string, unknown>).providerID}/${(raw as Record<string, unknown>).id}`,
        reason: result.error.issues[0]?.message ?? "unknown validation error",
      })
      continue
    }
    models.push(result.data)
  }

  for (const raw of parsed.aliases) {
    const result = Alias.safeParse(raw)
    if (!result.success) {
      skipped.push({
        kind: "alias",
        id: (raw as Record<string, unknown>).alias as string,
        reason: result.error.issues[0]?.message ?? "unknown validation error",
      })
      continue
    }
    aliases.push(result.data)
  }

  const sources: Source[] = [
    {
      id: parsed.metadata.sourceID,
      url: "",
      type: "catalog",
      licenseCode: "MIT",
      licenseFileURL: "https://github.com/anomalyco/models.dev/blob/main/LICENSE",
      copyrightNotice: "Copyright (c) 2025 models.dev",
      parserVersion: parsed.metadata.parserVersion,
      confidenceLevel: "official",
      rollbackPolicy: "fallback_to_cache",
      policyDocRef: null,
      deprecated: false,
      deprecationReason: null,
    },
  ]

  const provenances: ProvenanceRecord[] = [
    {
      sourceID: parsed.metadata.sourceID,
      sourceVersion: parsed.metadata.sourceVersion,
      sourceURL: "https://models.dev/api.json",
      fetchedAtUTC: parsed.metadata.fetchedAtUTC,
      rawHash: parsed.metadata.rawHash,
      parserVersion: parsed.metadata.parserVersion,
      transformHash: hashContent(JSON.stringify(parsed.providers) + JSON.stringify(parsed.models)),
      signatureRef: null,
    },
  ]

  const activeModels = models.filter((m) => m.status === "active").length
  const deprecatedModels = models.filter((m) => m.status === "deprecated").length
  const missingPricingModels = models.filter(
    (m) => m.pricing.input === 0 && m.pricing.output === 0,
  ).length

  const health: HealthSnapshot = {
    snapshotAtUTC: isoUtcNow(),
    totalProviders: providers.length,
    totalModels: models.length,
    activeModels,
    deprecatedModels,
    missingPricingModels,
    aliasesResolved: aliases.filter((a) => !a.deprecated).length,
  }

  return {
    providers,
    models,
    aliases,
    sources,
    provenances,
    health,
    skipped,
  }
}

export function buildRegistry(
  result: IngestResult,
  generatorVersion: string = GENERATOR_VERSION,
): Registry {
  const registry: Registry = {
    schemaVersion: SCHEMA_VERSION,
    generatedAtUTC: isoUtcNow(),
    generatorVersion,
    registryID: hashContent(JSON.stringify({ p: result.providers.length, m: result.models.length })),
    sources: result.sources,
    providers: result.providers,
    models: result.models,
    aliases: result.aliases,
    health: result.health,
    provenance: result.provenances,
  }
  return Registry.parse(registry)
}

export function dedupByID<T extends { id: string }>(items: T[]): T[] {
  const seen = new Map<string, T>()
  for (const item of items) {
    if (!seen.has(item.id)) seen.set(item.id, item)
  }
  return [...seen.values()]
}

export { SourceValidationError }