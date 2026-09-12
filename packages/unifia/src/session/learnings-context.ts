/**
 * Direct learnings injection fallback when RAG is not active.
 * Reads the most recent learnings/*.md files from the project config
 * directories and formats them for system prompt injection.
 */
import fs from "node:fs"
import path from "node:path"
import { ConfigPaths } from "../config/paths"

/**
 * Read recent learnings from disk and format for system prompt injection.
 * @param worktree - project root directory
 * @param budgetTokens - max tokens to spend on learnings
 * @returns formatted learnings block or undefined if none available
 */
export function readRecentLearnings(worktree: string, budgetTokens: number): string | undefined {
  if (budgetTokens <= 0) return undefined

  // Both brands: learnings written before the rename live under `.opencode`,
  // and dropping them would silently empty a user's accumulated context.
  const dirs = [
    path.join(worktree, ConfigPaths.LEGACY_PROJECT_DIRECTORY, "learnings"),
    path.join(worktree, ConfigPaths.PROJECT_DIRECTORY, "learnings"),
  ]
  const files = dirs.flatMap((dir) => {
    try {
      return fs
        .readdirSync(dir)
        .filter((name) => name.endsWith(".md"))
        .map((name) => ({ name, filepath: path.join(dir, name) }))
    } catch {
      return []
    }
  })

  if (files.length === 0) return undefined

  // By filename (YYYY-MM-DD prefix) descending — most recent first, across both
  // directories. Sorting full paths instead would order by directory and put
  // every legacy learning ahead of every current one.
  files.sort((a, b) => b.name.localeCompare(a.name))

  const budgetChars = budgetTokens * 4
  let content = ""
  for (const file of files.slice(0, 5)) {
    try {
      const text = fs.readFileSync(file.filepath, "utf-8")
      if (content.length + text.length > budgetChars) break
      content += text + "\n---\n"
    } catch {
    }
  }

  if (!content.trim()) return undefined
  return `<learnings>\nPrevious session learnings:\n\n${content.trim()}\n</learnings>`
}
