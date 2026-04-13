/**
 * Direct learnings injection fallback when RAG is not active.
 * Reads the most recent .opencode/learnings/*.md files and formats
 * them for system prompt injection.
 */
import fs from "fs"
import path from "path"

/**
 * Read recent learnings from disk and format for system prompt injection.
 * @param worktree - project root directory
 * @param budgetTokens - max tokens to spend on learnings
 * @returns formatted learnings block or undefined if none available
 */
export function readRecentLearnings(worktree: string, budgetTokens: number): string | undefined {
  if (budgetTokens <= 0) return undefined

  const dir = path.join(worktree, ".opencode", "learnings")
  let files: string[]
  try {
    files = fs.readdirSync(dir).filter((f) => f.endsWith(".md"))
  } catch {
    return undefined
  }

  if (files.length === 0) return undefined

  // Sort by filename (YYYY-MM-DD prefix) descending — most recent first
  files.sort().reverse()

  const budgetChars = budgetTokens * 4
  let content = ""
  for (const file of files.slice(0, 5)) {
    try {
      const text = fs.readFileSync(path.join(dir, file), "utf-8")
      if (content.length + text.length > budgetChars) break
      content += text + "\n---\n"
    } catch {
      continue
    }
  }

  if (!content.trim()) return undefined
  return `<learnings>\nPrevious session learnings:\n\n${content.trim()}\n</learnings>`
}
