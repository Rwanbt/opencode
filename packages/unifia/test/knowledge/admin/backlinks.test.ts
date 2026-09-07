/* SPDX-License-Identifier: MIT */
import { describe, it, expect, beforeEach, afterEach } from "bun:test"
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { findBacklinks } from "../../../src/knowledge/admin/backlinks.js"

let root: string
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "unifia-back-"))
})
afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

const note = (id: string, body: string) => `---
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

describe("P11.25 backlinks", () => {
  it("returns an empty list on an empty vault", () => {
    const r = findBacklinks({ vaultRoot: root, target: "memory/x.md" })
    expect(r.scanned).toBe(0)
    expect(r.hits).toEqual([])
  })

  it("finds a single backlink", () => {
    mkdirSync(join(root, "memory"), { recursive: true })
    writeFileSync(
      join(root, "memory/a.md"),
      note("0190d2c0-7b00-7000-8000-000000000001", "See [[memory/x]]."),
    )
    const r = findBacklinks({ vaultRoot: root, target: "memory/x.md" })
    expect(r.hits).toHaveLength(1)
    expect(r.hits[0]?.matchedTarget).toBe("memory/x")
  })

  it("finds multiple backlinks", () => {
    mkdirSync(join(root, "memory"), { recursive: true })
    writeFileSync(join(root, "memory/a.md"), note("0190d2c0-7b00-7000-8000-000000000001", "See [[memory/x]]."))
    writeFileSync(join(root, "memory/b.md"), note("0190d2c0-7b00-7000-8000-000000000002", "Look at [[memory/x]]."))
    writeFileSync(join(root, "memory/c.md"), note("0190d2c0-7b00-7000-8000-000000000003", "Nothing here."))
    const r = findBacklinks({ vaultRoot: root, target: "memory/x.md" })
    expect(r.hits).toHaveLength(2)
  })

  it("matches case-insensitively", () => {
    mkdirSync(join(root, "memory"), { recursive: true })
    writeFileSync(join(root, "memory/a.md"), note("0190d2c0-7b00-7000-8000-000000000004", "See [[MEMORY/X]]."))
    const r = findBacklinks({ vaultRoot: root, target: "memory/x.md" })
    expect(r.hits).toHaveLength(1)
  })

  it("strips heading anchors", () => {
    mkdirSync(join(root, "memory"), { recursive: true })
    writeFileSync(join(root, "memory/a.md"), note("0190d2c0-7b00-7000-8000-000000000005", "See [[memory/x#section]]."))
    const r = findBacklinks({ vaultRoot: root, target: "memory/x" })
    expect(r.hits).toHaveLength(1)
  })

  it("returns empty when the target doesn't exist", () => {
    mkdirSync(join(root, "memory"), { recursive: true })
    writeFileSync(join(root, "memory/a.md"), note("0190d2c0-7b00-7000-8000-000000000006", "See [[memory/y]]."))
    const r = findBacklinks({ vaultRoot: root, target: "memory/x" })
    expect(r.hits).toEqual([])
  })

  it("rejects a non-absolute vaultRoot", () => {
    expect(() => findBacklinks({ vaultRoot: "relative/path", target: "x" })).toThrow(/absolute/)
  })
})
