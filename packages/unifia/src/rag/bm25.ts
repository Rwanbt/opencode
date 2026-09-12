/**
 * BM25 text search — zero external dependencies.
 * Provides keyword-based retrieval as a fallback when neural embeddings
 * are unavailable (no cloud API, no local embedding model).
 * Sufficient for "find the file that mentions BiquadFilter" level queries.
 */

const STOP_WORDS = new Set([
  "a", "an", "the", "and", "or", "but", "in", "on", "at", "to", "for",
  "of", "with", "by", "from", "is", "it", "as", "be", "was", "are",
  "been", "being", "have", "has", "had", "do", "does", "did", "will",
  "would", "could", "should", "may", "might", "shall", "can", "not",
  "no", "if", "then", "else", "this", "that", "these", "those", "we",
  "you", "he", "she", "they", "i", "me", "my", "our", "your", "its",
])

const TOKEN_RE = /[a-z0-9_]+/g

/** Tokenize text: lowercase, split on non-alphanum, filter stopwords and short tokens. */
export function tokenize(text: string): string[] {
  const matches = text.toLowerCase().match(TOKEN_RE)
  if (!matches) return []
  return matches.filter((t) => t.length >= 2 && !STOP_WORDS.has(t))
}

/** Compute term frequency map from token array. */
export function termFrequency(tokens: string[]): Record<string, number> {
  const tf: Record<string, number> = {}
  for (const t of tokens) {
    tf[t] = (tf[t] ?? 0) + 1
  }
  return tf
}

/**
 * Compute IDF for a term.
 * Formula: log((N - n + 0.5) / (n + 0.5) + 1) where N = total docs, n = docs containing term.
 */
export function computeIDF(docCount: number, totalDocs: number): number {
  return Math.log((totalDocs - docCount + 0.5) / (docCount + 0.5) + 1)
}

/**
 * Compute BM25 score for a document against a query.
 * @param queryTokens - tokenized query
 * @param docTF - term frequency map of the document
 * @param docLength - total token count in document
 * @param avgDocLength - average document length across corpus
 * @param idfMap - precomputed IDF values for query terms
 * @param k1 - term saturation parameter (default 1.5)
 * @param b - length normalization parameter (default 0.75)
 */
export function bm25Score(
  queryTokens: string[],
  docTF: Record<string, number>,
  docLength: number,
  avgDocLength: number,
  idfMap: Record<string, number>,
  k1 = 1.5,
  b = 0.75,
): number {
  let score = 0
  for (const term of queryTokens) {
    const tf = docTF[term] ?? 0
    if (tf === 0) continue
    const idf = idfMap[term] ?? 0
    const numerator = tf * (k1 + 1)
    const denominator = tf + k1 * (1 - b + b * (docLength / avgDocLength))
    score += idf * (numerator / denominator)
  }
  return score
}

/**
 * Compute IDF map for query terms against a corpus.
 * @param queryTokens - unique query terms
 * @param corpus - array of document TF maps
 */
export function computeIDFMap(
  queryTokens: string[],
  corpus: Record<string, number>[],
): Record<string, number> {
  const totalDocs = corpus.length
  const idfMap: Record<string, number> = {}
  for (const term of queryTokens) {
    let docCount = 0
    for (const docTF of corpus) {
      if (docTF[term]) docCount++
    }
    idfMap[term] = computeIDF(docCount, totalDocs)
  }
  return idfMap
}

export interface BM25Doc {
  id: string
  tf: Record<string, number>
  docLength: number
}

/**
 * Search a BM25 corpus and return top-K results sorted by score.
 */
export function searchBM25(
  query: string,
  docs: BM25Doc[],
  k: number,
): { id: string; score: number }[] {
  if (docs.length === 0) return []

  const queryTokens = [...new Set(tokenize(query))]
  if (queryTokens.length === 0) return []

  const avgDocLength = docs.reduce((sum, d) => sum + d.docLength, 0) / docs.length
  const idfMap = computeIDFMap(
    queryTokens,
    docs.map((d) => d.tf),
  )

  const scored = docs.map((doc) => ({
    id: doc.id,
    score: bm25Score(queryTokens, doc.tf, doc.docLength, avgDocLength, idfMap),
  }))

  scored.sort((a, b) => b.score - a.score)
  return scored.slice(0, k).filter((r) => r.score > 0)
}
