/* SPDX-License-Identifier: MIT */
import { describe, it, expect, beforeEach, afterEach } from "bun:test"
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { listByType } from "../../../src/knowledge/admin/by-type.js"

let root: string
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "unifia-bytype-"))
})
afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

const note = (id: string, type: string, lifecycle: string) => `---
unifia_schema: 1
unifia_id: "${id}"
unifia_type: ${type}
unifia_lifecycle: ${lifecycle}
unifia_created_at: "2026-08-29T00:00:00Z"
unifia_updated_at: "2026-08-29T00:00:00Z"
unifia_project_ref: unifia
unifia_supersedes: []
unifia_tags: []
---

# hello
`

describe("P11.27 by-type listing", () => {
  it("returns zero hits on an empty vault", () => {
    const r = listByType({ vaultRoot: root, type: "decision" })
    expect(r.scanned).toBe(0)
    expect(r.hits).toEqual([])
  })

  it("lists notes of the requested type", () => {
    mkdirSync(join(root, "memory"), { recursive: true })
    writeFileSync(join(root, "memory/a.md"), note("0190d2c0-7b00-7000-8000-000000000001", "decision", "active"))
    writeFileSync(join(root, "memory/b.md"), note("0190d2c0-7b00-7000-8000-000000000002", "failure", "active"))
    const r = listByType({ vaultRoot: root, type: "decision" })
    expect(r.hits).toHaveLength(1)
    expect(r.hits[0]?.type).toBe("decision")
  })

  it("filters by lifecycle when onlyActive is true", () => {
    mkdirSync(join(root, "memory"), { recursive: true })
    writeFileSync(join(root, "memory/a.md"), note("0190d2c0-7b00-7000-8000-000000000003", "decision", "active"))
    writeFileSync(join(root, "memory/b.md"), note("0190d2c0-7b00-7000-8000-000000000004", "decision", "archived"))
    const r = listByType({ vaultRoot: root, type: "decision", onlyActive: true })
    expect(r.hits).toHaveLength(1)
    expect(r.hits[0]?.lifecycle).toBe("active")
  })

  it("sorts the hits by locator", () => {
    mkdirSync(join(root, "memory"), { recursive: true })
    writeFileSync(join(root, "memory/z.md"), note("0190d2c0-7b00-7000-8000-000000000005", "decision", "active"))
    writeFileSync(join(root, "memory/a.md"), note("0190d2c0-7b00-7000-8000-000000000006", "decision", "active"))
    writeFileSync(join(root, "memory/m.md"), note("0190d2c0-7b00-7000-8000-000000000007", "decision", "active"))
    const r = listByType({ vaultRoot: root, type: "decision" })
    expect(r.hits[0]?.locator).toBe("memory/a.md")
    expect(r.hits[1]?.locator).toBe("memory/m.md")
    expect(r.hits[2]?.locator).toBe("memory/z.md")
  })

  it("respects the limit", () => {
    mkdirSync(join(root, "memory"), { recursive: true })
    for (let i = 0; i < 5; i++) {
      const id = `0190d2c0-7b00-7000-8000-${String(i).padStart(12, "0")}`
      writeFileSync(join(root, `memory/n${i}.md`), note(id, "decision", "active"))
    }
    const r = listByType({ vaultRoot: root, type: "decision", limit: 2 })
    expect(r.hits).toHaveLength(2)
  })

  it("rejects a non-absolute vaultRoot", () => {
    expect(() => listByType({ vaultRoot: "relative/path", type: "x" })).toThrow(/absolute/)
  })
})
