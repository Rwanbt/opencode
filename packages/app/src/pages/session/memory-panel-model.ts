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

export type MemoryGraphNode = MemoryNoteSummary & {
  readonly x: number
  readonly y: number
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
  const headingMatch = withoutFrontmatter.match(/^#\s+(.+)(?:\r?\n|$)/)
  const heading = headingMatch?.[1]?.trim()
  const tags = [...new Set([...withoutFrontmatter.matchAll(/(^|\s)#([\p{L}\p{N}_-]+)/gu)].map((match) => match[2]))]
  const links = [...new Set([...withoutFrontmatter.matchAll(/\[\[([^\]|#]+)(?:#[^\]|]+)?(?:\|[^\]]+)?\]\]/g)].map((match) => match[1].trim()).filter(Boolean))]
  const body = headingMatch ? withoutFrontmatter.slice(headingMatch[0].length) : withoutFrontmatter
  return { path, title: heading || memoryTitle(path), body, tags, links }
}

export function linkedMemoryNotes(
  links: readonly string[],
  notes: readonly MemoryNoteSummary[],
): readonly MemoryNoteSummary[] {
  const normalized = new Set(links.map((link) => link.replace(/\.md$/i, "").toLocaleLowerCase()))
  return notes.filter((note) => normalized.has(memoryTitle(note.path).toLocaleLowerCase()))
}

/** A deterministic local graph: the selected note and its resolved neighbours. */
export function localMemoryGraph(
  selected: MemoryNoteSummary,
  linked: readonly MemoryNoteSummary[],
): readonly MemoryGraphNode[] {
  if (linked.length === 0) return [{ ...selected, x: 50, y: 50 }]
  return [
    { ...selected, x: 50, y: 50 },
    ...linked.map((note, index) => {
      const angle = (Math.PI * 2 * index) / linked.length - Math.PI / 2
      return { ...note, x: 50 + Math.cos(angle) * 34, y: 50 + Math.sin(angle) * 34 }
    }),
  ]
}
