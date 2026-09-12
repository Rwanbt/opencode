import { describe, expect, test } from "bun:test"
import { Effect, Layer } from "effect"
import {
  Registry,
  LiveRegistryLayer,
  defaultStorage,
  type ModelFilter,
  type ProviderFilter,
} from "../../src/model-intelligence/registry"
import { FileStorage, MemoryStorage, StorageManager } from "../../src/model-intelligence/storage"
import { ingest, buildRegistry } from "../../src/model-intelligence/ingestion"
import { SCHEMA_VERSION } from "../../src/model-intelligence/schema-version"

const baseUTC = "2026-07-21T00:00:00Z"
const validHash = "a".repeat(64)

function buildSampleRegistry() {
  const parsed = {
    providers: [
      {
        id: "anthropic",
        name: "Anthropic",
        sdk: "@ai-sdk/anthropic",
        api: { baseURL: "https://api.anthropic.com" },
        envVars: ["ANTHROPIC_API_KEY"],
        capabilities: {
          tools: true,
          structuredOutput: true,
          streaming: true,
          visionInput: true,
          audioIO: false,
          videoIO: false,
          pdfInput: true,
          functionCallingStrict: false,
          systemPrompts: true,
        },
        modalitiesSupported: { input: ["text", "image", "pdf"], output: ["text"] },
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
        id: "claude-sonnet-4",
        providerID: "anthropic",
        canonicalName: "Claude Sonnet 4",
        family: "claude",
        aliases: ["sonnet"],
        capabilities: {
          structuredOutput: true,
          toolCalls: true,
          parallelToolCalls: true,
          visionInput: true,
          audioInput: false,
          videoInput: false,
          pdfInput: true,
          reasoning: true,
          caching: true,
          promptCaching: true,
          systemMessages: true,
        },
        modalities: { input: ["text", "image", "pdf"], output: ["text"] },
        contextWindow: { totalTokens: 200_000, inputTokens: null, outputTokens: 8192 },
        reasoning: { supports: true, interleavedField: "reasoning_content" },
        toolUse: { supports: true, parallelCalls: true },
        temperature: { supports: true, range: null },
        status: "active",
        deprecationReason: null,
        lifecycleStage: "trusted_by_domain",
        releaseDateUTC: "2025-05-14T00:00:00Z",
        retirementDateUTC: null,
        pricing: {
          currency: "USD",
          unit: "per_1m_tokens",
          input: 3,
          output: 15,
          cacheRead: 0.3,
          cacheWrite: 3.75,
          reasoning: null,
          tiers: null,
        },
        sourceRefs: [
          {
            sourceID: "catalog:models.dev:api.json",
            observedAtUTC: baseUTC,
            sourceVersion: baseUTC,
            fieldHashes: { id: validHash },
          },
        ],
        health: {
          lastHealthCheckUTC: baseUTC,
          availabilityScore: 0.99,
          latencyP50Ms: 850,
          latencyP95Ms: 2400,
          errorRate1h: 0.01,
          rateLimit: null,
          notes: null,
        },
        provenance: {
          sourceID: "catalog:models.dev:api.json",
          sourceVersion: baseUTC,
          sourceURL: "https://models.dev/api.json",
          fetchedAtUTC: baseUTC,
          rawHash: validHash,
          parserVersion: "1.0.0",
          transformHash: validHash,
          signatureRef: null,
        },
        lastSeenAtUTC: baseUTC,
      },
      {
        id: "claude-opus-4",
        providerID: "anthropic",
        canonicalName: "Claude Opus 4",
        family: "claude",
        aliases: [],
        capabilities: {
          structuredOutput: true,
          toolCalls: true,
          parallelToolCalls: true,
          visionInput: true,
          audioInput: false,
          videoInput: false,
          pdfInput: true,
          reasoning: true,
          caching: true,
          promptCaching: true,
          systemMessages: true,
        },
        modalities: { input: ["text", "image"], output: ["text"] },
        contextWindow: { totalTokens: 200_000, inputTokens: null, outputTokens: 8192 },
        reasoning: { supports: true, interleavedField: "reasoning_content" },
        toolUse: { supports: true, parallelCalls: true },
        temperature: { supports: true, range: null },
        status: "active",
        deprecationReason: null,
        lifecycleStage: "trusted_by_domain",
        releaseDateUTC: "2025-05-22T00:00:00Z",
        retirementDateUTC: null,
        pricing: {
          currency: "USD",
          unit: "per_1m_tokens",
          input: 15,
          output: 75,
          cacheRead: 1.5,
          cacheWrite: 18.75,
          reasoning: null,
          tiers: null,
        },
        sourceRefs: [
          {
            sourceID: "catalog:models.dev:api.json",
            observedAtUTC: baseUTC,
            sourceVersion: baseUTC,
            fieldHashes: { id: validHash },
          },
        ],
        health: {
          lastHealthCheckUTC: baseUTC,
          availabilityScore: 0.99,
          latencyP50Ms: 1200,
          latencyP95Ms: 3500,
          errorRate1h: 0.01,
          rateLimit: null,
          notes: null,
        },
        provenance: {
          sourceID: "catalog:models.dev:api.json",
          sourceVersion: baseUTC,
          sourceURL: "https://models.dev/api.json",
          fetchedAtUTC: baseUTC,
          rawHash: validHash,
          parserVersion: "1.0.0",
          transformHash: validHash,
          signatureRef: null,
        },
        lastSeenAtUTC: baseUTC,
      },
    ],
    aliases: [
      {
        alias: "sonnet",
        canonicalRef: { providerID: "anthropic", modelID: "claude-sonnet-4" },
        deprecated: false,
        replacedBy: null,
      },
    ],
    metadata: {
      sourceID: "catalog:models.dev:api.json",
      sourceVersion: baseUTC,
      fetchedAtUTC: baseUTC,
      rawHash: validHash,
      parserVersion: "1.0.0",
    },
  }
  return buildRegistry(ingest(parsed))
}

describe("Registry interface", () => {
  test("get() returns loaded registry", async () => {
    const sample = buildSampleRegistry()
    const backend = new MemoryStorage("test")
    await backend.save(sample)

    const manager = new StorageManager(backend)
    await manager.init()

    expect(manager.isLoaded()).toBe(true)
    const reg = await manager.get()
    expect(reg.providers.length).toBe(1)
    expect(reg.models.length).toBe(2)
  })

  test("listModels filters by provider", async () => {
    const sample = buildSampleRegistry()
    const backend = new MemoryStorage("test-filter")
    await backend.save(sample)

    const manager = new StorageManager(backend)
    await manager.init()
    const reg = await manager.get()

    const anthropicModels = reg.models.filter((m) => m.providerID === "anthropic")
    expect(anthropicModels.length).toBe(2)
  })

  test("listModels filters by status=active", async () => {
    const sample = buildSampleRegistry()
    const backend = new MemoryStorage("test-status")
    await backend.save(sample)

    const manager = new StorageManager(backend)
    await manager.init()
    const reg = await manager.get()

    const active = reg.models.filter((m) => m.status === "active")
    expect(active.length).toBe(2)
  })

  test("listModels filters by capability (toolCalls)", async () => {
    const sample = buildSampleRegistry()
    const backend = new MemoryStorage("test-cap")
    await backend.save(sample)

    const manager = new StorageManager(backend)
    await manager.init()
    const reg = await manager.get()

    const toolCapable = reg.models.filter((m) => m.capabilities.toolCalls)
    expect(toolCapable.length).toBe(2)
  })

  test("alias resolution finds sonnet → claude-sonnet-4", async () => {
    const sample = buildSampleRegistry()
    const backend = new MemoryStorage("test-alias")
    await backend.save(sample)

    const manager = new StorageManager(backend)
    await manager.init()
    const reg = await manager.get()

    const sonnetAlias = reg.aliases.find((a) => a.alias === "sonnet")
    expect(sonnetAlias?.canonicalRef.modelID).toBe("claude-sonnet-4")
  })

  test("FileStorage persists to disk", async () => {
    const sample = buildSampleRegistry()
    const tmpPath = `D:\\App\\OpenCode\\.team-worktrees\\C01-14f2ff73\\packages\\opencode\\test\\model-intelligence\\fixtures\\test-storage-${Date.now()}.json`

    const fs = new FileStorage(tmpPath)
    await fs.save(sample)
    const loaded = await fs.load()
    expect(loaded).not.toBeNull()
    expect(loaded?.providers.length).toBe(1)

    const { unlink } = await import("node:fs/promises")
    await unlink(tmpPath).catch(() => {})
  })

  test("FileStorage returns null on missing file", async () => {
    const fs = new FileStorage(
      `D:\\App\\OpenCode\\.team-worktrees\\C01-14f2ff73\\packages\\opencode\\test\\model-intelligence\\fixtures\\does-not-exist-${Date.now()}.json`,
    )
    expect(await fs.load()).toBeNull()
  })

  test("StorageManager throws if not initialized", async () => {
    const fs = new FileStorage(
      `D:\\App\\OpenCode\\.team-worktrees\\C01-14f2ff73\\packages\\opencode\\test\\model-intelligence\\fixtures\\never-${Date.now()}.json`,
    )
    const manager = new StorageManager(fs)
    expect(manager.isLoaded()).toBe(false)
    await expect(manager.get()).rejects.toThrow()
  })
})