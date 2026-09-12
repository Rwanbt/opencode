/**
 * Registry — namespace principal du model-intelligence.
 *
 * API publique stable consommée par B01 (substrat multi-model),
 * consumer/provider-discovery, budget-tracker, etc.
 *
 * Opérations synchrones sur le registry chargé en mémoire ;
 * les opérations async (sync, fetch) passent par ingest + storage.
 */

import { Effect, Layer, ServiceMap } from "effect"
import type { Registry as RegistrySchema, Model, Provider as ProviderT, Alias, Source, HealthSnapshot } from "./schema"
import { isValidSchemaVersion } from "./schema"
import { SCHEMA_VERSION, GENERATOR_VERSION } from "./schema-version"
import { StorageManager, MemoryStorage, type StorageBackend } from "./storage"
import { ingest, buildRegistry, type IngestResult } from "./ingestion"
import { ModelsDevConnector, buildModelsDevConnector } from "./connectors/modelsdev"
import { canonicalParseOptions } from "./source"
import { buildAliasIndex, resolveAlias, type ResolvedAlias } from "./aliases"
import { generate as generateNotices } from "./license"
import { hashSnapshot, loadSnapshot, loadSnapshotWithHash, serialize } from "./snapshot"
import { defaultBus } from "./events"
import {
  SourceFetchError,
  SourceParseError,
  SourceValidationError,
  SourceLicenseMismatch,
  OfflineFallbackError,
  RegistryNotInitializedError,
} from "./errors"
import { isoUtcNow } from "./schema"

export interface ModelFilter {
  providerID?: string
  status?: Model["status"]
  capabilities?: Partial<Model["capabilities"]>
  lifecycleStage?: Model["lifecycleStage"]
  modality?: "text" | "audio" | "image" | "video" | "pdf"
}

export interface ProviderFilter {
  status?: ProviderT["status"]
}

export interface SyncOptions {
  force?: boolean
  staging?: boolean
  validate?: boolean
}

export interface SyncResult {
  sourceID: string
  durationMs: number
  providersCount: number
  modelsCount: number
  skippedCount: number
}

export interface RegistryInterface {
  readonly get: () => Effect.Effect<RegistrySchema, InstanceType<typeof RegistryNotInitializedError>>
  readonly getModel: (providerID: string, modelID: string) => Effect.Effect<Model | null, InstanceType<typeof RegistryNotInitializedError>>
  readonly getProvider: (providerID: string) => Effect.Effect<ProviderT | null, InstanceType<typeof RegistryNotInitializedError>>
  readonly listModels: (filter?: ModelFilter) => Effect.Effect<Model[], InstanceType<typeof RegistryNotInitializedError>>
  readonly listProviders: (filter?: ProviderFilter) => Effect.Effect<ProviderT[], InstanceType<typeof RegistryNotInitializedError>>
  readonly resolveAlias: (alias: string) => Effect.Effect<ResolvedAlias | null, InstanceType<typeof RegistryNotInitializedError>>
  readonly sync: (opts?: SyncOptions) => Effect.Effect<SyncResult, InstanceType<typeof SourceFetchError> | InstanceType<typeof SourceParseError> | InstanceType<typeof SourceValidationError>>
  readonly snapshot: () => Effect.Effect<{ json: string; hash: string }, InstanceType<typeof RegistryNotInitializedError>>
  readonly licenseNotices: () => Effect.Effect<string, InstanceType<typeof RegistryNotInitializedError>>
  readonly isLoaded: () => Effect.Effect<boolean>
}

export class Registry extends ServiceMap.Service<Registry, RegistryInterface>()(
  "@opencode/model-intelligence/Registry",
) {}

export function makeLiveRegistryLayer(storage: StorageBackend) {
  return Layer.effect(
    Registry,
    Effect.gen(function* () {
      const manager = new StorageManager(storage)
      yield* Effect.promise(() => manager.init())

      const aliasIndex = (registry: RegistrySchema) => buildAliasIndex(registry.aliases)

      const interfaceImpl: RegistryInterface = {
        get: () =>
          Effect.gen(function* () {
            if (!manager.isLoaded()) {
              return yield* Effect.fail(
                new RegistryNotInitializedError({
                  dbPath: manager.path(),
                  message: "Registry storage not loaded",
                }),
              )
            }
            return yield* Effect.promise(() => manager.get())
          }),

        getModel: (providerID, modelID) =>
          Effect.gen(function* () {
            const reg = yield* interfaceImpl.get()
            return reg.models.find((m) => m.providerID === providerID && m.id === modelID) ?? null
          }),

        getProvider: (providerID) =>
          Effect.gen(function* () {
            const reg = yield* interfaceImpl.get()
            return reg.providers.find((p) => p.id === providerID) ?? null
          }),

        listModels: (filter) =>
          Effect.gen(function* () {
            const reg = yield* interfaceImpl.get()
            let models = reg.models
            if (filter?.providerID) {
              models = models.filter((m) => m.providerID === filter.providerID)
            }
            if (filter?.status) {
              models = models.filter((m) => m.status === filter.status)
            }
            if (filter?.lifecycleStage) {
              models = models.filter((m) => m.lifecycleStage === filter.lifecycleStage)
            }
            if (filter?.capabilities) {
              models = models.filter((m) => {
                for (const [k, v] of Object.entries(filter.capabilities!)) {
                  if (m.capabilities[k as keyof typeof m.capabilities] !== v) return false
                }
                return true
              })
            }
            if (filter?.modality) {
              models = models.filter(
                (m) =>
                  m.modalities.input.includes(filter.modality!) ||
                  m.modalities.output.includes(filter.modality!),
              )
            }
            return models
          }),

        listProviders: (filter) =>
          Effect.gen(function* () {
            const reg = yield* interfaceImpl.get()
            let providers = reg.providers
            if (filter?.status) {
              providers = providers.filter((p) => p.status === filter.status)
            }
            return providers
          }),

        resolveAlias: (alias) =>
          Effect.gen(function* () {
            const reg = yield* interfaceImpl.get()
            return resolveAlias(alias, aliasIndex(reg))
          }),

        sync: (_opts) =>
          Effect.gen(function* () {
            const start = Date.now()
            yield* Effect.promise(() =>
              defaultBus.publish({
                type: "model-intelligence.sync.started",
                sourceID: ModelsDevConnector.id,
                atUTC: isoUtcNow(),
              }),
            )

            try {
              const raw = yield* Effect.promise(() => ModelsDevConnector.fetch())
              const parseOpts = canonicalParseOptions(ModelsDevConnector.id, "1.0.0", raw)
              const parsed = ModelsDevConnector.parse(raw, parseOpts)
              const ingested: IngestResult = ingest(parsed)
              const registry = buildRegistry(ingested)
              yield* Effect.promise(() => manager.set(registry))

              const durationMs = Date.now() - start
              yield* Effect.promise(() =>
                defaultBus.publish({
                  type: "model-intelligence.sync.completed",
                  sourceID: ModelsDevConnector.id,
                  durationMs,
                  atUTC: isoUtcNow(),
                }),
              )

              return {
                sourceID: ModelsDevConnector.id,
                durationMs,
                providersCount: ingested.providers.length,
                modelsCount: ingested.models.length,
                skippedCount: ingested.skipped.length,
              }
            } catch (e) {
              const errorMsg = e instanceof Error ? e.message : String(e)
              yield* Effect.promise(() =>
                defaultBus.publish({
                  type: "model-intelligence.sync.failed",
                  sourceID: ModelsDevConnector.id,
                  error: errorMsg,
                  atUTC: isoUtcNow(),
                }),
              )
              throw e
            }
          }),

        snapshot: () =>
          Effect.gen(function* () {
            const reg = yield* interfaceImpl.get()
            const snap = serialize(reg, GENERATOR_VERSION)
            const json = JSON.stringify(snap, null, 2)
            const hash = hashSnapshot(snap)
            return { json, hash }
          }),

        licenseNotices: () =>
          Effect.gen(function* () {
            const reg = yield* interfaceImpl.get()
            return generateNotices(reg)
          }),

        isLoaded: () => Effect.succeed(manager.isLoaded()),
      }

      return interfaceImpl
    }),
  )
}

export const defaultStorage: StorageBackend = new MemoryStorage("default")
export const LiveRegistryLayer = makeLiveRegistryLayer(defaultStorage)

export {
  type Model,
  type ProviderT as Provider,
  type Alias,
  type Source,
  type HealthSnapshot,
  type RegistrySchema,
  isValidSchemaVersion,
  SCHEMA_VERSION,
  GENERATOR_VERSION,
  SourceFetchError,
  SourceParseError,
  SourceValidationError,
  SourceLicenseMismatch,
  OfflineFallbackError,
  RegistryNotInitializedError,
  loadSnapshot,
  loadSnapshotWithHash,
  ModelsDevConnector,
  buildModelsDevConnector,
}

export const _internal = {
  isoUtcNow,
}