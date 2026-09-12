import { describe, expect, test } from "bun:test"
import { isMemoryMarkdown, linkedMemoryNotes, localMemoryGraph, memoryBacklinks, memoryExcerpt, memoryTitle, parseMemoryNote } from "./memory-panel-model"

describe("Memory inspector model", () => {
  test("only exposes Markdown notes from the configured workspace vault", () => {
    expect(isMemoryMarkdown(".unifia/memory/Architecture.md")).toBe(true)
    expect(isMemoryMarkdown("README.md")).toBe(false)
    expect(isMemoryMarkdown(".unifia/memory/diagram.svg")).toBe(false)
  })

  test("parses frontmatter, tags and wikilinks without serving the frontmatter as note text", () => {
    const note = parseMemoryNote(".unifia/memory/Architecture.md", "---\nproject: unifia\n---\n# Architecture\n\n#platform [[Vision|product vision]]")
    expect(note.title).toBe("Architecture")
    expect(note.body).not.toContain("project: unifia")
    expect(note.body).not.toContain("# Architecture")
    expect(note.tags).toEqual(["platform"])
    expect(note.links).toEqual(["Vision"])
  })

  test("resolves links by note identity, independent of the extension", () => {
    const notes = [{ path: ".unifia/memory/Vision.md", title: memoryTitle(".unifia/memory/Vision.md") }]
    expect(linkedMemoryNotes(["Vision.md"], notes)).toEqual(notes)
  })

  test("finds backlinks from parsed notes without using a second index", () => {
    const target = { path: ".unifia/memory/Vision.md", title: "Vision" }
    const architecture = parseMemoryNote(".unifia/memory/Architecture.md", "# Architecture\n[[Vision]]")
    expect(memoryBacklinks(target, [architecture])).toEqual([{ path: architecture.path, title: "Architecture" }])
  })

  test("memoryExcerpt strips markdown noise, collapses whitespace and truncates with ellipsis", () => {
    const body = "## Section\n\nThe **first** paragraph references `code` and a [link](https://example.com) plus an ![img](a.png). It carries a longer sentence that should be cut off somewhere after the configured limit."
    const excerpt = memoryExcerpt(body, 60)
    expect(excerpt).not.toMatch(/[*`#>[\]()!]/)
    expect(excerpt.endsWith("…")).toBe(true)
    expect(excerpt.length).toBeLessThanOrEqual(61)
  })

  test("memoryExcerpt returns the body unchanged when short enough and trims only when over the limit", () => {
    expect(memoryExcerpt("short body", 60)).toBe("short body")
    expect(memoryExcerpt("   spaced  out   body  ", 60)).toBe("spaced out body")
  })

  test("keeps a local graph stable around the selected note", () => {
    const selected = { path: ".unifia/memory/Architecture.md", title: "Architecture" }
    const graph = localMemoryGraph(selected, [{ path: ".unifia/memory/Vision.md", title: "Vision" }])
    expect(graph[0]).toMatchObject({ title: "Architecture", x: 50, y: 50 })
    expect(graph[1]?.title).toBe("Vision")
  })
})
