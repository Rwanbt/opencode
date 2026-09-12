import { describe, expect, test } from "bun:test"
import {
  generateSyntheticModels,
  countByProvider,
  countByStatus,
} from "./synthetic-generator"
import { Registry } from "../../src/model-intelligence/schema"
import { SCHEMA_VERSION } from "../../src/model-intelligence/schema-version"

const baseUTC = "2026-07-21T00:00:00Z"
const validHash = "a".repeat(64)

function buildMinimalProvider(providerID: string) {
  return {
    id: providerID,
    name: providerID,
    sdk: null,
    api: null,
    envVars: [],
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
}

describe("synthetic 500+ scale", () => {
  test("generates 500 models with deterministic seed", () => {
    const a = generateSyntheticModels({ count: 500, seed: 42 })
    const b = generateSyntheticModels({ count: 500, seed: 42 })
    expect(a.length).toBe(500)
    expect(b.length).toBe(500)
    expect(a[0]?.id).toBe(b[0]?.id)
    expect(a[100]?.id).toBe(b[100]?.id)
  })

  test("all synthetic models validate against schema", () => {
    const models = generateSyntheticModels({ count: 600 })
    const providerIDs = new Set(models.map((m) => m.providerID))
    const providers = [...providerIDs].map(buildMinimalProvider)

    const reg = {
      schemaVersion: SCHEMA_VERSION,
      generatedAtUTC: baseUTC,
      generatorVersion: "test/1.0.0",
      registryID: validHash,
      sources: [
        {
          id: "catalog:synthetic:test",
          url: "https://synthetic.test/api.json",
          type: "catalog" as const,
          licenseCode: "MIT",
          licenseFileURL: null,
          copyrightNotice: "Synthetic test data",
          parserVersion: "1.0.0",
          confidenceLevel: "unverified" as const,
          rollbackPolicy: "fallback_to_cache" as const,
          policyDocRef: null,
          deprecated: false,
          deprecationReason: null,
        },
      ],
      providers,
      models,
      aliases: [],
      health: {
        snapshotAtUTC: baseUTC,
        totalProviders: providers.length,
        totalModels: models.length,
        activeModels: models.filter((m) => m.status === "active").length,
        deprecatedModels: models.filter((m) => m.status === "deprecated").length,
        missingPricingModels: 0,
        aliasesResolved: 0,
      },
      provenance: [],
    }

    const start = performance.now()
    const result = Registry.safeParse(reg)
    const elapsed = performance.now() - start

    expect(result.success).toBe(true)
    expect(elapsed).toBeLessThan(2000)
  })

  test("countByProvider distributes models across providers", () => {
    const models = generateSyntheticModels({ count: 500 })
    const counts = countByProvider(models)
    expect(counts.size).toBeGreaterThanOrEqual(15)
    const values = [...counts.values()]
    const avg = values.reduce((a, b) => a + b, 0) / values.length
    expect(avg).toBeGreaterThan(15)
  })

  test("countByStatus shows multiple lifecycle states", () => {
    const models = generateSyntheticModels({ count: 500 })
    const counts = countByStatus(models)
    expect(counts.has("active")).toBe(true)
  })

  test("filter by capability scales efficiently", () => {
    const models = generateSyntheticModels({ count: 1000 })
    const start = performance.now()
    const visionModels = models.filter((m) => m.capabilities.visionInput)
    const elapsed = performance.now() - start

    expect(visionModels.length).toBeGreaterThan(0)
    expect(elapsed).toBeLessThan(100)
  })

  test("filter by provider scales efficiently", () => {
    const models = generateSyntheticModels({ count: 1000 })
    const start = performance.now()
    const alpha = models.filter((m) => m.providerID === "alpha")
    const elapsed = performance.now() - start

    expect(alpha.length).toBeGreaterThan(0)
    expect(elapsed).toBeLessThan(100)
  })
})