/* SPDX-License-Identifier: MIT */
/**
 * Wikilink parser and structural slicer.
 *
 * Supported syntax:
 * - `[[target]]`             — simple link to `target`
 * - `[[target|alias]]`       — link to `target` rendered as `alias`
 * - `[[target#heading]]`     — link to a specific heading
 * - `[[target#heading|alias]]`
 *
 * Targets are NOT resolved here. Resolution lives in the source
 * layer (Personal, Project, External). The parser only extracts
 * the raw occurrences and the per-section headings.
 */

import { codeRanges, isInsideCode } from "./code-mask.js"

export interface Wikilink {
  /** Raw target, as written (may include `#heading`). */
  rawTarget: string
  /** Target part (without `#heading`). */
  target: string
  /** Optional heading anchor. */
  heading?: string
  /** Optional alias. */
  alias?: string
  /** 0-based character offset of the opening `[[` in the source. */
  start: number
  /** 0-based character offset just after the closing `]]`. */
  end: number
}

/**
 * `[` is excluded from the target as well as `]`.
 *
 * Without it, `[[[c]]]` yielded the target `[c` — a string no locator can ever
 * equal, so it became a permanently broken edge that `broken-links` reported
 * as a real finding. None of the four syntaxes documented above can produce a
 * target containing a bracket; excluding it makes the parser match its own
 * contract and resolves the nested form to `c`. Found by the parser fuzzer.
 */
const WIKILINK_RE = /\[\[([^[\]\n]+?)\]\]/g

function splitTarget(raw: string): { target: string; heading?: string } {
  const hash = raw.indexOf("#")
  if (hash === -1) return { target: raw.trim() }
  return { target: raw.slice(0, hash).trim(), heading: raw.slice(hash + 1).trim() }
}

export function extractWikilinks(body: string): Wikilink[] {
  const out: Wikilink[] = []
  const code = codeRanges(body)
  WIKILINK_RE.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = WIKILINK_RE.exec(body)) !== null) {
    const inner = m[1]
    if (inner === undefined) continue
    // A link written inside code is an example of the syntax, not an edge.
    if (isInsideCode(m.index, code)) continue
    const bar = inner.indexOf("|")
    let rawTarget: string
    let alias: string | undefined
    if (bar === -1) {
      rawTarget = inner
    } else {
      rawTarget = inner.slice(0, bar)
      alias = inner.slice(bar + 1)
    }
    const { target, heading } = splitTarget(rawTarget)
    if (target.length === 0) continue
    const wl: Wikilink = { rawTarget, target, start: m.index, end: m.index + m[0].length }
    if (heading !== undefined && heading.length > 0) wl.heading = heading
    if (alias !== undefined && alias.length > 0) wl.alias = alias
    out.push(wl)
  }
  return out
}

/** A heading block. */
export interface Heading {
  level: number
  text: string
  /** 0-based character offset of the leading `#`s. */
  start: number
  /** 0-based character offset just after the line ending. */
  end: number
}

const HEADING_RE = /^(#{1,6})\s+(.+?)\s*#*\s*$/gm

export function extractHeadings(body: string): Heading[] {
  const out: Heading[] = []
  const code = codeRanges(body)
  HEADING_RE.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = HEADING_RE.exec(body)) !== null) {
    const hashes = m[1]
    const text = m[2]
    if (hashes === undefined || text === undefined) continue
    // A `#` line inside a fence is a comment or a shell prompt, not a heading.
    if (isInsideCode(m.index, code)) continue
    out.push({
      level: hashes.length,
      text,
      start: m.index,
      end: m.index + m[0].length,
    })
  }
  return out
}

/** A structural section (block between two headings at the same level). */
export interface Section {
  level: number
  heading?: Heading
  body: string
  start: number
  end: number
}

export function sliceSections(body: string): Section[] {
  const headings = extractHeadings(body)
  if (headings.length === 0) {
    return [{ level: 0, body, start: 0, end: body.length }]
  }
  const out: Section[] = []
  const first = headings[0]
  if (first === undefined) {
    return [{ level: 0, body, start: 0, end: body.length }]
  }
  if (first.start > 0) {
    out.push({ level: 0, body: body.slice(0, first.start), start: 0, end: first.start })
  }
  for (let i = 0; i < headings.length; i++) {
    const h = headings[i]
    if (h === undefined) continue
    const next = headings[i + 1]
    const end = next !== undefined ? next.start : body.length
    out.push({ level: h.level, heading: h, body: body.slice(h.end, end), start: h.end, end })
  }
  return out
}

/** A fenced code block. */
export interface FencedBlock {
  language: string
  content: string
  start: number
  end: number
}

const FENCE_RE = /^(`{3,}|~{3,})([^\S\n]*)([^\n]*)\n([\s\S]*?)\n?\1[^\S\n]*$/gm

export function extractFences(body: string): FencedBlock[] {
  const out: FencedBlock[] = []
  FENCE_RE.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = FENCE_RE.exec(body)) !== null) {
    const lang = (m[3] ?? "").trim()
    const content = m[4] ?? ""
    out.push({ language: lang, content, start: m.index, end: m.index + m[0].length })
  }
  return out
}
