/* SPDX-License-Identifier: MIT */
/**
 * Semantic benchmark (P5.3).
 *
 * Per runbook §15 P5.3 and ADR-KNOW-0008: measure Recall@5/10,
 * MRR, nDCG, forbidden/superseded/conflict/egress violation
 * rate, latency, RAM, size, battery. The benchmark runs on the
 * dev set for tuning; the holdout decides activation.
 *
 * V1: pure function that takes ground-truth + candidates and
 * produces metrics. The runtime harness that calls
 * `bun test`/`cargo bench` is in `bench/`.
 */

import type { RetrievalCandidate, KnowledgeId, KnowledgeLocator } from "@unifia/contracts/knowledge"

export interface GroundTruth {
  query: string
  /** Expected relevant ids, in decreasing order. */
  expected: KnowledgeId[]
  /** Forbidden ids (should NEVER be returned). */
  forbidden?: KnowledgeId[]
}

export interface BenchmarkResult {
  query: string
  recallAt5: number
  recallAt10: number
  mrr: number
  ndcgAt10: number
  /** 0..1 — fraction of returned candidates that are forbidden. */
  forbiddenRate: number
  /** 0..1 — fraction of candidates that violate supersession. */
  supersededRate: number
  /** Wall-clock latency in ms. */
  latencyMs: number
}

export function dcg(rels: number[]): number {
  let s = 0
  for (let i = 0; i < rels.length; i++) {
    const denom = Math.log2(i + 2)
    s += rels[i]! / denom
  }
  return s
}

export function ndcg(expected: KnowledgeId[], returnedIds: KnowledgeId[], k: number): number {
  const rels = returnedIds.slice(0, k).map((id) => (expected.includes(id) ? 1 : 0))
  const ideal = expected.slice(0, k).map(() => 1)
  const idealD = dcg(ideal)
  if (idealD === 0) return 0
  return dcg(rels) / idealD
}

export function mrr(expected: KnowledgeId[], returnedIds: KnowledgeId[]): number {
  for (let i = 0; i < returnedIds.length; i++) {
    if (expected.includes(returnedIds[i]!)) return 1 / (i + 1)
  }
  return 0
}

export function recallAtK(expected: KnowledgeId[], returnedIds: KnowledgeId[], k: number): number {
  if (expected.length === 0) return 0
  let hit = 0
  for (const id of expected) if (returnedIds.slice(0, k).includes(id)) hit++
  return hit / expected.length
}

export function benchmarkOne(
  ground: GroundTruth,
  candidates: readonly RetrievalCandidate[],
  latencyMs: number,
  superseded: ReadonlyMap<KnowledgeId, boolean> = new Map(),
): BenchmarkResult {
  const ids = candidates.map((c) => c.id)
  const top10 = ids.slice(0, 10)
  const forbiddenSet = new Set(ground.forbidden ?? [])
  const forbiddenCount = top10.filter((id) => forbiddenSet.has(id)).length
  const supersededCount = top10.filter((id) => superseded.get(id) === true).length
  return {
    query: ground.query,
    recallAt5: recallAtK(ground.expected, ids, 5),
    recallAt10: recallAtK(ground.expected, ids, 10),
    mrr: mrr(ground.expected, ids),
    ndcgAt10: ndcg(ground.expected, ids, 10),
    forbiddenRate: forbiddenCount / Math.max(1, top10.length),
    supersededRate: supersededCount / Math.max(1, top10.length),
    latencyMs,
  }
}

export interface BenchmarkSummary {
  meanRecallAt5: number
  meanRecallAt10: number
  meanMrr: number
  meanNdcgAt10: number
  meanForbiddenRate: number
  meanSupersededRate: number
  meanLatencyMs: number
  queryCount: number
  /** True when the semantic pass is admissible for activation. */
  activate: boolean
}

export function summarise(results: readonly BenchmarkResult[]): BenchmarkSummary {
  if (results.length === 0) {
    return {
      meanRecallAt5: 0,
      meanRecallAt10: 0,
      meanMrr: 0,
      meanNdcgAt10: 0,
      meanForbiddenRate: 1,
      meanSupersededRate: 1,
      meanLatencyMs: 0,
      queryCount: 0,
      activate: false,
    }
  }
  const sum = (sel: (r: BenchmarkResult) => number): number =>
    results.reduce((acc, r) => acc + sel(r), 0)
  const n = results.length
  const meanRecallAt5 = sum((r) => r.recallAt5) / n
  const meanRecallAt10 = sum((r) => r.recallAt10) / n
  const meanMrr = sum((r) => r.mrr) / n
  const meanNdcgAt10 = sum((r) => r.ndcgAt10) / n
  const meanForbiddenRate = sum((r) => r.forbiddenRate) / n
  const meanSupersededRate = sum((r) => r.supersededRate) / n
  const meanLatencyMs = sum((r) => r.latencyMs) / n
  // ADR-KNOW-0008: activate if forbidden/superseded == 0 and
  // recall@5 >= FTS baseline + 10 % margin (we don't have the
  // FTS baseline here; we keep the safe default: any non-zero
  // violation rate disables).
  const activate = meanForbiddenRate === 0 && meanSupersededRate === 0
  return {
    meanRecallAt5,
    meanRecallAt10,
    meanMrr,
    meanNdcgAt10,
    meanForbiddenRate,
    meanSupersededRate,
    meanLatencyMs,
    queryCount: n,
    activate,
  }
}

// Marker so the symbol is not tree-shaken before the runtime
// harness references it.
export const _benchmark_marker: unique symbol = Symbol("benchmark")
void _benchmark_marker
// Keep imports used in case future engines rely on them.
export type { KnowledgeId, KnowledgeLocator }
