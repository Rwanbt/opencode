import fs from "fs"
import path from "path"
import { Glob } from "../util/glob"
import { FileIgnore } from "../file/ignore"
import { Log } from "../util/log"
import type { Provider } from "../provider/provider"

const log = Log.create({ service: "project-context" })

// Language-specific declaration patterns
const DECLARATION_PATTERNS: Record<string, RegExp> = {
  ".rs": /^pub\s+(fn|struct|enum|trait|type|mod)\s+(\w+)/,
  ".ts": /^export\s+(function|class|interface|type|const|enum)\s+(\w+)/,
  ".tsx": /^export\s+(function|class|interface|type|const|enum)\s+(\w+)/,
  ".js": /^export\s+(function|class|const|let)\s+(\w+)/,
  ".jsx": /^export\s+(function|class|const|let)\s+(\w+)/,
  ".mjs": /^export\s+(function|class|const|let)\s+(\w+)/,
  ".py": /^(def|class)\s+(\w+)/,
  ".go": /^(func|type|package)\s+(\w+)/,
  ".c": /^(?:static\s+|extern\s+)?(?:void|int|char|float|double|unsigned|long|short|struct|enum)\s+\*?(\w+)\s*\(/,
  ".h": /^(?:typedef\s+)?(?:void|int|char|float|double|unsigned|long|short|struct|enum)\s+\*?(\w+)/,
  ".cpp": /^(?:class|struct|enum|namespace|template|void|int|auto)\s+(\w+)/,
  ".hpp": /^(?:class|struct|enum|namespace|template|void|int|auto)\s+(\w+)/,
}

const SOURCE_EXTENSIONS = new Set(Object.keys(DECLARATION_PATTERNS))

// Additional source extensions we list but don't extract declarations from
const EXTRA_SOURCE_EXTENSIONS = new Set([
  ".json",
  ".toml",
  ".yaml",
  ".yml",
  ".md",
  ".css",
  ".scss",
  ".html",
  ".sql",
  ".sh",
  ".bash",
])

interface FileInfo {
  relativePath: string
  absolutePath: string
  lines: number
}

interface FileSymbols {
  file: FileInfo
  declarations: { kind: string; name: string; line: string }[]
}

export namespace ProjectContext {
  /**
   * Build a compact project context string for system prompt injection.
   * Returns undefined if the project is empty or budget is 0.
   *
   * @param dir - project working directory
   * @param model - the model (used for context size budget)
   * @param systemTokensUsed - approximate token count of system prompt BEFORE project context
   */
  export async function build(
    dir: string,
    model: Provider.Model,
    systemTokensUsed: number,
  ): Promise<string | undefined> {
    const budget = calculateBudget(model, systemTokensUsed)
    if (budget <= 0) return undefined

    const files = await scanFiles(dir)
    if (files.length === 0) return undefined

    const symbols = await extractAllDeclarations(files)
    const formatted = format(symbols, budget)
    if (!formatted) return undefined

    log.info("project-context", {
      budget,
      files: files.length,
      contextSize: model.limit.context,
      systemTokensUsed,
      resultLength: formatted.length,
    })

    return formatted
  }

  /**
   * Calculate the token budget for project context.
   * Based on model context size minus reserved conversation space minus current system tokens.
   */
  function calculateBudget(model: Provider.Model, systemTokensUsed: number): number {
    const contextSize = model.limit.context
    const reserveForConversation = Math.floor(contextSize * 0.85)
    const available = contextSize - reserveForConversation - systemTokensUsed
    // Cap at 2000 tokens — beyond that it's noise
    return Math.max(0, Math.min(available, 2000))
  }

  /**
   * Scan project directory for source files.
   * Returns files sorted by modification time (most recent first), limited to 50.
   */
  async function scanFiles(dir: string): Promise<FileInfo[]> {
    let allFiles: string[]
    try {
      allFiles = await Glob.scan("**/*", {
        cwd: dir,
        absolute: false,
      })
    } catch {
      return []
    }

    // Filter: source files, not ignored, < 500 lines
    const results: FileInfo[] = []
    for (const rel of allFiles) {
      const ext = path.extname(rel).toLowerCase()
      if (!SOURCE_EXTENSIONS.has(ext) && !EXTRA_SOURCE_EXTENSIONS.has(ext)) continue
      if (FileIgnore.match(rel)) continue

      const abs = path.join(dir, rel)
      try {
        const content = fs.readFileSync(abs, "utf-8")
        const lineCount = content.split("\n").length
        if (lineCount > 500) continue
        results.push({ relativePath: rel, absolutePath: abs, lines: lineCount })
      } catch {
        continue
      }
    }

    // Sort by modification time (most recent first), then take top 50
    results.sort((a, b) => {
      try {
        return fs.statSync(b.absolutePath).mtimeMs - fs.statSync(a.absolutePath).mtimeMs
      } catch {
        return 0
      }
    })

    return results.slice(0, 50)
  }

  /**
   * Extract declarations from all files using language-specific regex patterns.
   */
  async function extractAllDeclarations(files: FileInfo[]): Promise<FileSymbols[]> {
    const results: FileSymbols[] = []
    for (const file of files) {
      const ext = path.extname(file.relativePath).toLowerCase()
      const pattern = DECLARATION_PATTERNS[ext]
      if (!pattern) {
        // Non-extractable source file (json, toml, etc.) — include with no declarations
        results.push({ file, declarations: [] })
        continue
      }

      try {
        const content = fs.readFileSync(file.absolutePath, "utf-8")
        const declarations: { kind: string; name: string; line: string }[] = []
        for (const rawLine of content.split("\n")) {
          const line = rawLine.trimStart()
          const match = line.match(pattern)
          if (match) {
            // For most patterns: group 1 = kind, group 2 = name
            // For C/C++: only group 1 = name (kind embedded in pattern)
            const kind = match[2] ? match[1] : ""
            const name = match[2] ?? match[1]
            declarations.push({
              kind,
              name,
              line: rawLine.trim(),
            })
          }
        }
        results.push({ file, declarations })
      } catch {
        results.push({ file, declarations: [] })
      }
    }
    return results
  }

  /**
   * Format project context at the appropriate detail level for the given budget.
   * ~4 chars per token estimate.
   */
  function format(symbols: FileSymbols[], budgetTokens: number): string | undefined {
    const budgetChars = budgetTokens * 4

    // Level 1: files only (budget 50-150 tokens)
    const filesLine = symbols
      .filter((s) => SOURCE_EXTENSIONS.has(path.extname(s.file.relativePath).toLowerCase()) || s.declarations.length > 0)
      .map((s) => `${s.file.relativePath} (${s.file.lines}L)`)
      .join(", ")

    const level1 = `<project_context>\nFiles: ${filesLine}\n</project_context>`
    if (level1.length > budgetChars) {
      // Even file list doesn't fit — try truncating
      const truncated = symbols
        .filter((s) => SOURCE_EXTENSIONS.has(path.extname(s.file.relativePath).toLowerCase()))
        .slice(0, 10)
        .map((s) => `${s.file.relativePath} (${s.file.lines}L)`)
        .join(", ")
      const minimal = `<project_context>\nFiles: ${truncated}\n</project_context>`
      return minimal.length <= budgetChars ? minimal : undefined
    }

    if (budgetTokens < 150) return level1

    // Level 2: files + symbol names (budget 150-500 tokens)
    const symbolLines: string[] = []
    for (const s of symbols) {
      if (s.declarations.length === 0) continue
      const names = s.declarations.map((d) => d.name).join(", ")
      symbolLines.push(`  ${s.file.relativePath}: ${names}`)
    }

    const level2 = `<project_context>\nFiles: ${filesLine}\nKey symbols:\n${symbolLines.join("\n")}\n</project_context>`
    if (level2.length > budgetChars || budgetTokens < 500) {
      // Fits as level2? Return it if it fits
      return level2.length <= budgetChars ? level2 : level1
    }

    // Level 3: files + full declaration lines (budget 500-2000 tokens)
    const detailLines: string[] = []
    for (const s of symbols) {
      if (s.declarations.length === 0) continue
      const decls = s.declarations.map((d) => `    ${d.line}`).join("\n")
      detailLines.push(`  ${s.file.relativePath}:\n${decls}`)
    }

    const level3 = `<project_context>\nFiles: ${filesLine}\nDeclarations:\n${detailLines.join("\n")}\n</project_context>`
    return level3.length <= budgetChars ? level3 : level2
  }
}
