/* SPDX-License-Identifier: MIT */
/**
 * Vector index (P5.2).
 *
 * Brute-force cosine scan over a `Float32Array[]` corpus. ANN
 * is `disabled` by default (ADR-KNOW-0008).
 */

import type { KnowledgeId, KnowledgeLocator } from "@unifia/contracts/knowledge"

export interface VectorEntry {
  id: KnowledgeId
  locator: KnowledgeLocator
  vector: Float32Array
}

export interface VectorQuery {
  vector: Float32Array
  /** Max candidates to return. */
  topK: number
  /** Min similarity, 0..1. */
  minSimilarity?: number
}

export interface VectorHit {
  id: KnowledgeId
  locator: KnowledgeLocator
  similarity: number
}

export function cosine(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length) return 0
  let dot = 0
  let na = 0
  let nb = 0
  for (let i = 0; i < a.length; i++) {
    const x = a[i] ?? 0
    const y = b[i] ?? 0
    dot += x * y
    na += x * x
    nb += y * y
  }
  if (na === 0 || nb === 0) return 0
  return dot / Math.sqrt(na * nb)
}

export class BruteForceIndex {
  private readonly entries: VectorEntry[] = []

  add(entry: VectorEntry): void {
    this.entries.push(entry)
  }

  size(): number {
    return this.entries.length
  }

  query(q: VectorQuery): VectorHit[] {
    const min = q.minSimilarity ?? 0
    const hits: VectorHit[] = []
    for (const e of this.entries) {
      const s = cosine(q.vector, e.vector)
      if (s < min) continue
      hits.push({ id: e.id, locator: e.locator, similarity: s })
    }
    hits.sort((a, b) => b.similarity - a.similarity)
    return hits.slice(0, q.topK)
  }
}
