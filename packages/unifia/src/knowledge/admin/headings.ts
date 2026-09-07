/* SPDX-License-Identifier: MIT */
/**
 * Headings lister (P11.29).
 *
 * Given a locator, reads the note, parses it, and returns the
 * ordered list of headings (level + text + line).
 *
 * Pure / read-only.
 */

import { extractHeadings } from "../parser/wikilinks.js"
import { readFileSync, existsSync } from "node:fs"
import { join, isAbsolute } from "node:path"

export interface HeadingRow {
  level: number
  text: string
  /** 1-indexed line number in the source file. */
  line: number
}

export interface ListHeadingsInput {
  workspaceRoot: string
  /** The locator relative to workspaceRoot. */
  locator: string
}

export function listHeadings(input: ListHeadingsInput): HeadingRow[] {
  if (!isAbsolute(input.workspaceRoot)) {
    throw new Error(`workspaceRoot must be absolute, got ${input.workspaceRoot}`)
  }
  const full = join(input.workspaceRoot, input.locator)
  if (!existsSync(full)) {
    throw new Error(`note not found: ${input.locator}`)
  }
  const text = readFileSync(full, "utf8")
  // Compute the line number for each heading by scanning the
  // original text. The parser's headings already give us the
  // text and level; we only need the line number.
  const lineStarts: number[] = []
  for (let i = 0; i <= text.length; i++) {
    if (i === 0 || text[i - 1] === "\n") lineStarts.push(i)
  }
  const findLine = (offset: number): number => {
    let lo = 0
    let hi = lineStarts.length - 1
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1
      if (lineStarts[mid]! <= offset) lo = mid
      else hi = mid - 1
    }
    return lo + 1
  }
  const headings = extractHeadings(text)
  return headings.map((h) => ({
    level: h.level,
    text: h.text,
    line: findLine(h.start),
  }))
}
