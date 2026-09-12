import { describe, expect, test } from "bun:test"
import {
  BenchmarkDefinitionRegistry,
  BenchmarkResultSchema,
  benchmarkResultFingerprint,
  computeBenchmarkResultID,
  detectDuplicateResults,
  groupResolvedResultsByModel,
  ingestBenchmarkResults,
  mapBenchmarkLabelToModel,
  mapBenchmarkResults,
  partitionByConfidence,
  validateResultAgainstDefinition,
  type BenchmarkDefinition,
  type BenchmarkResult,
  type MappableModel,
} from "../../src/model-intelligence/benchmarks"

const baseUTC = "2026-07-20T00:00:00Z"
const ingestUTC = "2026-07-25T00:00:00Z"

function harness(overrides: Partial<BenchmarkResult["harness"]> = {}): BenchmarkResult["harness"] {
  return {
    id: "lm-evaluation-harness",
    version: "0.4.5",
    methodologyURL: "https://github.com/EleutherAI/lm-evaluation-harness",
    ...overrides,
  }
}

function provenance(overrides: Partial<BenchmarkResult["provenance"]> = {}): BenchmarkResult["provenance"] {
  return {
    sourceID: "leaderboard:openllm",
    sourceURL: "https://example.com/leaderboard",
    publishedAtUTC: baseUTC,
    ingestedAtUTC: ingestUTC,
    confidenceLevel: "community",
    ...overrides,
  }
}

function makeResult(overrides: Partial<BenchmarkResult> = {}): BenchmarkResult {
  const base: BenchmarkResult = {
    id: "result-1",
    benchmarkID: "mmlu-pro",
    benchmarkVersion: "1.0.0",
    harness: harness(),
    rawModelLabel: "opus-4.6",
    score: 82.5,
    provenance: provenance(),
    notes: null,
  }
  return { ...base, ...overrides }
}

function makeModel(overrides: Partial<MappableModel> = {}): MappableModel {
  return {
    id: "claude-opus-4-6",
    providerID: "anthropic",
    canonicalName: "Claude Opus 4.6",
    aliases: ["opus-4.6"],
    ...overrides,
  }
}

describe("benchmarks — schema, version, harness tagging", () => {
  test("a valid result requires benchmarkID + benchmarkVersion + harness identity", () => {
    const result = BenchmarkResultSchema.safeParse(makeResult())
    expect(result.success).toBe(true)
  })

  test("rejects a result missing benchmarkVersion (no anonymous bare number)", () => {
    const raw = { ...makeResult(), benchmarkVersion: "" }
    const result = BenchmarkResultSchema.safeParse(raw)
    expect(result.success).toBe(false)
  })

  test("rejects a result missing harness.id", () => {
    const raw = { ...makeResult(), harness: { ...harness(), id: "" } }
    const result = BenchmarkResultSchema.safeParse(raw)
    expect(result.success).toBe(false)
  })

  test("rejects a result missing harness.version", () => {
    const raw = { ...makeResult(), harness: { ...harness(), version: "" } }
    const result = BenchmarkResultSchema.safeParse(raw)
    expect(result.success).toBe(false)
  })

  test("harness version does not need to be strict semver (real-world suite revisions vary)", () => {
    const raw = makeResult({ harness: harness({ version: "2024-06" }) })
    const result = BenchmarkResultSchema.safeParse(raw)
    expect(result.success).toBe(true)
  })
})

describe("benchmarks — provenance (source + date) presence", () => {
  test("rejects a result with an empty sourceID", () => {
    const raw = { ...makeResult(), provenance: provenance({ sourceID: "" }) }
    const result = BenchmarkResultSchema.safeParse(raw)
    expect(result.success).toBe(false)
  })

  test("rejects a result with a malformed sourceURL", () => {
    const raw = { ...makeResult(), provenance: provenance({ sourceURL: "not-a-url" }) }
    const result = BenchmarkResultSchema.safeParse(raw)
    expect(result.success).toBe(false)
  })

  test("rejects a result with a malformed ingestedAtUTC", () => {
    const raw = { ...makeResult(), provenance: provenance({ ingestedAtUTC: "2026-07-25" }) }
    const result = BenchmarkResultSchema.safeParse(raw)
    expect(result.success).toBe(false)
  })

  test("publishedAtUTC may be null (genuinely unknown) but ingestedAtUTC is always required", () => {
    const raw = makeResult({ provenance: provenance({ publishedAtUTC: null }) })
    const result = BenchmarkResultSchema.safeParse(raw)
    expect(result.success).toBe(true)
  })

  test("ingestBenchmarkResults rejects results with invalid provenance instead of silently accepting them", () => {
    const raw = [{ ...makeResult(), provenance: provenance({ sourceURL: "" }) }]
    const outcome = ingestBenchmarkResults(raw)
    expect(outcome.accepted).toHaveLength(0)
    expect(outcome.rejectedInvalid).toHaveLength(1)
  })
})

describe("benchmarks — duplicate detection", () => {
  test("detectDuplicateResults groups results sharing the same fingerprint", () => {
    const a = makeResult({ id: "a" })
    const b = makeResult({ id: "b" })
    const c = makeResult({ id: "c", rawModelLabel: "different-model" })
    const groups = detectDuplicateResults([a, b, c])
    expect(groups).toHaveLength(1)
    expect(groups[0].results.map((r) => r.id).sort()).toEqual(["a", "b"])
  })

  test("results differing only by score still share a fingerprint (conflicting re-report is still a duplicate)", () => {
    const a = makeResult({ id: "a", score: 80 })
    const b = makeResult({ id: "b", score: 90 })
    expect(benchmarkResultFingerprint(a)).toBe(benchmarkResultFingerprint(b))
  })

  test("different sourceID does not count as a duplicate (distinct provenance = distinct data point)", () => {
    const a = makeResult({ id: "a", provenance: provenance({ sourceID: "leaderboard:openllm" }) })
    const b = makeResult({ id: "b", provenance: provenance({ sourceID: "leaderboard:huggingface" }) })
    expect(detectDuplicateResults([a, b])).toHaveLength(0)
  })

  test("ingestBenchmarkResults accepts the first occurrence and rejects later duplicates", () => {
    const a = makeResult({ id: "a" })
    const b = makeResult({ id: "b" })
    const outcome = ingestBenchmarkResults([a, b])
    expect(outcome.accepted.map((r) => r.id)).toEqual(["a"])
    expect(outcome.rejectedDuplicates).toHaveLength(1)
    expect(outcome.rejectedDuplicates[0]).toEqual({
      id: "b",
      fingerprint: benchmarkResultFingerprint(a),
      conflictsWithID: "a",
    })
  })

  test("computeBenchmarkResultID is deterministic for identical inputs", () => {
    const input = {
      benchmarkID: "mmlu-pro",
      benchmarkVersion: "1.0.0",
      harnessID: "lm-evaluation-harness",
      harnessVersion: "0.4.5",
      rawModelLabel: "opus-4.6",
      sourceID: "leaderboard:openllm",
    }
    expect(computeBenchmarkResultID(input)).toBe(computeBenchmarkResultID({ ...input }))
  })

  test("computeBenchmarkResultID differs when any identifying field differs", () => {
    const base = {
      benchmarkID: "mmlu-pro",
      benchmarkVersion: "1.0.0",
      harnessID: "lm-evaluation-harness",
      harnessVersion: "0.4.5",
      rawModelLabel: "opus-4.6",
      sourceID: "leaderboard:openllm",
    }
    expect(computeBenchmarkResultID(base)).not.toBe(
      computeBenchmarkResultID({ ...base, benchmarkVersion: "1.0.1" }),
    )
  })
})

describe("benchmarks — confidence-level mapping", () => {
  test("exact match on model id yields confidence=exact", () => {
    const models = [makeModel({ id: "claude-opus-4-6", canonicalName: "Claude Opus 4.6", aliases: [] })]
    const mapping = mapBenchmarkLabelToModel("claude-opus-4-6", models)
    expect(mapping.confidence).toBe("exact")
    expect(mapping.resolved).toEqual({ providerID: "anthropic", modelID: "claude-opus-4-6" })
  })

  test("exact match on alias yields confidence=exact", () => {
    const models = [makeModel({ aliases: ["opus-4.6", "claude-opus"] })]
    const mapping = mapBenchmarkLabelToModel("opus-4.6", models)
    expect(mapping.confidence).toBe("exact")
    expect(mapping.resolved).not.toBeNull()
  })

  test("exact match on canonicalName yields confidence=exact", () => {
    const models = [makeModel({ canonicalName: "Claude Opus 4.6", aliases: [] })]
    const mapping = mapBenchmarkLabelToModel("Claude Opus 4.6", models)
    expect(mapping.confidence).toBe("exact")
  })

  test("fuzzy/partial single match yields confidence=probable, not exact", () => {
    const models = [makeModel({ id: "claude-opus-4-6-20260601", canonicalName: "Claude Opus 4.6 (2026-06-01)", aliases: [] })]
    const mapping = mapBenchmarkLabelToModel("claude-opus-4-6", models)
    expect(mapping.confidence).toBe("probable")
    expect(mapping.resolved).not.toBeNull()
  })

  test("no candidate at all yields confidence=ambiguous with resolved=null and empty candidates", () => {
    const models = [makeModel({ id: "gpt-5", providerID: "openai", canonicalName: "GPT-5", aliases: [] })]
    const mapping = mapBenchmarkLabelToModel("totally-unrelated-model-xyz", models)
    expect(mapping.confidence).toBe("ambiguous")
    expect(mapping.resolved).toBeNull()
    expect(mapping.candidates).toHaveLength(0)
  })

  test("empty label normalizes to nothing usable and is ambiguous", () => {
    const mapping = mapBenchmarkLabelToModel("   ---   ", [makeModel()])
    expect(mapping.confidence).toBe("ambiguous")
    expect(mapping.resolved).toBeNull()
  })
})

describe("benchmarks — ambiguous mapping rejection (never silently guessed)", () => {
  test("a label matching the same id across multiple providers is ambiguous, never force-mapped to one", () => {
    const models = [
      makeModel({ id: "gpt-5", providerID: "openai", canonicalName: "GPT-5", aliases: [] }),
      makeModel({ id: "gpt-5", providerID: "azure-openai", canonicalName: "GPT-5 (Azure)", aliases: [] }),
    ]
    const mapping = mapBenchmarkLabelToModel("gpt-5", models)
    expect(mapping.confidence).toBe("ambiguous")
    expect(mapping.resolved).toBeNull()
    expect(mapping.candidates).toHaveLength(2)
    expect(mapping.candidates).toEqual(
      expect.arrayContaining([
        { providerID: "openai", modelID: "gpt-5" },
        { providerID: "azure-openai", modelID: "gpt-5" },
      ]),
    )
  })

  test("multiple plausible fuzzy candidates are ambiguous rather than picking the first", () => {
    const models = [
      makeModel({ id: "gpt-5-mini", providerID: "openai", canonicalName: "GPT-5 Mini", aliases: [] }),
      makeModel({ id: "gpt-5-preview", providerID: "openai", canonicalName: "GPT-5 Preview", aliases: [] }),
    ]
    const mapping = mapBenchmarkLabelToModel("gpt-5", models)
    expect(mapping.confidence).toBe("ambiguous")
    expect(mapping.resolved).toBeNull()
    expect(mapping.candidates.length).toBeGreaterThan(1)
  })

  test("groupResolvedResultsByModel excludes ambiguous mappings entirely — never attached to a model as ground truth", () => {
    const ambiguousModels = [
      makeModel({ id: "gpt-5", providerID: "openai", canonicalName: "GPT-5", aliases: [] }),
      makeModel({ id: "gpt-5", providerID: "azure-openai", canonicalName: "GPT-5 (Azure)", aliases: [] }),
    ]
    const results = [makeResult({ id: "r1", rawModelLabel: "gpt-5" })]
    const mapped = mapBenchmarkResults(results, ambiguousModels)
    const profiles = groupResolvedResultsByModel(mapped)
    expect(profiles).toHaveLength(0)
  })

  test("partitionByConfidence separates resolved from ambiguous without dropping either", () => {
    const models = [
      makeModel({ id: "claude-opus-4-6", providerID: "anthropic", canonicalName: "Claude Opus 4.6", aliases: [] }),
    ]
    const results = [
      makeResult({ id: "resolved-1", rawModelLabel: "claude-opus-4-6" }),
      makeResult({ id: "ambiguous-1", rawModelLabel: "unknown-model-abc" }),
    ]
    const mapped = mapBenchmarkResults(results, models)
    const { resolved, ambiguous } = partitionByConfidence(mapped)
    expect(resolved).toHaveLength(1)
    expect(ambiguous).toHaveLength(1)
    expect(resolved[0].result.id).toBe("resolved-1")
    expect(ambiguous[0].result.id).toBe("ambiguous-1")
  })

  test("groupResolvedResultsByModel attaches only resolved results, preserving per-benchmark vectorial entries (no aggregate score)", () => {
    const models = [makeModel({ id: "claude-opus-4-6", providerID: "anthropic", canonicalName: "Claude Opus 4.6", aliases: [] })]
    const results = [
      makeResult({ id: "r1", benchmarkID: "mmlu-pro", rawModelLabel: "claude-opus-4-6", score: 82.5 }),
      makeResult({ id: "r2", benchmarkID: "gpqa-diamond", rawModelLabel: "claude-opus-4-6", score: 71.2 }),
    ]
    const mapped = mapBenchmarkResults(results, models)
    const profiles = groupResolvedResultsByModel(mapped)
    expect(profiles).toHaveLength(1)
    expect(profiles[0].providerID).toBe("anthropic")
    expect(profiles[0].modelID).toBe("claude-opus-4-6")
    expect(profiles[0].results).toHaveLength(2)
    expect(profiles[0].results.map((r) => r.benchmarkID).sort()).toEqual(["gpqa-diamond", "mmlu-pro"])
    // Each entry keeps its own score — never collapsed into a single field on the profile.
    expect(profiles[0]).not.toHaveProperty("score")
    expect(profiles[0]).not.toHaveProperty("overallScore")
    expect(profiles[0]).not.toHaveProperty("rank")
  })
})

describe("benchmarks — definition registry + result/definition consistency", () => {
  const mmluPro: BenchmarkDefinition = {
    id: "mmlu-pro",
    name: "MMLU-Pro",
    version: "1.0.0",
    scoreType: "accuracy_pct",
    higherIsBetter: true,
    scoreRange: { min: 0, max: 100 },
    description: "Extended multi-task language understanding benchmark.",
  }

  test("register/get/list round-trip", () => {
    const registry = new BenchmarkDefinitionRegistry()
    registry.register(mmluPro)
    expect(registry.get("mmlu-pro")).toEqual(mmluPro)
    expect(registry.list()).toEqual([mmluPro])
  })

  test("validateResultAgainstDefinition returns ok for an in-range score against a known benchmark", () => {
    const registry = new BenchmarkDefinitionRegistry()
    registry.register(mmluPro)
    const check = validateResultAgainstDefinition(makeResult({ score: 82.5 }), registry)
    expect(check).toEqual({ ok: true })
  })

  test("validateResultAgainstDefinition flags an unregistered benchmarkID", () => {
    const registry = new BenchmarkDefinitionRegistry()
    const check = validateResultAgainstDefinition(makeResult({ benchmarkID: "unknown-suite" }), registry)
    expect(check).toEqual({ ok: false, reason: "unknown_benchmark", benchmarkID: "unknown-suite" })
  })

  test("validateResultAgainstDefinition flags an out-of-range score", () => {
    const registry = new BenchmarkDefinitionRegistry()
    registry.register(mmluPro)
    const check = validateResultAgainstDefinition(makeResult({ score: 150 }), registry)
    expect(check).toEqual({
      ok: false,
      reason: "score_out_of_range",
      benchmarkID: "mmlu-pro",
      score: 150,
      min: 0,
      max: 100,
    })
  })
})

describe("benchmarks — no universal score surface", () => {
  test("the module does not export a function whose name implies a single aggregate/composite/ranking score", async () => {
    const mod = await import("../../src/model-intelligence/benchmarks")
    const suspiciousNamePattern = /overall|composite|universal|^rank$|ranking/i
    const suspiciousExports = Object.keys(mod).filter((key) => suspiciousNamePattern.test(key))
    expect(suspiciousExports).toEqual([])
  })
})
