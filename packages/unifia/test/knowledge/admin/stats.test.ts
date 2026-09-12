/* SPDX-License-Identifier: MIT */
import { describe, it, expect, beforeEach, afterEach } from "bun:test"
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { computeStats } from "../../../src/knowledge/admin/stats.js"

let root: string
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "unifia-stats-"))
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

describe("P11.26 stats", () => {
  it("returns zero totals on an empty vault", () => {
    const s = computeStats(root)
    expect(s.totalNotes).toBe(0)
    expect(s.byType).toEqual([])
  })

  it("computes percentages for each category", () => {
    mkdirSync(join(root, "memory"), { recursive: true })
    writeFileSync(join(root, "memory/a.md"), note("0190d2c0-7b00-7000-8000-000000000001", "decision", "active"))
    writeFileSync(join(root, "memory/b.md"), note("0190d2c0-7b00-7000-8000-000000000002", "decision", "active"))
    writeFileSync(join(root, "memory/c.md"), note("0190d2c0-7b00-7000-8000-000000000003", "failure", "active"))
    writeFileSync(join(root, "memory/d.md"), note("0190d2c0-7b00-7000-8000-000000000004", "failure", "archived"))
    const s = computeStats(root)
    expect(s.totalNotes).toBe(4)
    const dec = s.byType.find((b) => b.name === "decision")
    expect(dec?.count).toBe(2)
    expect(dec?.percent).toBe(50)
    const fail = s.byType.find((b) => b.name === "failure")
    expect(fail?.count).toBe(2)
    expect(fail?.percent).toBe(50)
    const act = s.byLifecycle.find((b) => b.name === "active")
    expect(act?.count).toBe(3)
    expect(act?.percent).toBe(75)
  })

  it("sorts the breakdown by count descending", () => {
    mkdirSync(join(root, "memory"), { recursive: true })
    writeFileSync(join(root, "memory/a.md"), note("0190d2c0-7b00-7000-8000-000000000005", "decision", "active"))
    writeFileSync(join(root, "memory/b.md"), note("0190d2c0-7b00-7000-8000-000000000006", "decision", "active"))
    writeFileSync(join(root, "memory/c.md"), note("0190d2c0-7b00-7000-8000-000000000007", "decision", "active"))
    writeFileSync(join(root, "memory/d.md"), note("0190d2c0-7b00-7000-8000-000000000008", "failure", "active"))
    const s = computeStats(root)
    expect(s.byType[0]?.name).toBe("decision")
    expect(s.byType[0]?.count).toBe(3)
  })

  it("rejects a non-absolute vaultRoot", () => {
    expect(() => computeStats("relative/path")).toThrow(/absolute/)
  })
})
