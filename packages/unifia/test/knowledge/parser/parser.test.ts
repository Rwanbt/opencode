/* SPDX-License-Identifier: MIT */
import { describe, it, expect } from "bun:test"
import { parseDocument } from "../../../src/knowledge/parser/parser.js"
import { readFileSync, readdirSync } from "node:fs"
import { join } from "node:path"

const DEV_DIR = join(import.meta.dir, "../../../../../tests/knowledge/eval/dev")
const HOLDOUT_DIR = join(import.meta.dir, "../../../../../tests/knowledge/eval/holdout")

describe("parseDocument", () => {
  it("parses a minimal note", () => {
    const raw = `---
unifia_schema: 1
unifia_id: "0190d2c0-7b00-7000-8000-000000000001"
unifia_type: decision
unifia_lifecycle: active
unifia_created_at: "2026-08-29T00:00:00Z"
unifia_updated_at: "2026-08-29T00:00:00Z"
unifia_project_ref: unifia
unifia_supersedes: []
unifia_tags: []
---

# Title

See [[Other Note]] for context.

\`\`\`ts
const x = 1
\`\`\`
`
    const doc = parseDocument(raw)
    expect(doc.note.frontmatter.unifia_id).toBe("0190d2c0-7b00-7000-8000-000000000001")
    expect(doc.wikilinks).toHaveLength(1)
    expect(doc.wikilinks[0]?.target).toBe("Other Note")
    expect(doc.headings).toHaveLength(1)
    expect(doc.headings[0]?.text).toBe("Title")
    expect(doc.sections).toHaveLength(2) // pre + h1
    expect(doc.fences).toHaveLength(1)
    expect(doc.fences[0]?.language).toBe("ts")
    expect(doc.bodyBytes).toBeGreaterThan(0)
    expect(doc.rawBytes).toBeGreaterThan(doc.bodyBytes)
  })

  it("parses every dev fixture without error", () => {
    const files = readdirSync(DEV_DIR).filter((n) => n.endsWith(".md") && n !== "README.md")
    for (const name of files) {
      const raw = readFileSync(join(DEV_DIR, name), "utf8")
      const doc = parseDocument(raw)
      expect(doc.note.frontmatter.unifia_schema).toBe(1)
      expect(doc.note.frontmatter.unifia_id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[0-9a-f]{4}-[0-9a-f]{12}$/,
      )
    }
  })

  it("parses every holdout fixture without error", () => {
    const files = readdirSync(HOLDOUT_DIR).filter((n) => n.endsWith(".md") && n !== "README.md")
    for (const name of files) {
      const raw = readFileSync(join(HOLDOUT_DIR, name), "utf8")
      const doc = parseDocument(raw)
      expect(doc.note.frontmatter.unifia_schema).toBe(1)
      expect(doc.note.frontmatter.unifia_id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[0-9a-f]{4}-[0-9a-f]{12}$/,
      )
    }
  })
})
