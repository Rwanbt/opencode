/* SPDX-License-Identifier: MIT */
import { describe, it, expect, beforeEach, afterEach } from "bun:test"
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { allTags } from "../../../src/knowledge/admin/tags.js"

let root: string
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "unifia-tags-"))
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

describe("P11.32 all-tags listing", () => {
  it("returns an empty list on an empty vault", () => {
    const r = allTags({ vaultRoot: root })
    expect(r.scanned).toBe(0)
    expect(r.tags).toEqual([])
  })

  it("returns the unique tags with their counts", () => {
    mkdirSync(join(root, "memory"), { recursive: true })
    writeFileSync(join(root, "memory/a.md"), note("0190d2c0-7b00-7000-8000-000000000001", ["alpha", "beta"]))
    writeFileSync(join(root, "memory/b.md"), note("0190d2c0-7b00-7000-8000-000000000002", ["alpha"]))
    const r = allTags({ vaultRoot: root })
    expect(r.tags).toHaveLength(2)
    const alpha = r.tags.find((t) => t.tag === "alpha")
    expect(alpha?.count).toBe(2)
    const beta = r.tags.find((t) => t.tag === "beta")
    expect(beta?.count).toBe(1)
  })

  it("sorts by count descending", () => {
    mkdirSync(join(root, "memory"), { recursive: true })
    writeFileSync(join(root, "memory/a.md"), note("0190d2c0-7b00-7000-8000-000000000003", ["x"]))
    writeFileSync(join(root, "memory/b.md"), note("0190d2c0-7b00-7000-8000-000000000004", ["x", "x"]))
    const r = allTags({ vaultRoot: root })
    expect(r.tags[0]?.tag).toBe("x")
  })

  it("is case-insensitive on tags", () => {
    mkdirSync(join(root, "memory"), { recursive: true })
    writeFileSync(join(root, "memory/a.md"), note("0190d2c0-7b00-7000-8000-000000000005", ["ALPHA"]))
    writeFileSync(join(root, "memory/b.md"), note("0190d2c0-7b00-7000-8000-000000000006", ["alpha"]))
    const r = allTags({ vaultRoot: root })
    expect(r.tags).toHaveLength(1)
    expect(r.tags[0]?.count).toBe(2)
  })

  it("rejects a non-absolute vaultRoot", () => {
    expect(() => allTags({ vaultRoot: "relative/path" })).toThrow(/absolute/)
  })
})
