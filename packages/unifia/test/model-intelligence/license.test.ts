import { describe, expect, test } from "bun:test"
import { buildNotices, renderNoticesMarkdown, generate } from "../../src/model-intelligence/license"
import type { Source, Registry as RegistryT } from "../../src/model-intelligence/schema"
import { SCHEMA_VERSION } from "../../src/model-intelligence/schema-version"

const baseUTC = "2026-07-21T00:00:00Z"
const validHash = "a".repeat(64)

const mitSource: Source = {
  id: "catalog:models.dev:api.json",
  url: "https://models.dev/api.json",
  type: "catalog",
  licenseCode: "MIT",
  licenseFileURL: "https://github.com/anomalyco/models.dev/blob/main/LICENSE",
  copyrightNotice: "Copyright (c) 2025 models.dev",
  parserVersion: "1.0.0",
  confidenceLevel: "official",
  rollbackPolicy: "fallback_to_cache",
  policyDocRef: null,
  deprecated: false,
  deprecationReason: null,
}

const apacheSource: Source = {
  ...mitSource,
  id: "catalog:openrouter:api",
  licenseCode: "Apache-2.0",
  copyrightNotice: "Copyright (c) 2024 OpenRouter",
}

const unknownSource: Source = {
  ...mitSource,
  id: "catalog:unknown:api",
  licenseCode: null,
  copyrightNotice: null,
}

describe("license notices", () => {
  test("buildNotices orders by sourceID", () => {
    const notices = buildNotices([apacheSource, mitSource, unknownSource])
    expect(notices.map((n) => n.sourceID)).toEqual([
      "catalog:models.dev:api.json",
      "catalog:openrouter:api",
      "catalog:unknown:api",
    ])
  })

  test("renderNoticesMarkdown groups by license", () => {
    const notices = buildNotices([mitSource, apacheSource, unknownSource])
    const md = renderNoticesMarkdown(notices)
    expect(md).toContain("# THIRD_PARTY_NOTICES")
    expect(md).toContain("## Apache-2.0")
    expect(md).toContain("## MIT")
    expect(md).toContain("## UNKNOWN")
    expect(md).toContain("Copyright (c) 2025 models.dev")
    expect(md).toContain("Copyright (c) 2024 OpenRouter")
  })

  test("renderNoticesMarkdown is deterministic for same input", () => {
    const notices = buildNotices([mitSource, apacheSource])
    const a = renderNoticesMarkdown(notices)
    const b = renderNoticesMarkdown(notices)
    expect(a).toBe(b)
  })

  test("generate() works on a full Registry", () => {
    const reg: RegistryT = {
      schemaVersion: SCHEMA_VERSION,
      generatedAtUTC: baseUTC,
      generatorVersion: "test/1.0.0",
      registryID: validHash,
      sources: [mitSource],
      providers: [],
      models: [],
      aliases: [],
      health: {
        snapshotAtUTC: baseUTC,
        totalProviders: 0,
        totalModels: 0,
        activeModels: 0,
        deprecatedModels: 0,
        missingPricingModels: 0,
        aliasesResolved: 0,
      },
      provenance: [],
    }
    const md = generate(reg)
    expect(md).toContain("MIT")
    expect(md).toContain("models.dev")
  })

  test("renders empty sources gracefully", () => {
    const md = renderNoticesMarkdown([])
    expect(md).toContain("# THIRD_PARTY_NOTICES")
  })
})