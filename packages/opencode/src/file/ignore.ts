import { sep } from "node:path"
import { extname, basename } from "node:path"
import { Glob } from "../util/glob"

export namespace FileIgnore {
  const FOLDERS = new Set([
    "node_modules",
    "bower_components",
    ".pnpm-store",
    "vendor",
    ".npm",
    "dist",
    "build",
    "out",
    ".next",
    "target",
    "bin",
    "obj",
    ".git",
    ".svn",
    ".hg",
    ".vscode",
    ".idea",
    ".turbo",
    ".output",
    "desktop",
    ".sst",
    ".cache",
    ".webkit-cache",
    "__pycache__",
    ".pytest_cache",
    "mypy_cache",
    ".history",
    ".gradle",
  ])

  /** Folder patterns matched by glob (for names like results-*) */
  const FOLDER_GLOBS = ["results-*"]

  const FILES = [
    "**/*.swp",
    "**/*.swo",

    "**/*.pyc",

    // OS
    "**/.DS_Store",
    "**/Thumbs.db",

    // Logs & temp
    "**/logs/**",
    "**/tmp/**",
    "**/temp/**",
    "**/*.log",

    // Coverage/test outputs
    "**/coverage/**",
    "**/.nyc_output/**",

    // Lock files
    "**/package-lock.json",
    "**/yarn.lock",
    "**/pnpm-lock.yaml",
    "**/bun.lockb",
    "**/bun.lock",
    "**/*.lock",

    // Source maps
    "**/*.map",

    // Binary files
    "**/*.png",
    "**/*.jpg",
    "**/*.jpeg",
    "**/*.gif",
    "**/*.bmp",
    "**/*.ico",
    "**/*.webp",
    "**/*.svg",
    "**/*.wasm",
    "**/*.so",
    "**/*.dll",
    "**/*.exe",
    "**/*.dylib",
    "**/*.a",
    "**/*.o",
    "**/*.obj",
    "**/*.gguf",
    "**/*.bin",
    "**/*.tar",
    "**/*.gz",
    "**/*.zip",
    "**/*.7z",
    "**/*.rar",
    "**/*.pdf",
    "**/*.ttf",
    "**/*.otf",
    "**/*.woff",
    "**/*.woff2",
    "**/*.mp3",
    "**/*.mp4",
    "**/*.wav",
    "**/*.avi",
    "**/*.mov",
  ]

  export const PATTERNS = [...FILES, ...FOLDERS]

  export function match(
    filepath: string,
    opts?: {
      extra?: string[]
      whitelist?: string[]
    },
  ) {
    for (const pattern of opts?.whitelist || []) {
      if (Glob.match(pattern, filepath)) return false
    }

    const parts = filepath.split(/[/\\]/)
    for (let i = 0; i < parts.length; i++) {
      if (FOLDERS.has(parts[i])) return true
      for (const glob of FOLDER_GLOBS) {
        if (Glob.match(glob, parts[i])) return true
      }
    }

    const extra = opts?.extra || []
    for (const pattern of [...FILES, ...extra]) {
      if (Glob.match(pattern, filepath)) return true
    }

    return false
  }

  // ─── Indexable file filter (shared by project-context & RAG) ──────────

  const SOURCE_EXTENSIONS = new Set([
    ".rs", ".ts", ".tsx", ".js", ".jsx", ".mjs", ".py", ".go",
    ".c", ".cpp", ".h", ".hpp", ".java", ".kt", ".swift",
    ".rb", ".php", ".vue", ".svelte", ".css", ".scss", ".html",
    ".sql", ".sh", ".bash",
  ])

  const CONFIG_EXTENSIONS = new Set([
    ".toml", ".yaml", ".yml", ".json", ".md", ".txt",
  ])

  /** Well-known config files that should always be indexable regardless of extension rules. */
  const ALWAYS_INDEX = new Set([
    "Cargo.toml", "package.json", "tsconfig.json", "Dockerfile",
    "Makefile", "CMakeLists.txt", "go.mod", "go.sum",
    "pyproject.toml", "setup.py", "setup.cfg",
  ])

  /**
   * Determine if a file should be indexed for RAG / project context.
   * Call AFTER `match()` to check ignore patterns — this only checks extension + size rules.
   *
   * @param relativePath - path relative to project root
   * @param lineCount - number of lines in the file
   * @param byteSize - optional file size in bytes (used for stricter JSON filtering)
   */
  export function isIndexable(relativePath: string, lineCount: number, byteSize?: number): boolean {
    const name = basename(relativePath)
    const ext = extname(relativePath).toLowerCase()

    // Always-index well-known config files (unless absurdly large)
    if (ALWAYS_INDEX.has(name)) return lineCount <= 500

    // Source code files
    if (SOURCE_EXTENSIONS.has(ext)) return lineCount <= 1000

    // JSON: line count AND byte size — dense JSON dumps are few lines but huge
    if (ext === ".json") return lineCount <= 100 && (byteSize === undefined || byteSize <= 10_000)

    // Config / text files with tighter limits
    if (ext === ".md" || ext === ".txt") return lineCount <= 500
    if (CONFIG_EXTENSIONS.has(ext)) return lineCount <= 500

    // Unknown extension — skip
    return false
  }
}
