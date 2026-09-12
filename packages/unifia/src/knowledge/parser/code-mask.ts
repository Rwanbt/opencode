/* SPDX-License-Identifier: MIT */
/**
 * Code regions of a Markdown body.
 *
 * Wikilinks and headings written inside code are examples, not structure. This
 * module is the single place that decides what "inside code" means, so the
 * parser and the derived indexer cannot drift apart — they did: each carried
 * its own `[[...]]` regex and both indexed fenced examples as real edges.
 *
 * Covers fenced blocks (backtick or tilde, including a fence left unclosed at
 * end of document) and inline code spans.
 */

/** A half-open character range `[start, end)` of the body. */
export interface CodeRange {
  start: number
  end: number
}

/** Opening/closing fence marker: 3+ backticks or 3+ tildes, up to 3 spaces in. */
const FENCE_LINE = /^[^\S\n]{0,3}(`{3,}|~{3,})(.*)$/
/** A closing fence carries nothing but whitespace after the marker. */
const FENCE_CLOSE = /^[^\S\n]{0,3}(`{3,}|~{3,})[^\S\n]*$/

/** Ranges covered by fenced code blocks. */
function fencedRanges(body: string): CodeRange[] {
  const ranges: CodeRange[] = []
  const lines = body.split("\n")

  const lineStart: number[] = []
  let offset = 0
  for (const line of lines) {
    lineStart.push(offset)
    offset += line.length + 1
  }

  let open: { marker: string; length: number; start: number } | null = null

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? ""
    const start = lineStart[i] ?? 0

    if (open === null) {
      const m = FENCE_LINE.exec(line)
      const marker = m?.[1]
      if (marker === undefined) continue
      // A backtick fence's info string may not itself contain a backtick;
      // otherwise `` `a` `` on its own line would be read as a fence.
      const info = m?.[2] ?? ""
      if (marker[0] === "`" && info.includes("`")) continue
      open = { marker: marker[0] ?? "`", length: marker.length, start }
      continue
    }

    const c = FENCE_CLOSE.exec(line)
    const closer = c?.[1]
    if (closer !== undefined && closer[0] === open.marker && closer.length >= open.length) {
      ranges.push({ start: open.start, end: start + line.length })
      open = null
    }
  }

  // CommonMark: an unclosed fence runs to the end of the document. Masking to
  // EOF keeps a truncated note from leaking its examples as links.
  if (open !== null) ranges.push({ start: open.start, end: body.length })

  return ranges
}

/** Ranges covered by inline code spans, outside any fenced block. */
function inlineRanges(body: string, fenced: readonly CodeRange[]): CodeRange[] {
  const ranges: CodeRange[] = []
  const inFence = (index: number): boolean =>
    fenced.some((r) => index >= r.start && index < r.end)

  let i = 0
  while (i < body.length) {
    if (body[i] !== "`" || inFence(i)) {
      i += 1
      continue
    }
    let run = 0
    while (body[i + run] === "`") run += 1

    // Look for a closing run of exactly the same length.
    let j = i + run
    let closed = -1
    while (j < body.length) {
      if (body[j] !== "`") {
        j += 1
        continue
      }
      let closeRun = 0
      while (body[j + closeRun] === "`") closeRun += 1
      if (closeRun === run) {
        closed = j + closeRun
        break
      }
      j += closeRun
    }

    if (closed === -1) {
      // Unmatched run: not a span, skip past it.
      i += run
      continue
    }
    ranges.push({ start: i, end: closed })
    i = closed
  }

  return ranges
}

/**
 * All character ranges of `body` that are code and must not be scanned for
 * wikilinks or headings.
 */
export function codeRanges(body: string): CodeRange[] {
  const fenced = fencedRanges(body)
  return [...fenced, ...inlineRanges(body, fenced)].sort((a, b) => a.start - b.start)
}

/** True when `index` falls inside any of `ranges`. */
export function isInsideCode(index: number, ranges: readonly CodeRange[]): boolean {
  for (const r of ranges) {
    if (index < r.start) return false
    if (index < r.end) return true
  }
  return false
}
