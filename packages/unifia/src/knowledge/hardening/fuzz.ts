/* SPDX-License-Identifier: MIT */
/**
 * Fuzz parsers (P11.1).
 *
 * Per runbook §21 P11.1: fuzz every parser of external data.
 * V1: a small property-based fuzzer that drives the parser
 * with random mutations of the dev fixtures and asserts that
 * the parser either succeeds or fails with a typed error, but
 * never throws an uncaught exception.
 */

import { parseDocument } from "../parser/parser.js"
import { extractWikilinks } from "../parser/wikilinks.js"
import { chunkBody } from "../derived/indexer.js"
import { KnowledgeFailure } from "../domain/errors.js"

export interface FuzzResult {
  runs: number
  survived: number
  crashed: number
  /** Sample surviving input. */
  sampleSurvived: string | null
}

function mutate(input: string, rng: () => number): string {
  // Cheap PRNG (xorshift32).
  const ops = ["flip", "insert", "delete", "duplicate", "greek", "emoji"]
  const out: string[] = []
  for (let i = 0; i < input.length; i++) {
    if (rng() < 0.05) {
      const op = ops[Math.floor(rng() * ops.length)] ?? "flip"
      if (op === "flip") {
        out.push(String.fromCharCode(input.charCodeAt(i) ^ 0x20))
      } else if (op === "insert") {
        out.push(input[i] ?? "")
        out.push("X")
      } else if (op === "delete") {
        // skip
      } else if (op === "duplicate") {
        out.push(input[i] ?? "")
        out.push(input[i] ?? "")
      } else if (op === "greek") {
        out.push("ξ")
      } else {
        out.push("🚀")
      }
    } else {
      out.push(input[i] ?? "")
    }
  }
  return out.join("")
}

function xorshift32(seed: number): () => number {
  let s = seed || 1
  return () => {
    s ^= s << 13
    s ^= s >>> 17
    s ^= s << 5
    return ((s >>> 0) % 1_000_000) / 1_000_000
  }
}

export interface FuzzTarget {
  name: string
  run: (input: string) => void
}

export const FUZZ_TARGETS: FuzzTarget[] = [
  {
    name: "parseDocument",
    run: (s) => {
      try {
        parseDocument(s)
      } catch (err) {
        if (!(err instanceof KnowledgeFailure)) throw err
      }
    },
  },
  {
    name: "extractWikilinks",
    run: (s) => {
      extractWikilinks(s)
    },
  },
  {
    name: "chunkBody",
    run: (s) => {
      chunkBody(s, 64)
    },
  },
]

export function fuzz(seed: number, runs: number, target: FuzzTarget, sourceCorpus: string[]): FuzzResult {
  const rng = xorshift32(seed)
  let survived = 0
  let crashed = 0
  let sampleSurvived: string | null = null
  for (let i = 0; i < runs; i++) {
    const base = sourceCorpus[i % sourceCorpus.length] ?? ""
    const m = mutate(base, rng)
    try {
      target.run(m)
      survived++
      if (sampleSurvived === null) sampleSurvived = m
    } catch (_err) {
      crashed++
    }
  }
  return { runs, survived, crashed, sampleSurvived }
}
