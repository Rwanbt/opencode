/* SPDX-License-Identifier: MIT */
import { describe, it, expect, beforeEach, afterEach } from "bun:test"
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { listNotes } from "../../../src/knowledge/admin/list.js"

let root: string
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "unifia-list-"))
})
afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

const note = (id: string, type: string) => `---
unifia_schema: 1
unifia_id: "${id}"
unifia_type: ${type}
unifia_lifecycle: active
unifia_created_at: "2026-08-29T00:00:00Z"
unifia_updated_at: "2026-08-29T00:00:00Z"
unifia_project_ref: unifia
unifia_supersedes: []
unifia_tags: []
---

# hello
`

describe("P11.30 list", () => {
  it("returns an empty list on an empty vault", () => {
    const r = listNotes({ vaultRoot: root })
    expect(r.hits).toEqual([])
  })

  it("lists all notes", () => {
    mkdirSync(join(root, "memory"), { recursive: true })
    for (let i = 0; i < 3; i++) {
      const id = `0190d2c0-7b00-7000-8000-${String(i).padStart(12, "0")}`
      writeFileSync(join(root, `memory/n${i}.md`), note(id, "decision"))
    }
    const r = listNotes({ vaultRoot: root })
    expect(r.hits).toHaveLength(3)
  })

  it("sorts by locator", () => {
    mkdirSync(join(root, "memory"), { recursive: true })
    writeFileSync(join(root, "memory/z.md"), note("0190d2c0-7b00-7000-8000-000000000010", "decision"))
    writeFileSync(join(root, "memory/a.md"), note("0190d2c0-7b00-7000-8000-000000000020", "decision"))
    const r = listNotes({ vaultRoot: root })
    expect(r.hits[0]?.locator).toBe("memory/a.md")
    expect(r.hits[1]?.locator).toBe("memory/z.md")
  })

  it("respects the limit and offset", () => {
    mkdirSync(join(root, "memory"), { recursive: true })
    for (let i = 0; i < 5; i++) {
      const id = `0190d2c0-7b00-7000-8000-${String(i).padStart(12, "0")}`
      writeFileSync(join(root, `memory/n${i}.md`), note(id, "decision"))
    }
    const r = listNotes({ vaultRoot: root, limit: 2, offset: 1 })
    expect(r.hits).toHaveLength(2)
  })

  it("rejects a non-absolute vaultRoot", () => {
    expect(() => listNotes({ vaultRoot: "relative/path" })).toThrow(/absolute/)
  })
})
