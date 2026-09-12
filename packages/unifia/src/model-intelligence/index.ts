/**
 * Barrel export pour model-intelligence.
 *
 * API publique consommée par B01 (substrat multi-model), consumers
 * existants (provider-discovery, budget-tracker), et outils tiers.
 */

export * from "./schema"
export * from "./schema-version"
export * from "./errors"
export * from "./source"
export * from "./ingestion"
export * from "./snapshot"
export * from "./storage"
export * from "./aliases"
export * from "./license"
export * from "./health"
export * from "./events"
export {
  Registry,
  LiveRegistryLayer,
  makeLiveRegistryLayer,
  defaultStorage,
  type ModelFilter,
  type ProviderFilter,
  type SyncOptions,
  type SyncResult,
  type RegistryInterface,
} from "./registry"

export { ModelsDevConnector, buildModelsDevConnector } from "./connectors/modelsdev"