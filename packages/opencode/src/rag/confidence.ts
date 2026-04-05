/**
 * Confidence scoring and temporal decay for RAG embeddings.
 *
 * Each embedding gets a confidence score based on its source and age.
 * Scores decay exponentially over time, ensuring fresh content ranks higher.
 */
import { Log } from "../util/log"

const log = Log.create({ service: "rag.confidence" })

/** Half-life in days for different source types. */
const HALF_LIFE: Record<string, number> = {
  file: 30, // Code files stay relevant longer
  summary: 14, // Session summaries decay faster
  learning: 60, // Lessons learned are long-lived
}

/** Base confidence scores by source type. */
const BASE_CONFIDENCE: Record<string, number> = {
  file: 0.8,
  summary: 0.7,
  learning: 0.9, // Lessons are explicitly extracted, higher quality
}

/**
 * Calculate confidence score for an embedding.
 * Combines base confidence with temporal decay.
 *
 * @param sourceType - "file", "summary", or "learning"
 * @param createdAt - Timestamp when the embedding was created (ms)
 * @param now - Current timestamp (ms), defaults to Date.now()
 * @returns Score in [0, 1]
 */
export function confidence(sourceType: string, createdAt: number, now?: number): number {
  const current = now ?? Date.now()
  const ageMs = Math.max(0, current - createdAt)
  const ageDays = ageMs / (1000 * 60 * 60 * 24)

  const base = BASE_CONFIDENCE[sourceType] ?? 0.5
  const halfLife = HALF_LIFE[sourceType] ?? 30

  // Exponential decay: score = base * 2^(-age/halfLife)
  const decay = Math.pow(2, -ageDays / halfLife)
  return base * decay
}

/**
 * Adjust similarity scores with confidence weighting.
 * Final score = similarity * confidence_weight
 *
 * @param results - Search results with scores
 * @param weight - How much confidence affects ranking (0 = ignore, 1 = full weight)
 */
export function adjustScores(
  results: { id: string; score: number; sourceType: string; createdAt: number }[],
  weight: number = 0.3,
): { id: string; adjustedScore: number; confidence: number; originalScore: number }[] {
  return results
    .map((r) => {
      const conf = confidence(r.sourceType, r.createdAt)
      const adjustedScore = r.score * (1 - weight) + r.score * conf * weight
      return {
        id: r.id,
        adjustedScore,
        confidence: conf,
        originalScore: r.score,
      }
    })
    .sort((a, b) => b.adjustedScore - a.adjustedScore)
}
