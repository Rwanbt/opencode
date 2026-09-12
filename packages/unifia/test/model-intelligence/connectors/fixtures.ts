/**
 * Fixtures déterministes pour les tests de connecteurs C02.
 *
 * Toutes les données sont statiques, sans dépendance réseau, et
 * couvrent les cas nominaux + edge cases (champs inconnus, versions
 * incompatibles, licence non conforme, hash invalide).
 *
 * Aucun fetch runtime — chaque fixture est calculée au load du module
 * (équivalent à un snapshot déterministe).
 */

import { createHash } from "node:crypto"

export const FIXED_FETCHED_AT_UTC = "2026-01-15T10:00:00Z"

export const VALID_HASH_64 = "a".repeat(64)

export const VALID_PROVENANCE = {
  sourceID: "test:fixture:catalog",
  sourceVersion: "1.0.0",
  sourceURL: "https://example.test/api.json",
  parserVersion: "1.0.0",
  rawHash: VALID_HASH_64,
  fetchedAtUTC: FIXED_FETCHED_AT_UTC,
  licenseCode: "MIT",
  copyrightNotice: "Copyright (c) 2025 Test Fixture",
  licenseFileURL: "https://example.test/LICENSE",
  confidenceLevel: "official" as const,
}

export const VALID_PROVIDER = {
  id: "fixture-provider",
  name: "Fixture Provider",
  sdk: "@fixture/sdk",
  api: { baseURL: "https://api.fixture.example.com" },
  envVars: ["FIXTURE_API_KEY"],
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
  modalitiesSupported: { input: ["text"], output: ["text"] },
  status: "active" as const,
  deprecationReason: null,
  addedAtUTC: FIXED_FETCHED_AT_UTC,
  removedAtUTC: null,
  docsURL: null,
  privacyPolicyRef: null,
  regionPolicy: { allowedRegions: [], dataResidencyRequired: false },
  aliases: [],
}

export const VALID_MODEL = {
  id: "fixture-model",
  providerID: "fixture-provider",
  canonicalName: "Fixture Model",
  family: null,
  aliases: [],
  capabilities: {
    structuredOutput: true,
    toolCalls: true,
    parallelToolCalls: false,
    visionInput: false,
    audioInput: false,
    videoInput: false,
    pdfInput: false,
    reasoning: false,
    caching: false,
    promptCaching: false,
    systemMessages: true,
  },
  modalities: { input: ["text"], output: ["text"] },
  contextWindow: { totalTokens: 8000, inputTokens: null, outputTokens: 4000 },
  reasoning: { supports: false, interleavedField: null },
  toolUse: { supports: true, parallelCalls: false },
  temperature: { supports: true, range: null },
  status: "active" as const,
  deprecationReason: null,
  lifecycleStage: "metadata_validated" as const,
  releaseDateUTC: null,
  retirementDateUTC: null,
  pricing: {
    currency: "USD",
    unit: "per_1m_tokens" as const,
    input: 1,
    output: 2,
    cacheRead: null,
    cacheWrite: null,
    reasoning: null,
    tiers: null,
  },
  sourceRefs: [
    {
      sourceID: "test:fixture:catalog",
      observedAtUTC: FIXED_FETCHED_AT_UTC,
      sourceVersion: "1.0.0",
      fieldHashes: { id: VALID_HASH_64 },
    },
  ],
  health: {
    lastHealthCheckUTC: FIXED_FETCHED_AT_UTC,
    availabilityScore: 1,
    latencyP50Ms: null,
    latencyP95Ms: null,
    errorRate1h: 0,
    rateLimit: null,
    notes: null,
  },
  provenance: {
    sourceID: "test:fixture:catalog",
    sourceVersion: "1.0.0",
    sourceURL: "https://example.test/api.json",
    fetchedAtUTC: FIXED_FETCHED_AT_UTC,
    rawHash: VALID_HASH_64,
    parserVersion: "1.0.0",
    transformHash: VALID_HASH_64,
    signatureRef: null,
  },
  lastSeenAtUTC: FIXED_FETCHED_AT_UTC,
}

export const VALID_ALIAS = {
  alias: "fixture",
  canonicalRef: { providerID: "fixture-provider", modelID: "fixture-model" },
  deprecated: false,
  replacedBy: null,
}

/**
 * Computes a SHA-256 hex of an arbitrary string — for tests that
 * need a custom hash.
 */
export function sha256Hex(input: string): string {
  return createHash("sha256").update(input).digest("hex")
}