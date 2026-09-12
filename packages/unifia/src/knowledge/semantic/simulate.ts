/* SPDX-License-Identifier: MIT */
/**
 * Similarity simulation over real fixtures (P5.5).
 *
 * V1 ships the BruteForceIndex and cosine functions, but the
 * ONNX embedding model is `disabled` by default. To prove the
 * pipeline works on real data, this module:
 *  - reads the dev/holdout fixtures;
 *  - computes a *fake* but deterministic embedding for each note
 *    (derived from the bag of words of the body);
 *  - reports the top-K similar pairs across the corpus.
 *
 * The fake embedding is intentionally simple (term-frequency
 * hash) — it is not a real model. The point is to exercise the
 * BruteForceIndex + cosine path end-to-end, not to deliver
 * semantic accuracy. When the operator activates a real model,
 * the same code path will work without changes.
 */

import { BruteForceIndex } from "./vector.js"
import { listMarkdownLocators } from "../classb/reachability.js"
import { readFileSync } from "node:fs"
import { join, isAbsolute } from "node:path"
import type { KnowledgeId, KnowledgeLocator } from "@unifia/contracts/knowledge"

export interface SimilarityPair {
  a: KnowledgeId
  b: KnowledgeId
  cosine: number
}

const DIM = 32

/** A deterministic, bag-of-words hash into DIM dimensions. */
function fakeEmbed(text: string): Float32Array {
  const v = new Array<number>(DIM).fill(0)
  const tokens = text.toLowerCase().split(/[^a-z0-9à-ÿ]+/u).filter((t) => t.length > 2)
  for (const t of tokens) {
    let h = 5381
    for (let i = 0; i < t.length; i++) h = ((h * 33) + t.charCodeAt(i)) | 0
    const idx = Math.abs(h) % DIM
    const sign = ((h >>> 0) & 1) === 0 ? 1 : -1
    v[idx] = (v[idx] ?? 0) + sign
  }
  // Normalise to unit length so cosine is well-defined.
  let norm = 0
  for (const x of v) norm += x * x
  const n = Math.sqrt(norm)
  if (n > 0) for (let i = 0; i < DIM; i++) v[i] = (v[i] ?? 0) / n
  return new Float32Array(v)
}

export interface SimulateInput {
  vaultRoot: string
  /** Number of top-K similar pairs to report. */
  topK?: number
}

export interface SimulateReport {
  vaultRoot: string
  notes: number
  topPairs: SimilarityPair[]
  indexMs: number
  queryMs: number
}

export function simulateSimilarity(input: SimulateInput): SimulateReport {
  if (!isAbsolute(input.vaultRoot)) {
    throw new Error(`vaultRoot must be absolute, got ${input.vaultRoot}`)
  }
  const topK = input.topK ?? 5
  const t0 = Date.now()
  const locators = listMarkdownLocators(input.vaultRoot)
  const ids: KnowledgeId[] = []
  const vectors: Float32Array[] = []
  for (let i = 0; i < locators.length; i++) {
    const locator = locators[i]!
    let text: string
    try {
      text = readFileSync(join(input.vaultRoot, locator), "utf8")
    } catch {
      continue
    }
    ids.push(`emb-${i}` as KnowledgeId)
    vectors.push(fakeEmbed(text))
  }
  const indexMs = Date.now() - t0

  const t1 = Date.now()
  const idx = new BruteForceIndex()
  for (let i = 0; i < ids.length; i++) {
    idx.add({
      id: ids[i]!,
      locator: locators[i]! as KnowledgeLocator,
      vector: vectors[i]!,
    })
  }

  // For each note, query the topK+1 most similar (the first is
  // self, so we skip it). Collect pairs (i, j) where j > i to
  // avoid duplicates.
  const allPairs: SimilarityPair[] = []
  for (let i = 0; i < ids.length; i++) {
    const results = idx.query({ vector: vectors[i]!, topK: topK + 1 })
    for (const r of results) {
      const j = parseInt(String(r.id).replace(/^emb-/, ""), 10)
      if (Number.isNaN(j) || j <= i) continue
      allPairs.push({
        a: ids[i]!,
        b: ids[j]!,
        cosine: r.similarity,
      })
    }
  }
  allPairs.sort((x, y) => y.cosine - x.cosine)
  const topPairs = allPairs.slice(0, topK)
  const queryMs = Date.now() - t1

  return {
    vaultRoot: input.vaultRoot,
    notes: ids.length,
    topPairs,
    indexMs,
    queryMs,
  }
}
