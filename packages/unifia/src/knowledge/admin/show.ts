/* SPDX-License-Identifier: MIT */
/**
 * Note display (P11.31).
 *
 * Given a locator, reads the note and returns its full text
 * (frontmatter + body). The operator can use this to inspect
 * a note from the CLI without opening an editor.
 *
 * Pure / read-only.
 */

import { readFileSync, existsSync } from "node:fs"
import { join, isAbsolute } from "node:path"

export interface ShowInput {
  workspaceRoot: string
  locator: string
}

export function showNote(input: ShowInput): string {
  if (!isAbsolute(input.workspaceRoot)) {
    throw new Error(`workspaceRoot must be absolute, got ${input.workspaceRoot}`)
  }
  const full = join(input.workspaceRoot, input.locator)
  if (!existsSync(full)) {
    throw new Error(`note not found: ${input.locator}`)
  }
  return readFileSync(full, "utf8")
}
