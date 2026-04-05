/**
 * Text chunking strategies for RAG indexing.
 * Splits code and text into meaningful chunks for embedding.
 */
import { createHash } from "crypto"

const MAX_CHUNK_SIZE = 1500 // ~375 tokens at 4 chars/token
const OVERLAP = 200 // Character overlap between chunks

export interface Chunk {
  content: string
  hash: string
  metadata: Record<string, unknown>
}

/** Hash content for deduplication. */
export function hashContent(content: string): string {
  return createHash("sha256").update(content).digest("hex").slice(0, 16)
}

/**
 * Chunk a code file by top-level declarations (functions, classes, etc.)
 * Falls back to fixed-size chunking for non-structured content.
 */
export function chunkCode(
  content: string,
  filePath: string,
): Chunk[] {
  const lines = content.split("\n")
  if (lines.length <= 40) {
    // Small file — embed as single chunk
    const text = content.trim()
    if (!text) return []
    return [
      {
        content: `File: ${filePath}\n\n${text}`,
        hash: hashContent(text),
        metadata: { file: filePath, startLine: 1, endLine: lines.length },
      },
    ]
  }

  // Split by top-level declaration boundaries
  const chunks: Chunk[] = []
  const boundaries = findDeclarationBoundaries(lines)

  if (boundaries.length === 0) {
    // No declarations found — use fixed-size chunking
    return chunkText(content, { file: filePath })
  }

  for (const boundary of boundaries) {
    const text = lines.slice(boundary.start, boundary.end + 1).join("\n").trim()
    if (!text || text.length < 20) continue
    chunks.push({
      content: `File: ${filePath} (lines ${boundary.start + 1}-${boundary.end + 1})\n\n${text}`,
      hash: hashContent(text),
      metadata: {
        file: filePath,
        startLine: boundary.start + 1,
        endLine: boundary.end + 1,
        name: boundary.name,
        kind: boundary.kind,
      },
    })
  }

  return chunks
}

interface Boundary {
  start: number
  end: number
  name: string
  kind: string
}

/** Detect top-level declaration boundaries using regex heuristics. */
function findDeclarationBoundaries(lines: string[]): Boundary[] {
  const boundaries: Boundary[] = []
  const patterns = [
    // TypeScript/JavaScript
    { regex: /^(?:export\s+)?(?:async\s+)?(?:function|const|let|var)\s+(\w+)/, kind: "function" },
    { regex: /^(?:export\s+)?(?:abstract\s+)?class\s+(\w+)/, kind: "class" },
    { regex: /^(?:export\s+)?(?:type|interface)\s+(\w+)/, kind: "type" },
    { regex: /^(?:export\s+)?namespace\s+(\w+)/, kind: "namespace" },
    // Python
    { regex: /^(?:async\s+)?def\s+(\w+)/, kind: "function" },
    { regex: /^class\s+(\w+)/, kind: "class" },
    // Rust
    { regex: /^(?:pub\s+)?(?:async\s+)?fn\s+(\w+)/, kind: "function" },
    { regex: /^(?:pub\s+)?(?:struct|enum|trait|impl)\s+(\w+)/, kind: "type" },
    // Go
    { regex: /^func\s+(?:\([^)]+\)\s+)?(\w+)/, kind: "function" },
    { regex: /^type\s+(\w+)\s+(?:struct|interface)/, kind: "type" },
  ]

  let currentBoundary: Boundary | null = null

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const trimmed = line.trimStart()
    const indent = line.length - trimmed.length

    // Only match top-level declarations (indent 0 for most, 2 for namespace members)
    if (indent > 2) continue
    // Skip indented const/let/var — only match them at indent 0
    if (indent > 0 && /^\s*(?:const|let|var)\s/.test(line)) continue

    for (const pattern of patterns) {
      const match = trimmed.match(pattern.regex)
      if (match) {
        // Close previous boundary
        if (currentBoundary) {
          currentBoundary.end = i - 1
          // Find the actual end by trimming trailing blank lines
          while (currentBoundary.end > currentBoundary.start && !lines[currentBoundary.end].trim()) {
            currentBoundary.end--
          }
          boundaries.push(currentBoundary)
        }
        currentBoundary = { start: i, end: i, name: match[1], kind: pattern.kind }
        break
      }
    }
  }

  // Close last boundary
  if (currentBoundary) {
    currentBoundary.end = lines.length - 1
    while (currentBoundary.end > currentBoundary.start && !lines[currentBoundary.end].trim()) {
      currentBoundary.end--
    }
    boundaries.push(currentBoundary)
  }

  // Split boundaries that are too large
  const result: Boundary[] = []
  for (const boundary of boundaries) {
    const text = lines.slice(boundary.start, boundary.end + 1).join("\n")
    if (text.length <= MAX_CHUNK_SIZE) {
      result.push(boundary)
    } else {
      // Split large declarations into sub-chunks
      const subChunks = chunkText(text, {
        file: "",
        startLine: boundary.start + 1,
        name: boundary.name,
        kind: boundary.kind,
      })
      for (let j = 0; j < subChunks.length; j++) {
        result.push({
          start: boundary.start + j * Math.floor((boundary.end - boundary.start) / subChunks.length),
          end: Math.min(
            boundary.start + (j + 1) * Math.floor((boundary.end - boundary.start) / subChunks.length),
            boundary.end,
          ),
          name: `${boundary.name}[${j}]`,
          kind: boundary.kind,
        })
      }
    }
  }

  return result
}

/** Fixed-size chunking with overlap for unstructured text. */
export function chunkText(text: string, baseMetadata: Record<string, unknown> = {}): Chunk[] {
  const chunks: Chunk[] = []
  let offset = 0
  let index = 0

  while (offset < text.length) {
    const end = Math.min(offset + MAX_CHUNK_SIZE, text.length)
    const chunk = text.slice(offset, end)
    if (chunk.trim()) {
      chunks.push({
        content: chunk,
        hash: hashContent(chunk),
        metadata: { ...baseMetadata, chunkIndex: index },
      })
    }
    offset += MAX_CHUNK_SIZE - OVERLAP
    index++
  }

  return chunks
}
