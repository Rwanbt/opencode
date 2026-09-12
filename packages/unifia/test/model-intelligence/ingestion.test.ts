import { describe, expect, test } from "bun:test"
import { ingest, buildRegistry, dedupByID } from "../../src/model-intelligence/ingestion"
import { Registry } from "../../src/model-intelligence/schema"
import { SCHEMA_VERSION } from "../../src/model-intelligence/schema-version"
import type { Source } from "../../src/model-intelligence/schema"

const baseUTC = "2026-07-21T00:00:00Z"
const validHash = "a".repeat(64)

describe("ingestion pipeline", () => {
  test("ingests valid providers and models", () => {
    const parsed = {
      providers: [
        {
          id: "test-provider",
          name: "Test Provider",
          sdk: null,
          api: null,
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
        },
      ],
      models: [
        {
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
            sourceURL: "https://test.example.com",
            fetchedAtUTC: baseUTC,
            rawHash: validHash,
            parserVersion: "1.0.0",
            transformHash: validHash,
            signatureRef: null,
          },
          lastSeenAtUTC: baseUTC,
        },
      ],
      aliases: [],
      metadata: {
        sourceID: "catalog:test:fixture",
        sourceVersion: baseUTC,
        fetchedAtUTC: baseUTC,
        rawHash: validHash,
        parserVersion: "1.0.0",
      },
    }

    const result = ingest(parsed)
    expect(result.providers.length).toBe(1)
    expect(result.models.length).toBe(1)
    expect(result.skipped.length).toBe(0)
  })

  test("skips invalid entries", () => {
    const parsed = {
      providers: [
        { id: "invalid", name: "Invalid" },
      ],
      models: [
        {
          id: "bad-model",
          providerID: "x",
          pricing: { currency: "usd" },
        },
      ],
      aliases: [],
      metadata: {
        sourceID: "catalog:test:fixture",
        sourceVersion: baseUTC,
        fetchedAtUTC: baseUTC,
        rawHash: validHash,
        parserVersion: "1.0.0",
      },
    }

    const result = ingest(parsed)
    expect(result.providers.length).toBe(0)
    expect(result.models.length).toBe(0)
    expect(result.skipped.length).toBe(2)
  })

  test("buildRegistry produces a validated Registry", () => {
    const parsed = {
      providers: [],
      models: [],
      aliases: [],
      metadata: {
        sourceID: "catalog:test:fixture",
        sourceVersion: baseUTC,
        fetchedAtUTC: baseUTC,
        rawHash: validHash,
        parserVersion: "1.0.0",
      },
    }
    const ingested = ingest(parsed)
    const reg = buildRegistry(ingested)
    expect(reg.schemaVersion).toBe(SCHEMA_VERSION)
    const revalidation = Registry.safeParse(reg)
    expect(revalidation.success).toBe(true)
  })

  test("dedupByID removes duplicates keeping first occurrence", () => {
    const items = [
      { id: "a", value: 1 },
      { id: "b", value: 2 },
      { id: "a", value: 3 },
    ]
    const deduped = dedupByID(items)
    expect(deduped.length).toBe(2)
    expect(deduped.find((d) => d.id === "a")?.value).toBe(1)
  })
})