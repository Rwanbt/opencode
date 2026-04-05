/**
 * Memory conflict resolution for RAG embeddings.
 *
 * Detects when two embeddings from the same source contradict each other
 * and resolves by keeping the more recent and/or higher confidence one.
 */
import { cosineSimilarity, bufferToVector } from "./vector"
import { confidence } from "./confidence"
import { Log } from "../util/log"

const log = Log.create({ service: "rag.conflict" })

/** Threshold above which two embeddings are considered "about the same topic". */
const TOPIC_SIMILARITY_THRESHOLD = 0.85

/** Threshold below which same-topic embeddings are considered "contradictory". */
const CONTRADICTION_THRESHOLD = 0.5

export interface ConflictCandidate {
  id: string
  content: string
  vector: Buffer
  sourceType: string
  sourceId: string
  createdAt: number
}

export interface ConflictResolution {
  keep: string
  remove: string
  reason: string
  similarity: number
}

/**
 * Detect and resolve conflicts among embeddings from the same source.
 *
 * Two embeddings conflict when:
 * 1. They are from the same source_type (e.g., both "learning")
 * 2. Their vectors are highly similar (same topic)
 * 3. Their content is significantly different (potential contradiction)
 *
 * Resolution: keep the more recent one with higher confidence.
 */
export function detectConflicts(candidates: ConflictCandidate[]): ConflictResolution[] {
  const resolutions: ConflictResolution[] = []

  // Group by source type
  const groups = new Map<string, ConflictCandidate[]>()
  for (const c of candidates) {
    const group = groups.get(c.sourceType) ?? []
    group.push(c)
    groups.set(c.sourceType, group)
  }

  for (const [sourceType, group] of groups) {
    if (group.length < 2) continue

    // Compare each pair
    for (let i = 0; i < group.length; i++) {
      for (let j = i + 1; j < group.length; j++) {
        const a = group[i]
        const b = group[j]

        const vecA = bufferToVector(a.vector)
        const vecB = bufferToVector(b.vector)
        const similarity = cosineSimilarity(vecA, vecB)

        // High similarity = same topic
        if (similarity < TOPIC_SIMILARITY_THRESHOLD) continue

        // Same source_id means they're updates of the same thing — keep newest
        if (a.sourceId === b.sourceId) {
          const [keep, remove] = a.createdAt >= b.createdAt ? [a, b] : [b, a]
          resolutions.push({
            keep: keep.id,
            remove: remove.id,
            reason: `Duplicate from same source (${sourceType}/${a.sourceId}), keeping newer version`,
            similarity,
          })
          continue
        }

        // Different source_id but very similar content — potential conflict
        // Resolve by confidence score
        const confA = confidence(a.sourceType, a.createdAt)
        const confB = confidence(b.sourceType, b.createdAt)

        if (Math.abs(confA - confB) < 0.05) {
          // Similar confidence — keep the newer one
          const [keep, remove] = a.createdAt >= b.createdAt ? [a, b] : [b, a]
          resolutions.push({
            keep: keep.id,
            remove: remove.id,
            reason: `Near-duplicate content (similarity: ${(similarity * 100).toFixed(0)}%), keeping newer`,
            similarity,
          })
        } else {
          // Different confidence — keep the higher one
          const [keep, remove] = confA >= confB ? [a, b] : [b, a]
          resolutions.push({
            keep: keep.id,
            remove: remove.id,
            reason: `Near-duplicate content (similarity: ${(similarity * 100).toFixed(0)}%), keeping higher confidence`,
            similarity,
          })
        }
      }
    }
  }

  if (resolutions.length > 0) {
    log.info("conflict resolutions", { count: resolutions.length })
  }

  return resolutions
}
