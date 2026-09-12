import { describe, expect, test } from "bun:test"
import {
  Registry,
  Model,
  Provider,
  Source,
  Alias,
  isoUtcNow,
  isValidSchemaVersion,
} from "../../src/model-intelligence/schema"
import { SCHEMA_VERSION } from "../../src/model-intelligence/schema-version"

describe("schema validation", () => {
  const baseUTC = "2026-07-21T00:00:00Z"
  const validHash = "a".repeat(64)

  const minimalProvider = {
    id: "test-provider",
    name: "Test Provider",
    sdk: "@test/sdk",
    api: { baseURL: "https://api.test.example.com" },
    envVars: ["TEST_API_KEY"],
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
    status: "active",
    deprecationReason: null,
    addedAtUTC: baseUTC,
    removedAtUTC: null,
    docsURL: null,
    privacyPolicyRef: null,
    regionPolicy: { allowedRegions: [], dataResidencyRequired: false },
    aliases: [],
  }

  const minimalModel = {
    id: "test-model",
    providerID: "test-provider",
    canonicalName: "Test Model",
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
    status: "active",
    deprecationReason: null,
    lifecycleStage: "metadata_validated",
    releaseDateUTC: null,
    retirementDateUTC: null,
    pricing: {
      currency: "USD",
      unit: "per_1m_tokens",
      input: 3,
      output: 15,
      cacheRead: null,
      cacheWrite: null,
      reasoning: null,
      tiers: null,
    },
    sourceRefs: [
      {
        sourceID: "catalog:test:fixture",
        observedAtUTC: baseUTC,
        sourceVersion: baseUTC,
        fieldHashes: { id: validHash },
      },
    ],
    health: {
      lastHealthCheckUTC: baseUTC,
      availabilityScore: 1,
      latencyP50Ms: null,
      latencyP95Ms: null,
      errorRate1h: 0,
      rateLimit: null,
      notes: null,
    },
    provenance: {
      sourceID: "catalog:test:fixture",
      sourceVersion: baseUTC,
      sourceURL: "https://test.example.com/api.json",
      fetchedAtUTC: baseUTC,
      rawHash: validHash,
      parserVersion: "1.0.0",
      transformHash: validHash,
      signatureRef: null,
    },
    lastSeenAtUTC: baseUTC,
  }

  const minimalSource = {
    id: "catalog:test:fixture",
    url: "https://test.example.com/api.json",
    type: "catalog" as const,
    licenseCode: "MIT",
    licenseFileURL: "https://test.example.com/LICENSE",
    copyrightNotice: "Copyright (c) 2025 Test",
    parserVersion: "1.0.0",
    confidenceLevel: "official" as const,
    rollbackPolicy: "fallback_to_cache" as const,
    policyDocRef: null,
    deprecated: false,
    deprecationReason: null,
  }

  const minimalAlias = {
    alias: "test-model",
    canonicalRef: { providerID: "test-provider", modelID: "test-model" },
    deprecated: false,
    replacedBy: null,
  }

  const minimalRegistry = {
    schemaVersion: SCHEMA_VERSION,
    generatedAtUTC: baseUTC,
    generatorVersion: "test/1.0.0",
    registryID: validHash,
    sources: [minimalSource],
    providers: [minimalProvider],
    models: [minimalModel],
    aliases: [minimalAlias],
    health: {
      snapshotAtUTC: baseUTC,
      totalProviders: 1,
      totalModels: 1,
      activeModels: 1,
      deprecatedModels: 0,
      missingPricingModels: 0,
      aliasesResolved: 1,
    },
    provenance: [minimalModel.provenance],
  }

  test("valid registry passes", () => {
    const result = Registry.safeParse(minimalRegistry)
    expect(result.success).toBe(true)
  })

  test("invalid currency rejected (lowercase)", () => {
    const invalid = {
      ...minimalRegistry,
      providers: [],
      models: [
        {
          ...minimalModel,
          pricing: { ...minimalModel.pricing, currency: "usd" },
        },
      ],
    }
    const result = Registry.safeParse(invalid)
    expect(result.success).toBe(false)
  })

  test("invalid currency rejected (non-ISO code)", () => {
    const invalid = {
      ...minimalRegistry,
      providers: [],
      models: [
        {
          ...minimalModel,
          pricing: { ...minimalModel.pricing, currency: "EU" },
        },
      ],
    }
    const result = Registry.safeParse(invalid)
    expect(result.success).toBe(false)
  })

  test("invalid rawHash rejected (not 64 hex chars)", () => {
    const invalid = {
      ...minimalRegistry,
      models: [
        {
          ...minimalModel,
          provenance: { ...minimalModel.provenance, rawHash: "not-hex" },
        },
      ],
    }
    const result = Registry.safeParse(invalid)
    expect(result.success).toBe(false)
  })

  test("modalities with unknown value rejected", () => {
    const invalid = {
      ...minimalRegistry,
      providers: [],
      models: [
        {
          ...minimalModel,
          modalities: { input: ["text", "unknown"], output: ["text"] },
        },
      ],
    }
    const result = Registry.safeParse(invalid)
    expect(result.success).toBe(false)
  })

  test("empty modalities input rejected", () => {
    const invalid = {
      ...minimalRegistry,
      providers: [],
      models: [
        {
          ...minimalModel,
          modalities: { input: [], output: ["text"] },
        },
      ],
    }
    const result = Registry.safeParse(invalid)
    expect(result.success).toBe(false)
  })

  test("negative pricing input rejected", () => {
    const invalid = {
      ...minimalRegistry,
      providers: [],
      models: [
        {
          ...minimalModel,
          pricing: { ...minimalModel.pricing, input: -1 },
        },
      ],
    }
    const result = Registry.safeParse(invalid)
    expect(result.success).toBe(false)
  })

  test("invalid status rejected", () => {
    const invalid = {
      ...minimalRegistry,
      providers: [],
      models: [{ ...minimalModel, status: "live" }],
    }
    const result = Registry.safeParse(invalid)
    expect(result.success).toBe(false)
  })

  test("model with no sourceRefs rejected", () => {
    const invalid = {
      ...minimalRegistry,
      providers: [],
      models: [{ ...minimalModel, sourceRefs: [] }],
    }
    const result = Registry.safeParse(invalid)
    expect(result.success).toBe(false)
  })

  test("Provider minimum valid", () => {
    const result = Provider.safeParse(minimalProvider)
    expect(result.success).toBe(true)
  })

  test("Source minimum valid", () => {
    const result = Source.safeParse(minimalSource)
    expect(result.success).toBe(true)
  })

  test("Alias minimum valid", () => {
    const result = Alias.safeParse(minimalAlias)
    expect(result.success).toBe(true)
  })

  test("Model minimum valid", () => {
    const result = Model.safeParse(minimalModel)
    expect(result.success).toBe(true)
  })

  test("isoUtcNow returns ISO 8601 UTC without millis", () => {
    const now = isoUtcNow()
    expect(now).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/)
  })

  test("isValidSchemaVersion accepts semver", () => {
    expect(isValidSchemaVersion("1.0.0")).toBe(true)
    expect(isValidSchemaVersion("1.0.0-draft")).toBe(true)
    expect(isValidSchemaVersion("2.3.4-beta.1")).toBe(true)
  })

  test("isValidSchemaVersion rejects non-semver", () => {
    expect(isValidSchemaVersion("garbage")).toBe(false)
    expect(isValidSchemaVersion("1.0")).toBe(false)
  })
})