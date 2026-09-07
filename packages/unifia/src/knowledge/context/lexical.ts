/* SPDX-License-Identifier: MIT */
/**
 * Lexical scoring and snippet extraction for V1 retrieval.
 *
 * V1 ships no FTS5 runtime (see ADR-KNOW-0008 and the status reported by
 * `knowledge status`, which reports `fts: false`). This module is the real,
 * bounded lexical fallback the router ranks with — deterministic, no index,
 * no network, and honest about being a linear scan.
 *
 * Every bound here is expressed in UTF-8 bytes, never characters: a budget
 * measured in `string.length` under-counts every non-ASCII note.
 */

/** Byte length of a string as it will be serialised. */
export function utf8Bytes(s: string): number {
  return Buffer.byteLength(s, "utf8")
}

/**
 * Truncate to at most `maxBytes` UTF-8 bytes without splitting a codepoint
 * or a surrogate pair.
 */
export function truncateUtf8(s: string, maxBytes: number): string {
  if (maxBytes <= 0) return ""
  if (utf8Bytes(s) <= maxBytes) return s
  const buf = Buffer.from(s, "utf8")
  let end = maxBytes
  // Walk back off a continuation byte (10xxxxxx) to a codepoint boundary.
  while (end > 0 && (buf[end] ?? 0) >= 0x80 && (buf[end] ?? 0) < 0xc0) end -= 1
  let out = buf.subarray(0, end).toString("utf8")
  // A lone surrogate can survive the byte cut; drop it.
  if (out.length > 0 && /[\uD800-\uDBFF]$/.test(out)) out = out.slice(0, -1)
  return out
}

/** Split text into lowercase search terms. */
export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^\p{L}\p{N}_-]+/u)
    .filter((t) => t.length > 0)
}

export interface ScoredFields {
  /** The note's locator, matched on as a title proxy. */
  locator: string
  /** The note body. */
  body: string
  /** Frontmatter tags. */
  tags: readonly string[]
}

/**
 * Relevance in [0, 1] for `terms` against a note.
 *
 * Every query term must appear somewhere (AND semantics) or the score is 0 —
 * otherwise a one-word overlap would make every note a hit, which is exactly
 * how a corpus returns the same count for two unrelated queries.
 *
 * Matches in the locator and in tags weigh more than matches in the body.
 */
export function scoreNote(terms: readonly string[], fields: ScoredFields): number {
  if (terms.length === 0) return 0

  const locatorTokens = new Set(tokenize(fields.locator))
  const tagTokens = new Set(fields.tags.flatMap((t) => tokenize(t)))
  const bodyTokens = tokenize(fields.body)
  const bodyCounts = new Map<string, number>()
  for (const t of bodyTokens) bodyCounts.set(t, (bodyCounts.get(t) ?? 0) + 1)

  let total = 0
  for (const term of terms) {
    const inLocator = locatorTokens.has(term)
    const inTags = tagTokens.has(term)
    const bodyHits = bodyCounts.get(term) ?? 0

    if (!inLocator && !inTags && bodyHits === 0) return 0

    let termScore = 0
    if (inLocator) termScore += 0.5
    if (inTags) termScore += 0.3
    if (bodyHits > 0) {
      // Saturating: the 20th occurrence must not outrank a title match.
      termScore += 0.2 * (1 - 1 / (1 + bodyHits))
    }
    total += Math.min(termScore, 1)
  }

  return Math.min(total / terms.length, 1)
}

/**
 * A snippet centred on the first query match, bounded to `maxBytes`.
 * Falls back to the head of the body when nothing matches.
 */
export function bestSnippet(
  body: string,
  terms: readonly string[],
  maxBytes: number,
): string {
  if (maxBytes <= 0) return ""
  const trimmed = body.trim()
  if (trimmed.length === 0) return ""

  const haystack = trimmed.toLowerCase()
  let at = -1
  for (const term of terms) {
    const found = haystack.indexOf(term)
    if (found !== -1 && (at === -1 || found < at)) at = found
  }
  if (at === -1) return truncateUtf8(trimmed, maxBytes)

  // Centre a window on the match; the byte cap is applied after slicing.
  const windowChars = Math.max(40, Math.floor(maxBytes / 2))
  const start = Math.max(0, at - Math.floor(windowChars / 2))
  const slice = trimmed.slice(start, start + windowChars * 2)
  const prefix = start > 0 ? "…" : ""
  return truncateUtf8(prefix + slice, maxBytes)
}
