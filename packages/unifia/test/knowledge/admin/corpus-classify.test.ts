/* SPDX-License-Identifier: MIT */
import { describe, it, expect, beforeEach, afterEach } from "bun:test"
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { classifyCorpus } from "../../../src/knowledge/admin/corpus-classify.js"

let root: string
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "unifia-corpus-"))
})
afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

const note = (id: string, body = "# hello") => `---
unifia_schema: 1
unifia_id: "${id}"
unifia_type: decision
unifia_lifecycle: active
unifia_created_at: "2026-08-29T00:00:00Z"
unifia_updated_at: "2026-08-29T00:00:00Z"
unifia_project_ref: unifia
unifia_supersedes: []
unifia_tags: []
---

${body}
`

describe("P11.10 corpus classification", () => {
  it("returns zero findings on a clean corpus", () => {
    mkdirSync(join(root, "memory"), { recursive: true })
    writeFileSync(
      join(root, "memory/a.md"),
      note("0190d2c0-7b00-7000-8000-000000000001"),
    )
    const r = classifyCorpus(root)
    expect(r.notesParsed).toBe(1)
    expect(r.notesFailed).toBe(0)
    expect(r.findings.filter((f) => f.category !== "stale_index")).toEqual([])
  })

  it("detects a broken wikilink", () => {
    mkdirSync(join(root, "memory"), { recursive: true })
    writeFileSync(
      join(root, "memory/a.md"),
      note("0190d2c0-7b00-7000-8000-000000000002", "See [[memory/missing.md]]."),
    )
    const r = classifyCorpus(root)
    expect(r.findings.some((f) => f.category === "broken_wikilink")).toBe(true)
  })

  it("reports notesFailed for a malformed frontmatter", () => {
    mkdirSync(join(root, "memory"), { recursive: true })
    writeFileSync(join(root, "memory/bad.md"), "---\nnot: valid\n---\nbody")
    const r = classifyCorpus(root)
    expect(r.notesFailed).toBe(1)
  })

  it("computes totalChunks and totalEdges", () => {
    mkdirSync(join(root, "memory"), { recursive: true })
    writeFileSync(
      join(root, "memory/a.md"),
      note("0190d2c0-7b00-7000-8000-000000000003", "x".repeat(2000)),
    )
    const r = classifyCorpus(root)
    expect(r.totalChunks).toBeGreaterThan(1)
    expect(r.totalEdges).toBe(0) // no wikilinks in this note
  })

  it("returns an empty report on an empty vault", () => {
    const r = classifyCorpus(root)
    expect(r.notesParsed).toBe(0)
    expect(r.notesFailed).toBe(0)
  })
})
