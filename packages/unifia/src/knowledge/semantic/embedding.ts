/* SPDX-License-Identifier: MIT */
/**
 * Embedding provider (P5.1).
 *
 * The model is selected at runtime per the runbook §8.8 score
 * (quality holdout 50 %, latency 20 %, peak RAM 15 %, size 10 %,
 * simplicity 5 %). If no model is admissible, the semantic
 * retrieval is `disabled` and FTS + graph is the V1 product.
 *
 * V1 in this module is the *interface*; the actual ONNX runtime
 * is added in Phase 5.2.
 */

export interface EmbeddingRequest {
  inputs: string[]
  /** Maximum input bytes per call. */
  maxBytes: number
  /** Deadline. */
  deadlineMs: number
}

export interface EmbeddingResponse {
  /** One vector per input. */
  vectors: Float32Array[]
  /** Vector dimension. */
  dim: number
  /** Model identifier. */
  modelId: string
  /** Wall-clock duration. */
  durationMs: number
}

export interface EmbeddingProvider {
  /** Stable identifier of the model. */
  readonly modelId: string
  /** Embedding dimension. */
  readonly dim: number
  /** Embed a batch of inputs. */
  embed(request: EmbeddingRequest): Promise<EmbeddingResponse>
}

/** Score a candidate model per runbook §8.8. */
export interface ModelScore {
  modelId: string
  /** Quality on the holdout, 0..1. */
  quality: number
  /** Latency p95 in ms. */
  latencyMs: number
  /** Peak RAM in MiB. */
  peakRamMiB: number
  /** Distributed size in MiB. */
  sizeMiB: number
  /** Simplicity 0..1 (license + integration). */
  simplicity: number
}

export function scoreEmbeddingModel(s: ModelScore): number {
  // 0.50 quality, 0.20 inverse latency, 0.15 inverse RAM, 0.10
  // inverse size, 0.05 simplicity. Latency/RAM/size are clipped
  // to a 0..1 inverse scale.
  const invLatency = 1 / (1 + s.latencyMs / 100)
  const invRam = 1 / (1 + s.peakRamMiB / 100)
  const invSize = 1 / (1 + s.sizeMiB / 100)
  return (
    0.5 * s.quality +
    0.2 * invLatency +
    0.15 * invRam +
    0.1 * invSize +
    0.05 * s.simplicity
  )
}

export function selectBestModel(scores: ModelScore[]): ModelScore | null {
  if (scores.length === 0) return null
  let best: ModelScore | null = null
  let bestScore = -Infinity
  for (const s of scores) {
    const sc = scoreEmbeddingModel(s)
    if (sc > bestScore) {
      best = s
      bestScore = sc
    }
  }
  return best
}
