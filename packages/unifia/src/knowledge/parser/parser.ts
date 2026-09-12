/* SPDX-License-Identifier: MIT */
/**
 * Top-level Markdown parser for knowledge notes.
 *
 * Combines:
 * - frontmatter (YAML) via `gray-matter`,
 * - wikilink extraction,
 * - heading extraction,
 * - structural section slicing,
 * - fenced code block extraction.
 *
 * Pure: no I/O, no side effects. Tests pass strings in, get a
 * `ParsedDocument` back.
 */

import { parseFrontmatter, type ParsedNote } from "./frontmatter.js"
import {
  extractWikilinks,
  extractHeadings,
  sliceSections,
  extractFences,
  type Wikilink,
  type Heading,
  type Section,
  type FencedBlock,
} from "./wikilinks.js"

export interface ParsedDocument {
  note: ParsedNote
  wikilinks: Wikilink[]
  headings: Heading[]
  sections: Section[]
  fences: FencedBlock[]
  /** Total byte length of the raw document. */
  rawBytes: number
  /** Total byte length of the body (after frontmatter). */
  bodyBytes: number
}

export function parseDocument(raw: string): ParsedDocument {
  const note = parseFrontmatter(raw)
  const wikilinks = extractWikilinks(note.body)
  const headings = extractHeadings(note.body)
  const sections = sliceSections(note.body)
  const fences = extractFences(note.body)
  return {
    note,
    wikilinks,
    headings,
    sections,
    fences,
    rawBytes: Buffer.byteLength(raw, "utf8"),
    bodyBytes: Buffer.byteLength(note.body, "utf8"),
  }
}
