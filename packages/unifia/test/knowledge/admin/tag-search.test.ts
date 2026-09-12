/* SPDX-License-Identifier: MIT */
import { describe, it, expect, beforeEach, afterEach } from "bun:test"
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { tagSearch } from "../../../src/knowledge/admin/tag-search.js"

let root: string
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "unifia-tag-"))
})
afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

const note = (id: string, tags: string[]) => `---
unifia_schema: 1
unifia_id: "${id}"
unifia_type: decision
unifia_lifecycle: active
unifia_created_at: "2026-08-29T00:00:00Z"
unifia_updated_at: "2026-08-29T00:00:00Z"
unifia_project_ref: unifia
unifia_supersedes: []
unifia_tags: ${JSON.stringify(tags)}
---

# hello
`

describe("P11.24 tag search", () => {
  it("returns an empty list on an empty vault", () => {
    const r = tagSearch({ vaultRoot: root, tags: ["alpha"] })
    expect(r.scanned).toBe(0)
    expect(r.hits).toEqual([])
  })

  it("returns all notes when the query is empty", () => {
    mkdirSync(join(root, "memory"), { recursive: true })
    writeFileSync(join(root, "memory/a.md"), note("0190d2c0-7b00-7000-8000-000000000001", ["alpha"]))
    writeFileSync(join(root, "memory/b.md"), note("0190d2c0-7b00-7000-8000-000000000002", ["beta"]))
    const r = tagSearch({ vaultRoot: root, tags: [] })
    expect(r.hits).toHaveLength(2)
  })

  it("matches a single tag", () => {
    mkdirSync(join(root, "memory"), { recursive: true })
    writeFileSync(join(root, "memory/a.md"), note("0190d2c0-7b00-7000-8000-000000000003", ["alpha", "beta"]))
    writeFileSync(join(root, "memory/b.md"), note("0190d2c0-7b00-7000-8000-000000000004", ["gamma"]))
    const r = tagSearch({ vaultRoot: root, tags: ["alpha"] })
    expect(r.hits).toHaveLength(1)
    expect(r.hits[0]?.tags).toContain("alpha")
  })

  it("applies AND semantics to multiple tags", () => {
    mkdirSync(join(root, "memory"), { recursive: true })
    writeFileSync(join(root, "memory/a.md"), note("0190d2c0-7b00-7000-8000-000000000005", ["alpha", "beta"]))
    writeFileSync(join(root, "memory/b.md"), note("0190d2c0-7b00-7000-8000-000000000006", ["alpha"]))
    const r = tagSearch({ vaultRoot: root, tags: ["alpha", "beta"] })
    expect(r.hits).toHaveLength(1)
    expect(r.hits[0]?.id).toContain("000005")
  })

  it("is case-insensitive on tags", () => {
    mkdirSync(join(root, "memory"), { recursive: true })
    writeFileSync(join(root, "memory/a.md"), note("0190d2c0-7b00-7000-8000-000000000007", ["ALPHA"]))
    const r = tagSearch({ vaultRoot: root, tags: ["alpha"] })
    expect(r.hits).toHaveLength(1)
  })

  it("respects the limit", () => {
    mkdirSync(join(root, "memory"), { recursive: true })
    for (let i = 0; i < 10; i++) {
      const id = `0190d2c0-7b00-7000-8000-${String(i).padStart(12, "0")}`
      writeFileSync(join(root, `memory/n${i}.md`), note(id, ["x"]))
    }
    const r = tagSearch({ vaultRoot: root, tags: ["x"], limit: 3 })
    expect(r.hits).toHaveLength(3)
  })

  it("rejects a non-absolute vaultRoot", () => {
    expect(() => tagSearch({ vaultRoot: "relative/path", tags: ["x"] })).toThrow(/absolute/)
  })
})
