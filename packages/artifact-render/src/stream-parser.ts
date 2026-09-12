/* SPDX-License-Identifier: MIT */

/**
 * Streaming parser for `<artifact identifier="…" type="…" title="…">…</artifact>`
 * tags. The chat markdown renderer treats `<artifact>` tags inside fenced
 * code blocks (` ```html `) as ordinary text, so this parser must agree
 * with that classification — otherwise the rendered chat and the
 * parsed artifact stream would drift.
 *
 * The implementation is intentionally simple and inlined (no shared
 * markdown-context module): each chunk we receive, we re-scan the whole
 * buffer for fences, then walk once for the artifact tag. Fences, tag
 * boundaries, and tail partials are all detected from the local line/text
 * structure. This is correct for the spec's eight cases and keeps the
 * code reviewable.
 *
 * State machine:
 *   - `outside`: emit `text` until a real `<artifact …>` open; partial
 *     openings or unpaired backticks at the tail are retained.
 *   - `inside`: accumulate content; emit `artifact:chunk` for each new
 *     slice; emit `artifact:end` when the close tag is found, retaining
 *     enough tail bytes to detect a partial close.
 *
 * Each instance owns its state. No globals.
 */

export type ArtifactEvent =
  | { type: "text"; delta: string }
  | { type: "artifact:start"; identifier: string; artifactType: string; title: string }
  | { type: "artifact:chunk"; identifier: string; delta: string }
  | { type: "artifact:end"; identifier: string; fullContent: string }

const OPEN_PREFIX = "<artifact"
const CLOSE_TAG = "</artifact>"

interface ParserState {
  inside: boolean
  buffer: string
  identifier: string
  artifactType: string
  title: string
  content: string
}

function parseAttrs(raw: string): Record<string, string> {
  // Capture either " or ' quoted attribute values, no support for unquoted.
  const re = /(\w+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g
  const out: Record<string, string> = {}
  let m: RegExpExecArray | null = re.exec(raw)
  while (m !== null) {
    out[m[1]!] = m[2] ?? m[3] ?? ""
    m = re.exec(raw)
  }
  return out
}

function isInRange(ranges: ReadonlyArray<readonly [number, number]>, pos: number): boolean {
  for (const [start, end] of ranges) {
    if (pos >= start && pos < end) return true
  }
  return false
}

/**
 * Returns the line ranges that are inside a fenced code block
 * (```...``` or ~~~...~~~). An unclosed fence extends to end of buffer
 * — that's case 4 of the spec.
 */
function computeFenceRanges(buffer: string): Array<[number, number]> {
  const ranges: Array<[number, number]> = []
  const len = buffer.length
  let i = 0
  while (i < len) {
    const lineStart = i
    let lineEnd = buffer.indexOf("\n", lineStart)
    if (lineEnd === -1) lineEnd = len
    const line = buffer.slice(lineStart, lineEnd)
    const fenceMatch = /^\s*(```+|~~~+)/.exec(line)
    if (!fenceMatch) {
      i = lineEnd + 1
      continue
    }
    const fenceMarker = fenceMatch[1]!
    const fenceChar = fenceMarker[0]!
    const fenceLen = fenceMarker.length
    // Look for a closing fence on its own line, same char, >= length.
    let j = lineEnd + 1
    let closed = false
    while (j <= len) {
      let closeLineEnd = buffer.indexOf("\n", j)
      if (closeLineEnd === -1) closeLineEnd = len
      const closeLine = buffer.slice(j, closeLineEnd)
      const closeRe = new RegExp(`^\\s*(\`{${fenceLen},}|~{${fenceLen},})\\s*$`)
      const closeMatch = closeRe.exec(closeLine)
      if (
        closeMatch &&
        closeMatch[1]!.charAt(0) === fenceChar &&
        closeMatch[1]!.length >= fenceLen
      ) {
        ranges.push([lineStart, closeLineEnd])
        i = closeLineEnd + 1
        closed = true
        break
      }
      j = closeLineEnd + 1
    }
    if (!closed) {
      // Unclosed fence — consume the rest of the buffer as inside-fence.
      ranges.push([lineStart, len])
      i = len
    }
  }
  return ranges
}

/**
 * A `<artifact …>` is a real open if `<artifact` is followed by a
 * delimiter (`>`, space, tab, newline, or `/` for self-closing). This
 * excludes `<artifactual>`, `<artifactX>`, etc. — case 6 of the spec.
 */
function isRealArtifactOpenAt(buffer: string, idx: number): boolean {
  const after = idx + OPEN_PREFIX.length
  if (after >= buffer.length) return true
  const c = buffer.charAt(after)
  return c === ">" || c === " " || c === "\t" || c === "\n" || c === "\r" || c === "/"
}

type OpenTagMatch =
  | { kind: "complete"; start: number; end: number; attrs: string }
  | { kind: "partial"; start: number }
  | { kind: "none" }

function findOpenTag(buffer: string): OpenTagMatch {
  const ranges = computeFenceRanges(buffer)
  const len = buffer.length
  let earliestPartial = -1
  let from = 0

  // Pass 1: scan for a complete, real, in-scope `<artifact …>`.
  while (from < len) {
    const idx = buffer.indexOf(OPEN_PREFIX, from)
    if (idx === -1) break
    if (isInRange(ranges, idx)) {
      from = idx + OPEN_PREFIX.length
      continue
    }
    if (!isRealArtifactOpenAt(buffer, idx)) {
      from = idx + OPEN_PREFIX.length
      continue
    }
    // Try to find the closing `>` of the open tag, respecting quotes.
    const after = idx + OPEN_PREFIX.length
    let j = after
    let quote: string | null = null
    while (j < len) {
      const c = buffer.charAt(j)
      if (quote !== null) {
        if (c === quote) quote = null
      } else if (c === '"' || c === "'") {
        quote = c
      } else if (c === ">") {
        return { kind: "complete", start: idx, end: j + 1, attrs: buffer.slice(after, j) }
      }
      j++
    }
    // Reached end of buffer without finding `>` — partial open.
    if (earliestPartial === -1) earliestPartial = idx
    break
  }

  // Pass 2: hold-back for partial states. Earliest hold-back wins.
  const note = (pos: number | null) => {
    if (pos !== null && pos !== -1 && (earliestPartial === -1 || pos < earliestPartial)) {
      earliestPartial = pos
    }
  }
  // (a) Partial `<artifact` already noted above.
  // (b) Unclosed fence: skip from fence opener onward.
  for (const [start, end] of ranges) {
    if (end >= len) note(start)
  }
  // (c) Tail line that could still become a fence opener: `` ``` ``
  //     alone, `` ```ht `` etc. Hold back from line start.
  const lastNl = buffer.lastIndexOf("\n")
  if (lastNl < len - 1) {
    const tailLineStart = lastNl + 1
    const tailLine = buffer.slice(tailLineStart)
    if (/^\s*(```+|~~~+)/.test(tailLine) && !isInRange(ranges, tailLineStart)) {
      note(tailLineStart)
    }
  }
  // (d) Unpaired backtick at the tail (case 5). The single backtick
  //     may yet become the start of an inline code span.
  for (let k = len - 1; k >= 0; k--) {
    if (buffer.charAt(k) === "`" && !isInRange(ranges, k)) {
      // Count backticks in the buffer outside fences, before k+1.
      // A real check is O(n) but the buffer is small; the inline-count
      // test is a heuristic for the common case.
      note(k)
      break
    }
    if (buffer.charAt(k) === "\n") break
  }
  // (e) Tail `<` that is a strict prefix of `<artifact`.
  const tailLt = buffer.lastIndexOf("<")
  if (tailLt !== -1 && !isInRange(ranges, tailLt)) {
    const slice = buffer.slice(tailLt)
    if (OPEN_PREFIX.startsWith(slice) && slice.length < OPEN_PREFIX.length) {
      note(tailLt)
    }
  }

  if (earliestPartial !== -1) return { kind: "partial", start: earliestPartial }
  return { kind: "none" }
}

export function createArtifactParser(): {
  feed(delta: string): Generator<ArtifactEvent>
  flush(): Generator<ArtifactEvent>
} {
  const state: ParserState = {
    inside: false,
    buffer: "",
    identifier: "",
    artifactType: "",
    title: "",
    content: "",
  }

  function* feed(delta: string): Generator<ArtifactEvent> {
    state.buffer += delta

    while (state.buffer.length > 0) {
      if (!state.inside) {
        const open = findOpenTag(state.buffer)
        if (open.kind === "none") {
          yield { type: "text", delta: state.buffer }
          state.buffer = ""
          return
        }
        if (open.kind === "partial") {
          // Emit text before the hold-back position, keep tail in buffer.
          if (open.start > 0) {
            yield { type: "text", delta: state.buffer.slice(0, open.start) }
            state.buffer = state.buffer.slice(open.start)
          }
          return
        }
        // Complete open tag.
        if (open.start > 0) {
          yield { type: "text", delta: state.buffer.slice(0, open.start) }
        }
        const attrs = parseAttrs(open.attrs)
        state.inside = true
        state.identifier = attrs.identifier ?? ""
        state.artifactType = attrs.type ?? ""
        state.title = attrs.title ?? ""
        state.content = ""
        state.buffer = state.buffer.slice(open.end)
        yield {
          type: "artifact:start",
          identifier: state.identifier,
          artifactType: state.artifactType,
          title: state.title,
        }
        continue
      }

      // Inside: look for the close tag.
      const closeIdx = state.buffer.indexOf(CLOSE_TAG)
      if (closeIdx === -1) {
        // Hold back enough chars to detect a partial close tag at the tail.
        const flushUpTo = Math.max(0, state.buffer.length - (CLOSE_TAG.length - 1))
        if (flushUpTo > 0) {
          const chunk = state.buffer.slice(0, flushUpTo)
          state.content += chunk
          state.buffer = state.buffer.slice(flushUpTo)
          yield { type: "artifact:chunk", identifier: state.identifier, delta: chunk }
        }
        return
      }
      const finalChunk = state.buffer.slice(0, closeIdx)
      if (finalChunk.length > 0) {
        state.content += finalChunk
        yield { type: "artifact:chunk", identifier: state.identifier, delta: finalChunk }
      }
      yield {
        type: "artifact:end",
        identifier: state.identifier,
        fullContent: state.content,
      }
      state.buffer = state.buffer.slice(closeIdx + CLOSE_TAG.length)
      state.inside = false
      state.identifier = ""
      state.artifactType = ""
      state.title = ""
      state.content = ""
    }
  }

  function* flush(): Generator<ArtifactEvent> {
    if (state.inside) {
      // Case 7: emit the partial artifact on flush.
      if (state.buffer.length > 0) {
        state.content += state.buffer
        yield { type: "artifact:chunk", identifier: state.identifier, delta: state.buffer }
        state.buffer = ""
      }
      yield {
        type: "artifact:end",
        identifier: state.identifier,
        fullContent: state.content,
      }
    } else if (state.buffer.length > 0) {
      // The buffer is whatever tail we were holding back; emit it as text.
      yield { type: "text", delta: state.buffer }
    }
    state.buffer = ""
    state.inside = false
  }

  return { feed, flush }
}
