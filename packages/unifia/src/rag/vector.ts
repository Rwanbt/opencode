/**
 * Pure JS vector operations for cosine similarity search.
 * No native dependencies required — trades peak throughput for zero setup.
 * Sufficient for <100k embeddings typical in a single project.
 */

/** Cosine similarity between two Float32Arrays. Returns value in [-1, 1]. */
export function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length) throw new Error(`Dimension mismatch: ${a.length} vs ${b.length}`)
  let dot = 0
  let normA = 0
  let normB = 0
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i]
    normA += a[i] * a[i]
    normB += b[i] * b[i]
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB)
  return denom === 0 ? 0 : dot / denom
}

/** Serialize Float32Array to Buffer for SQLite BLOB storage. */
export function vectorToBuffer(vec: Float32Array): Buffer {
  return Buffer.from(vec.buffer, vec.byteOffset, vec.byteLength)
}

/** Deserialize Buffer from SQLite BLOB back to Float32Array. */
export function bufferToVector(buf: Buffer): Float32Array {
  const ab = new ArrayBuffer(buf.length)
  const view = new Uint8Array(ab)
  for (let i = 0; i < buf.length; i++) view[i] = buf[i]
  return new Float32Array(ab)
}

/** Find top-K most similar vectors by cosine similarity. */
export function topK(
  query: Float32Array,
  candidates: { id: string; vector: Float32Array }[],
  k: number,
): { id: string; score: number }[] {
  const scored = candidates.map((c) => ({
    id: c.id,
    score: cosineSimilarity(query, c.vector),
  }))
  scored.sort((a, b) => b.score - a.score)
  return scored.slice(0, k)
}
