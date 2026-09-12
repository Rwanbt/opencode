/**
 * Model Intelligence Registry — versioned schema.
 *
 * schemaVersion: 1.0.0-draft
 *
 * Source de vérité unique pour les modèles, providers, sources, aliases,
 * health et provenance. Aucun enum statique central en dehors de ce schéma
 * (cf. doctrine plan §0.2).
 *
 * Compatibilité ascendante :
 *   - schemaVersion N-1 : chargement + migration automatique
 *   - schemaVersion N-2 : UnsupportedSchemaVersionError typé
 *
 * Invariants :
 *   - Aucun import depuis collective/, multi-model/, team/ ici
 *     (linter CI vérifie ; cf. ADR-MULTI-MODEL-SUBSTRATE §3.9 #3).
 *   - Tous les champs obligatoires sont validés par registry.validate().
 *   - provenance.rawHash = SHA-256 hex 64 chars.
 *   - pricing.currency = ISO 4217 (3 lettres uppercase).
 *   - modalities.* = sous-ensemble strict de {text, audio, image, video, pdf}.
 */

import z from "zod"

const ISO_4217 = /^[A-Z]{3}$/
const SHA_256_HEX = /^[a-f0-9]{64}$/
const SEMVER = /^\d+\.\d+\.\d+(?:[-+][a-zA-Z0-9.]+)?$/
const ISO_8601_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/

const Modalities = z.object({
  input: z.array(z.enum(["text", "audio", "image", "video", "pdf"])).min(1),
  output: z.array(z.enum(["text", "audio", "image", "video", "pdf"])).min(1),
})

const ContextWindow = z.object({
  totalTokens: z.number().int().positive(),
  inputTokens: z.number().int().nonnegative().nullable(),
  outputTokens: z.number().int().positive(),
})

const PricingTier = z.object({
  thresholdTokens: z.number().int().positive(),
  input: z.number().nonnegative(),
  output: z.number().nonnegative(),
})

const Pricing = z.object({
  currency: z.string().regex(ISO_4217, "currency must be ISO 4217 (3 uppercase letters)"),
  unit: z.enum(["per_1m_tokens", "per_1k_tokens", "per_request"]),
  input: z.number().nonnegative(),
  output: z.number().nonnegative(),
  cacheRead: z.number().nonnegative().nullable().default(null),
  cacheWrite: z.number().nonnegative().nullable().default(null),
  reasoning: z.number().nonnegative().nullable().default(null),
  tiers: z.array(PricingTier).nullable().default(null),
})

const ModelCapabilities = z.object({
  structuredOutput: z.boolean(),
  toolCalls: z.boolean(),
  parallelToolCalls: z.boolean(),
  visionInput: z.boolean(),
  audioInput: z.boolean(),
  videoInput: z.boolean(),
  pdfInput: z.boolean(),
  reasoning: z.boolean(),
  caching: z.boolean(),
  promptCaching: z.boolean(),
  systemMessages: z.boolean(),
})

export const RateLimit = z.object({
  requestsPerMinute: z.number().nullable(),
  tokensPerMinute: z.number().nullable(),
  resetWindow: z.enum(["per_minute", "per_hour", "per_day"]),
})

const ModelHealth = z.object({
  lastHealthCheckUTC: z.string().regex(ISO_8601_UTC),
  availabilityScore: z.number().min(0).max(1),
  latencyP50Ms: z.number().nullable(),
  latencyP95Ms: z.number().nullable(),
  errorRate1h: z.number().min(0).max(1),
  rateLimit: RateLimit.nullable(),
  notes: z.string().nullable(),
})

const ProvenanceRecord = z.object({
  sourceID: z.string().min(1),
  sourceVersion: z.string().min(1),
  sourceURL: z.string().url(),
  fetchedAtUTC: z.string().regex(ISO_8601_UTC),
  rawHash: z.string().regex(SHA_256_HEX, "rawHash must be SHA-256 hex (64 chars lowercase)"),
  parserVersion: z.string().regex(SEMVER, "parserVersion must be semver"),
  transformHash: z.string().regex(SHA_256_HEX),
  signatureRef: z.string().nullable(),
})

const SourceRef = z.object({
  sourceID: z.string().min(1),
  observedAtUTC: z.string().regex(ISO_8601_UTC),
  sourceVersion: z.string().min(1),
  fieldHashes: z.record(z.string(), z.string().regex(SHA_256_HEX)),
})

const LifecycleStage = z.enum([
  "discovered",
  "metadata_validated",
  "probed",
  "low_risk_eligible",
  "general_eligible",
  "trusted_by_domain",
  "deprecated",
  "quarantined",
])

const ReasoningSupport = z.object({
  supports: z.boolean(),
  interleavedField: z.enum(["reasoning_content", "reasoning_details"]).nullable(),
})

const ToolUseSupport = z.object({
  supports: z.boolean(),
  parallelCalls: z.boolean(),
})

const TemperatureSupport = z.object({
  supports: z.boolean(),
  range: z
    .object({
      min: z.number(),
      max: z.number(),
    })
    .refine((r) => r.min < r.max, "temperature range min < max")
    .nullable(),
})

export const Model = z.object({
  id: z.string().min(1),
  providerID: z.string().min(1),
  canonicalName: z.string().min(1),
  family: z.string().nullable().default(null),
  aliases: z.array(z.string().min(1)).default([]),
  capabilities: ModelCapabilities,
  modalities: Modalities,
  contextWindow: ContextWindow,
  reasoning: ReasoningSupport,
  toolUse: ToolUseSupport,
  temperature: TemperatureSupport,
  status: z.enum(["alpha", "beta", "active", "deprecated", "quarantined"]),
  deprecationReason: z.string().nullable().default(null),
  lifecycleStage: LifecycleStage,
  releaseDateUTC: z.string().regex(ISO_8601_UTC).nullable(),
  retirementDateUTC: z.string().regex(ISO_8601_UTC).nullable(),
  pricing: Pricing,
  sourceRefs: z.array(SourceRef).min(1, "model must have at least one sourceRef"),
  health: ModelHealth,
  provenance: ProvenanceRecord,
  lastSeenAtUTC: z.string().regex(ISO_8601_UTC),
})

const ProviderCapabilities = z.object({
  tools: z.boolean(),
  structuredOutput: z.boolean(),
  streaming: z.boolean(),
  visionInput: z.boolean(),
  audioIO: z.boolean(),
  videoIO: z.boolean(),
  pdfInput: z.boolean(),
  functionCallingStrict: z.boolean(),
  systemPrompts: z.boolean(),
})

const RegionPolicy = z.object({
  allowedRegions: z.array(z.string().length(2)),
  dataResidencyRequired: z.boolean(),
})

export const Provider = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  sdk: z.string().nullable(),
  api: z
    .object({
      baseURL: z.string().url(),
    })
    .nullable(),
  envVars: z.array(z.string().min(1)),
  capabilities: ProviderCapabilities,
  modalitiesSupported: Modalities,
  status: z.enum(["active", "deprecated", "experimental"]),
  deprecationReason: z.string().nullable().default(null),
  addedAtUTC: z.string().regex(ISO_8601_UTC),
  removedAtUTC: z.string().regex(ISO_8601_UTC).nullable(),
  docsURL: z.string().url().nullable(),
  privacyPolicyRef: z.string().nullable(),
  regionPolicy: RegionPolicy,
  aliases: z.array(z.string().min(1)).default([]),
})

export const Source = z.object({
  id: z.string().min(1),
  url: z.string().url().or(z.literal("")),
  type: z.enum(["catalog", "pricing", "benchmarks", "metadata"]),
  licenseCode: z
    .string()
    .nullable()
    .refine(
      (v) => v === null || /^[A-Z0-9-+.]+$/.test(v),
      "licenseCode must be SPDX-like or null",
    ),
  licenseFileURL: z.string().url().nullable(),
  copyrightNotice: z.string().nullable(),
  parserVersion: z.string().regex(SEMVER),
  confidenceLevel: z.enum(["official", "community", "unverified"]),
  rollbackPolicy: z.enum(["disable", "fallback_to_cache", "manual_review"]),
  policyDocRef: z.string().nullable(),
  deprecated: z.boolean(),
  deprecationReason: z.string().nullable(),
})

export const Alias = z.object({
  alias: z.string().min(1),
  canonicalRef: z.object({
    providerID: z.string().min(1),
    modelID: z.string().min(1),
  }),
  deprecated: z.boolean(),
  replacedBy: z
    .object({
      providerID: z.string().min(1),
      modelID: z.string().min(1),
    })
    .nullable(),
})

export const HealthSnapshot = z.object({
  snapshotAtUTC: z.string().regex(ISO_8601_UTC),
  totalProviders: z.number().int().nonnegative(),
  totalModels: z.number().int().nonnegative(),
  activeModels: z.number().int().nonnegative(),
  deprecatedModels: z.number().int().nonnegative(),
  missingPricingModels: z.number().int().nonnegative(),
  aliasesResolved: z.number().int().nonnegative(),
})

export const Registry = z.object({
  schemaVersion: z.string(),
  generatedAtUTC: z.string().regex(ISO_8601_UTC),
  generatorVersion: z.string(),
  registryID: z.string().regex(SHA_256_HEX),
  sources: z.array(Source),
  providers: z.array(Provider),
  models: z.array(Model),
  aliases: z.array(Alias),
  health: HealthSnapshot,
  provenance: z.array(ProvenanceRecord),
})

export type Model = z.infer<typeof Model>
export type Provider = z.infer<typeof Provider>
export type Source = z.infer<typeof Source>
export type Alias = z.infer<typeof Alias>
export type HealthSnapshot = z.infer<typeof HealthSnapshot>
export type Registry = z.infer<typeof Registry>
export type ProvenanceRecord = z.infer<typeof ProvenanceRecord>
export type Pricing = z.infer<typeof Pricing>
export type ContextWindow = z.infer<typeof ContextWindow>
export type Modalities = z.infer<typeof Modalities>
export type ModelCapabilities = z.infer<typeof ModelCapabilities>
export type ModelHealth = z.infer<typeof ModelHealth>
export type SourceRef = z.infer<typeof SourceRef>
export type RateLimit = z.infer<typeof RateLimit>

export function isoUtcNow(): string {
  return new Date().toISOString().replace(/\.\d{3}Z$/, "Z")
}

export function isValidSchemaVersion(v: string): boolean {
  const match = /^(\d+)\.(\d+)\.\d+/.exec(v)
  if (!match) return false
  return SEMVER.test(v)
}