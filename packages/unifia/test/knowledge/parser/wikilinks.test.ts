/* SPDX-License-Identifier: MIT */
import { describe, it, expect } from "bun:test"
import {
  extractWikilinks,
  extractHeadings,
  sliceSections,
  extractFences,
} from "../../../src/knowledge/parser/wikilinks.js"

describe("extractWikilinks", () => {
  it("returns an empty array when there are no wikilinks", () => {
    expect(extractWikilinks("Plain text only.")).toEqual([])
  })

  it("extracts a simple wikilink", () => {
    const out = extractWikilinks("See [[Note A]] for context.")
    expect(out).toHaveLength(1)
    expect(out[0]?.target).toBe("Note A")
    expect(out[0]?.alias).toBeUndefined()
    expect(out[0]?.heading).toBeUndefined()
  })

  it("extracts an aliased wikilink", () => {
    const out = extractWikilinks("See [[Note A|the A note]] for context.")
    expect(out).toHaveLength(1)
    expect(out[0]?.target).toBe("Note A")
    expect(out[0]?.alias).toBe("the A note")
  })

  it("extracts a heading-anchored wikilink", () => {
    const out = extractWikilinks("Jump to [[Note A#Section 2]].")
    expect(out).toHaveLength(1)
    expect(out[0]?.target).toBe("Note A")
    expect(out[0]?.heading).toBe("Section 2")
  })

  it("extracts combined heading + alias", () => {
    const out = extractWikilinks("[[Note A#sec|see]]")
    expect(out).toHaveLength(1)
    expect(out[0]?.target).toBe("Note A")
    expect(out[0]?.heading).toBe("sec")
    expect(out[0]?.alias).toBe("see")
  })

  it("extracts multiple wikilinks in order", () => {
    const out = extractWikilinks("[[A]] then [[B]] then [[C|alias]].")
    expect(out.map((w) => w.target)).toEqual(["A", "B", "C"])
    expect(out[2]?.alias).toBe("alias")
  })

  it("reports the byte offsets of the [[ and ]] delimiters", () => {
    const text = "See [[X]]."
    const out = extractWikilinks(text)
    expect(out).toHaveLength(1)
    const wl = out[0]
    if (wl === undefined) throw new Error("expected one wikilink")
    expect(text.slice(wl.start, wl.start + 2)).toBe("[[")
    expect(text.slice(wl.end - 2, wl.end)).toBe("]]")
  })

  it("ignores an empty target", () => {
    expect(extractWikilinks("[[]]")).toEqual([])
    expect(extractWikilinks("[[|alias]]")).toEqual([])
  })

  it("does not match across line breaks", () => {
    expect(extractWikilinks("[[foo\nbar]]")).toEqual([])
  })
})

describe("extractHeadings", () => {
  it("returns an empty array when there are no headings", () => {
    expect(extractHeadings("plain text only\n")).toEqual([])
  })

  it("extracts h1 through h6", () => {
    const body = "# h1\n## h2\n### h3\n#### h4\n##### h5\n###### h6\n"
    const out = extractHeadings(body)
    expect(out.map((h) => h.level)).toEqual([1, 2, 3, 4, 5, 6])
    expect(out.map((h) => h.text)).toEqual(["h1", "h2", "h3", "h4", "h5", "h6"])
  })

  it("tolerates trailing # characters", () => {
    const out = extractHeadings("## Title ##\n")
    expect(out).toHaveLength(1)
    expect(out[0]?.text).toBe("Title")
  })
})

describe("sliceSections", () => {
  it("returns the body as a single section when no headings", () => {
    const out = sliceSections("just text\nno headings\n")
    expect(out).toHaveLength(1)
    expect(out[0]?.level).toBe(0)
  })

  it("produces one section per heading", () => {
    const body = "# A\nbody1\n# B\nbody2\n"
    const out = sliceSections(body)
    expect(out).toHaveLength(2)
    expect(out[0]?.heading?.text).toBe("A")
    expect(out[1]?.heading?.text).toBe("B")
  })

  it("captures the pre-heading body when present", () => {
    const body = "preface\n# A\nbody1\n"
    const out = sliceSections(body)
    expect(out[0]?.level).toBe(0)
    expect(out[0]?.body).toContain("preface")
    expect(out[1]?.heading?.text).toBe("A")
  })
})

describe("extractFences", () => {
  it("returns an empty array when there are no fences", () => {
    expect(extractFences("plain text")).toEqual([])
  })

  it("extracts a fenced code block with a language", () => {
    const body = "before\n```ts\nconst x = 1\n```\nafter\n"
    const out = extractFences(body)
    expect(out).toHaveLength(1)
    expect(out[0]?.language).toBe("ts")
    expect(out[0]?.content).toBe("const x = 1")
  })

  it("extracts a fenced code block without a language", () => {
    const body = "```\nfoo\n```\n"
    const out = extractFences(body)
    expect(out).toHaveLength(1)
    expect(out[0]?.language).toBe("")
    expect(out[0]?.content).toBe("foo")
  })
})
