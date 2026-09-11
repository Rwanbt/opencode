/* SPDX-License-Identifier: MIT */

/** Pure Markdown presentation helpers for the read-only Memory inspector. */

export type MemoryNoteSummary = {
  readonly path: string
  readonly title: string
}

export type MemoryNoteDocument = MemoryNoteSummary & {
  readonly body: string
  readonly tags: readonly string[]
  readonly links: readonly string[]
}

const MEMORY_PREFIX = ".unifia/memory/"

export function isMemoryMarkdown(path: string): boolean {
  return path.startsWith(MEMORY_PREFIX) && path.toLowerCase().endsWith(".md")
}

export function memoryTitle(path: string): string {
  const filename = path.slice(path.lastIndexOf("/") + 1).replace(/\.md$/i, "")
  return filename || path
}

export function parseMemoryNote(path: string, raw: string): MemoryNoteDocument {
  const withoutFrontmatter = raw.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, "")
  const heading = withoutFrontmatter.match(/^#\s+(.+)$/m)?.[1]?.trim()
  const tags = [...new Set([...withoutFrontmatter.matchAll(/(^|\s)#([\p{L}\p{N}_-]+)/gu)].map((match) => match[2]))]
  const links = [...new Set([...withoutFrontmatter.matchAll(/\[\[([^\]|#]+)(?:#[^\]|]+)?(?:\|[^\]]+)?\]\]/g)].map((match) => match[1].trim()).filter(Boolean))]
  return { path, title: heading || memoryTitle(path), body: withoutFrontmatter, tags, links }
}

export function linkedMemoryNotes(
  links: readonly string[],
  notes: readonly MemoryNoteSummary[],
): readonly MemoryNoteSummary[] {
  const normalized = new Set(links.map((link) => link.replace(/\.md$/i, "").toLocaleLowerCase()))
  return notes.filter((note) => normalized.has(memoryTitle(note.path).toLocaleLowerCase()))
}
