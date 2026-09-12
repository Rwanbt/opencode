/**
 * Benchmark ingestion with provenance and confidence-based mapping (TEAM-C05).
 *
 * Imports external benchmark results (published leaderboard/eval scores)
 * without conflating them with internally-measured performance data. This
 * module is a provenance and confidence-tracking layer, NOT a benchmark
 * running harness — it never executes an eval, it only ingests, tags and
 * maps results that were produced elsewhere.
 *
 * Core invariants:
 *   - Every score is tagged with an explicit benchmark suite id + version
 *     and an explicit harness/methodology identity. A bare number with no
 *     suite/version/harness attached is not a valid BenchmarkResult (the
 *     Zod schema enforces this at the boundary).
 *   - Every result carries provenance: where it came from (sourceID +
 *     sourceURL) and when (publishedAtUTC when known, ingestedAtUTC
 *     always). No result without provenance.
 *   - A benchmark result never maps 1:1 to a model release by assumption.
 *     `mapBenchmarkLabelToModel` returns an explicit MappingConfidence
 *     ("exact" | "probable" | "ambiguous"). A label that could plausibly
 *     match more than one registry model release (e.g. "gpt-5" without a
 *     precise snapshot identifier, matching several providers/snapshots)
 *     is ALWAYS surfaced as "ambiguous" with `resolved: null` and the full
 *     candidate list — never silently collapsed onto a guessed single
 *     match, and never silently dropped from the result set.
 *   - `groupResolvedResultsByModel` and any other consumer-facing view
 *     built on top of mapped results MUST exclude ambiguous mappings from
 *     anything treated as ground truth (ambiguous_mapping_policy: REJECT).
 *     Ambiguous mappings remain inspectable via `partitionByConfidence`,
 *     they are simply never force-mapped.
 *   - This module NEVER computes a single aggregate/composite/ranking
 *     score across benchmarks. `ModelBenchmarkProfile.results` is a list
 *     of independent per-benchmark data points (vectorial, one entry per
 *     benchmark+version+harness). It supplements the existing model
 *     identity/capability data in schema.ts — it never replaces or
 *     overrides it with a "universal score". Do not add a function here
 *     that reduces `ModelBenchmarkProfile.results` to one number.
 *
 * Aucun import depuis multi-model/ ou team/ ici (mêmes invariants que
 * schema.ts — cf. doctrine plan §0.2). Lecture seule de ./schema (type
 * Model) pour mapper dans l'espace d'identité déjà défini par C01, jamais
 * un second espace d'identité parallèle.
 */

import { createHash } from "node:crypto"
import { z } from "zod"
import type { Model } from "./schema"

// =====================================================================
// 1. Regex constants — local copies, convention shared across
//    model-intelligence modules (see source.ts, connectors/types.ts).
// =====================================================================

const ISO_8601_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/

/**
 * Benchmark suite / harness version strings are not always strict semver
 * in the wild (e.g. "2024-06", "v1.1", "commit-a3f9c2"). We require a
 * non-empty identifier but do not force semver — forcing semver here
 * would cause real published benchmark versions to be silently unrepresentable.
 */
const NonEmptyVersion = z.string().min(1)

// =====================================================================
// 2. Benchmark suite definitions
// =====================================================================

export const ScoreType = z.enum([
  "accuracy_pct",
  "pass_rate_pct",
  "elo",
  "normalized_0_1",
  "raw_points",
])
export type ScoreType = z.infer<typeof ScoreType>

export const BenchmarkDefinitionSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  /** Latest known suite version/revision this definition describes. */
  version: NonEmptyVersion,
  scoreType: ScoreType,
  higherIsBetter: z.boolean(),
  scoreRange: z
    .object({ min: z.number(), max: z.number() })
    .refine((r) => r.min < r.max, "scoreRange.min must be < scoreRange.max"),
  description: z.string().min(1),
})
export type BenchmarkDefinition = z.infer<typeof BenchmarkDefinitionSchema>

/**
 * Registry of known benchmark suite definitions. Purely descriptive
 * metadata (score shape, direction, range) — does not itself hold any
 * results. Mirrors the register/get/list shape used by SourceRegistry
 * (source.ts) for consistency across the model-intelligence namespace.
 */
export class BenchmarkDefinitionRegistry {
  private definitions = new Map<string, BenchmarkDefinition>()

  register(def: BenchmarkDefinition): void {
    this.definitions.set(def.id, def)
  }

  get(id: string): BenchmarkDefinition | undefined {
    return this.definitions.get(id)
  }

  list(): BenchmarkDefinition[] {
    return [...this.definitions.values()]
  }
}

// =====================================================================
// 3. Harness identity — which methodology/runner produced the score
// =====================================================================

export const HarnessIdentitySchema = z.object({
  /** e.g. "lm-evaluation-harness", "vendor-self-reported", "helm" — never blank/anonymous. */
  id: z.string().min(1),
  version: NonEmptyVersion,
  methodologyURL: z.string().url().nullable(),
})
export type HarnessIdentity = z.infer<typeof HarnessIdentitySchema>

// =====================================================================
// 4. Provenance — source + date, mandatory for every ingested result
// =====================================================================

export const BenchmarkProvenanceSchema = z.object({
  sourceID: z.string().min(1),
  sourceURL: z.string().url(),
  /** Date the score was published upstream, when known. Null only if genuinely unknown — ingestedAtUTC is always present as a fallback audit trail. */
  publishedAtUTC: z.string().regex(ISO_8601_UTC, "publishedAtUTC must be ISO 8601 UTC").nullable(),
  ingestedAtUTC: z.string().regex(ISO_8601_UTC, "ingestedAtUTC must be ISO 8601 UTC"),
  /** Trust level of the source itself (reuses Source.confidenceLevel convention from schema.ts). Orthogonal to MappingConfidence, which grades the model-identity mapping, not the source. */
  confidenceLevel: z.enum(["official", "community", "unverified"]),
})
export type BenchmarkProvenance = z.infer<typeof BenchmarkProvenanceSchema>

// =====================================================================
// 5. Benchmark result — the unit ingested
// =====================================================================

export const BenchmarkResultSchema = z.object({
  id: z.string().min(1),
  benchmarkID: z.string().min(1),
  benchmarkVersion: NonEmptyVersion,
  harness: HarnessIdentitySchema,
  /** The model label exactly as published by the source — NOT yet resolved to a registry (providerID, modelID). Resolution happens via mapBenchmarkLabelToModel. */
  rawModelLabel: z.string().min(1),
  score: z.number(),
  provenance: BenchmarkProvenanceSchema,
  notes: z.string().nullable(),
})
export type BenchmarkResult = z.infer<typeof BenchmarkResultSchema>

/**
 * Deterministic id for a benchmark result, derived from its own identifying
 * fields — avoids callers inventing ids that drift from the actual content
 * (single source of truth for "what makes two results the same entry").
 */
export function computeBenchmarkResultID(input: {
  benchmarkID: string
  benchmarkVersion: string
  harnessID: string
  harnessVersion: string
  rawModelLabel: string
  sourceID: string
}): string {
  const raw = [
    input.benchmarkID,
    input.benchmarkVersion,
    input.harnessID,
    input.harnessVersion,
    input.rawModelLabel,
    input.sourceID,
  ].join("|")
  return createHash("sha256").update(raw).digest("hex")
}

// =====================================================================
// 6. Duplicate detection
// =====================================================================

function normalizeLabel(label: string): string {
  return label
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
}

/**
 * Fingerprint identifying "the same reported data point" — same suite,
 * same suite version, same harness+version, same raw label, same source.
 * Two results with the same fingerprint but different scores are still
 * duplicates in identity terms (a conflicting re-report), not distinct
 * measurements — see ingestBenchmarkResults which records the conflict
 * rather than silently picking one.
 */
export function benchmarkResultFingerprint(r: BenchmarkResult): string {
  return [
    r.benchmarkID,
    r.benchmarkVersion,
    r.harness.id,
    r.harness.version,
    normalizeLabel(r.rawModelLabel),
    r.provenance.sourceID,
  ].join("::")
}

export interface DuplicateGroup {
  fingerprint: string
  results: BenchmarkResult[]
}

export function detectDuplicateResults(results: BenchmarkResult[]): DuplicateGroup[] {
  const groups = new Map<string, BenchmarkResult[]>()
  for (const r of results) {
    const fp = benchmarkResultFingerprint(r)
    const bucket = groups.get(fp)
    if (bucket) {
      bucket.push(r)
    } else {
      groups.set(fp, [r])
    }
  }
  return [...groups.entries()]
    .filter(([, list]) => list.length > 1)
    .map(([fingerprint, list]) => ({ fingerprint, results: list }))
}

// =====================================================================
// 7. Ingestion — validate + dedup, never throws on bad/duplicate input
// =====================================================================

export interface RejectedInvalidResult {
  raw: unknown
  reason: string
}

export interface RejectedDuplicateResult {
  id: string
  fingerprint: string
  conflictsWithID: string
}

export interface BenchmarkIngestResult {
  accepted: BenchmarkResult[]
  rejectedDuplicates: RejectedDuplicateResult[]
  rejectedInvalid: RejectedInvalidResult[]
}

/**
 * Validates raw candidate results against BenchmarkResultSchema and dedups
 * by fingerprint. Invalid or duplicate entries are reported, never
 * silently dropped or silently accepted — mirrors the skipped-list
 * convention used by ingest() in ingestion.ts.
 */
export function ingestBenchmarkResults(raw: unknown[]): BenchmarkIngestResult {
  const accepted: BenchmarkResult[] = []
  const rejectedInvalid: RejectedInvalidResult[] = []
  const rejectedDuplicates: RejectedDuplicateResult[] = []
  const seenByFingerprint = new Map<string, BenchmarkResult>()

  for (const item of raw) {
    const parsed = BenchmarkResultSchema.safeParse(item)
    if (!parsed.success) {
      rejectedInvalid.push({
        raw: item,
        reason: parsed.error.issues[0]?.message ?? "unknown validation error",
      })
      continue
    }

    const result = parsed.data
    const fingerprint = benchmarkResultFingerprint(result)
    const existing = seenByFingerprint.get(fingerprint)
    if (existing) {
      rejectedDuplicates.push({ id: result.id, fingerprint, conflictsWithID: existing.id })
      continue
    }

    seenByFingerprint.set(fingerprint, result)
    accepted.push(result)
  }

  return { accepted, rejectedDuplicates, rejectedInvalid }
}

// =====================================================================
// 8. Definition/result consistency check
// =====================================================================

export type ResultDefinitionCheck =
  | { ok: true }
  | { ok: false; reason: "unknown_benchmark"; benchmarkID: string }
  | { ok: false; reason: "score_out_of_range"; benchmarkID: string; score: number; min: number; max: number }

/**
 * Verifies a result references a registered benchmark definition and that
 * its score falls within that definition's declared range. Does not
 * mutate or throw — callers decide the fail-closed policy at their own
 * boundary (fits how ingestBenchmarkResults / mapping stay pure).
 */
export function validateResultAgainstDefinition(
  result: BenchmarkResult,
  registry: BenchmarkDefinitionRegistry,
): ResultDefinitionCheck {
  const def = registry.get(result.benchmarkID)
  if (!def) {
    return { ok: false, reason: "unknown_benchmark", benchmarkID: result.benchmarkID }
  }
  if (result.score < def.scoreRange.min || result.score > def.scoreRange.max) {
    return {
      ok: false,
      reason: "score_out_of_range",
      benchmarkID: result.benchmarkID,
      score: result.score,
      min: def.scoreRange.min,
      max: def.scoreRange.max,
    }
  }
  return { ok: true }
}

// =====================================================================
// 9. Mapping to model releases — explicit confidence, reject on ambiguity
// =====================================================================

export type MappingConfidence = "exact" | "probable" | "ambiguous"

export interface ModelRef {
  providerID: string
  modelID: string
}

export interface BenchmarkMapping {
  rawModelLabel: string
  confidence: MappingConfidence
  /** Non-null iff confidence is "exact" or "probable". Null for "ambiguous" — never a guessed single pick. */
  resolved: ModelRef | null
  /** All plausible candidates considered, including for the ambiguous case (transparency — nothing is dropped from view). */
  candidates: ModelRef[]
  reason: string
}

/** The subset of Model this module reads to resolve identity — read-only import from C01 schema, no parallel identity space. */
export type MappableModel = Pick<Model, "id" | "providerID" | "canonicalName" | "aliases">

function modelRef(m: MappableModel): ModelRef {
  return { providerID: m.providerID, modelID: m.id }
}

function dedupeModelRefs(models: MappableModel[]): ModelRef[] {
  const seen = new Map<string, ModelRef>()
  for (const m of models) {
    const ref = modelRef(m)
    const key = `${ref.providerID}/${ref.modelID}`
    if (!seen.has(key)) seen.set(key, ref)
  }
  return [...seen.values()]
}

/**
 * Maps a raw published label (e.g. "gpt-5", "claude-opus-4.6") onto the
 * registry's model-release identity space (providerID + modelID).
 *
 * Confidence policy:
 *   - "exact": normalized label matches exactly one model's id, alias or
 *     canonicalName, and that match is unique across the whole candidate
 *     set (a label matching the same id/alias under *multiple* providers
 *     is NOT exact — it is ambiguous by construction, since the label
 *     alone does not carry a precise release/snapshot identifier).
 *   - "probable": no exact match, but exactly one model is a plausible
 *     partial/fuzzy match (id or canonicalName contains the label or vice
 *     versa). Still resolved, but flagged as lower confidence for
 *     downstream review.
 *   - "ambiguous": zero candidates, or more than one plausible candidate.
 *     `resolved` is null. The result is never force-mapped onto a guess.
 */
export function mapBenchmarkLabelToModel(
  rawModelLabel: string,
  models: MappableModel[],
): BenchmarkMapping {
  const normalized = normalizeLabel(rawModelLabel)
  if (normalized.length === 0) {
    return {
      rawModelLabel,
      confidence: "ambiguous",
      resolved: null,
      candidates: [],
      reason: "label is empty or contains no usable identifier characters",
    }
  }

  const exactMatches: MappableModel[] = []
  for (const m of models) {
    const idNorm = normalizeLabel(m.id)
    const nameNorm = normalizeLabel(m.canonicalName)
    const aliasNorms = m.aliases.map(normalizeLabel)
    if (normalized === idNorm || normalized === nameNorm || aliasNorms.includes(normalized)) {
      exactMatches.push(m)
    }
  }

  const uniqueExact = dedupeModelRefs(exactMatches)
  if (uniqueExact.length === 1) {
    return {
      rawModelLabel,
      confidence: "exact",
      resolved: uniqueExact[0],
      candidates: uniqueExact,
      reason: "exact match on model id, canonicalName or alias",
    }
  }
  if (uniqueExact.length > 1) {
    return {
      rawModelLabel,
      confidence: "ambiguous",
      resolved: null,
      candidates: uniqueExact,
      reason: `label matches ${uniqueExact.length} distinct model releases exactly; a precise release/snapshot identifier is required to disambiguate`,
    }
  }

  const probableMatches: MappableModel[] = []
  for (const m of models) {
    const idNorm = normalizeLabel(m.id)
    const nameNorm = normalizeLabel(m.canonicalName)
    if (
      (idNorm.length > 0 && (idNorm.includes(normalized) || normalized.includes(idNorm))) ||
      (nameNorm.length > 0 && (nameNorm.includes(normalized) || normalized.includes(nameNorm)))
    ) {
      probableMatches.push(m)
    }
  }

  const uniqueProbable = dedupeModelRefs(probableMatches)
  if (uniqueProbable.length === 1) {
    return {
      rawModelLabel,
      confidence: "probable",
      resolved: uniqueProbable[0],
      candidates: uniqueProbable,
      reason: "single plausible partial/fuzzy match on id or canonicalName — not an exact identifier match",
    }
  }

  return {
    rawModelLabel,
    confidence: "ambiguous",
    resolved: null,
    candidates: uniqueProbable,
    reason:
      uniqueProbable.length === 0
        ? "no candidate model release found in the registry for this label"
        : `label could plausibly match ${uniqueProbable.length} distinct model releases; cannot resolve unambiguously`,
  }
}

// =====================================================================
// 10. Result + mapping composition — the consumer-facing view
// =====================================================================

export interface MappedBenchmarkResult {
  result: BenchmarkResult
  mapping: BenchmarkMapping
}

export function mapBenchmarkResults(
  results: BenchmarkResult[],
  models: MappableModel[],
): MappedBenchmarkResult[] {
  return results.map((result) => ({
    result,
    mapping: mapBenchmarkLabelToModel(result.rawModelLabel, models),
  }))
}

/**
 * Splits mapped results into resolved (exact or probable — safe to
 * attach to a model release) and ambiguous (never force-mapped, kept
 * visible for manual review rather than silently dropped).
 */
export function partitionByConfidence(mapped: MappedBenchmarkResult[]): {
  resolved: MappedBenchmarkResult[]
  ambiguous: MappedBenchmarkResult[]
} {
  const resolved: MappedBenchmarkResult[] = []
  const ambiguous: MappedBenchmarkResult[] = []
  for (const entry of mapped) {
    if (entry.mapping.confidence === "ambiguous" || entry.mapping.resolved === null) {
      ambiguous.push(entry)
    } else {
      resolved.push(entry)
    }
  }
  return { resolved, ambiguous }
}

export interface ModelBenchmarkEntry {
  benchmarkID: string
  benchmarkVersion: string
  harness: HarnessIdentity
  score: number
  confidence: MappingConfidence
  provenance: BenchmarkProvenance
}

export interface ModelBenchmarkProfile {
  providerID: string
  modelID: string
  /**
   * Vectorial list of independent per-benchmark data points. Deliberately
   * NOT reduced to a single number anywhere in this module — see the
   * module-level invariant comment. Downstream consumers that need a
   * capability comparison must use the existing Model.capabilities
   * vectorial profile (schema.ts); this array only supplements it.
   */
  results: ModelBenchmarkEntry[]
}

/**
 * Groups resolved (non-ambiguous) mapped results by model release. Never
 * includes ambiguous mappings — ambiguous_mapping_policy: REJECT applies
 * here as the enforcement point: an ambiguous result cannot end up
 * attached to a specific model release through this function.
 */
export function groupResolvedResultsByModel(mapped: MappedBenchmarkResult[]): ModelBenchmarkProfile[] {
  const { resolved } = partitionByConfidence(mapped)
  const byModel = new Map<string, ModelBenchmarkProfile>()

  for (const entry of resolved) {
    const ref = entry.mapping.resolved as ModelRef
    const key = `${ref.providerID}/${ref.modelID}`
    let profile = byModel.get(key)
    if (!profile) {
      profile = { providerID: ref.providerID, modelID: ref.modelID, results: [] }
      byModel.set(key, profile)
    }
    profile.results.push({
      benchmarkID: entry.result.benchmarkID,
      benchmarkVersion: entry.result.benchmarkVersion,
      harness: entry.result.harness,
      score: entry.result.score,
      confidence: entry.mapping.confidence,
      provenance: entry.result.provenance,
    })
  }

  return [...byModel.values()]
}
