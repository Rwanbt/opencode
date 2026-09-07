/* SPDX-License-Identifier: MIT */
import { describe, it, expect, beforeEach, afterEach } from "bun:test"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { findRecent } from "../../../src/knowledge/admin/recent.js"

function writeNote(dir: string, name: string, body: string): void {
  writeFileSync(join(dir, `${name}.md`), body, "utf8")
}

function frontmatter(extra: Record<string, unknown>): string {
  const base = {
    unifia_id: "0190f6e2-2c34-7c19-bb3a-9d2c4e8f1001",
    unifia_type: "constraint",
    unifia_lifecycle: "active",
    unifia_project_ref: "unifia",
    unifia_created_at: "2026-08-29T00:00:00.000Z",
    unifia_updated_at: "2026-08-29T00:00:00.000Z",
    unifia_tags: [],
    unifia_supersedes: [],
    ...extra,
  }
  const lines = ["---"]
  for (const [k, v] of Object.entries(base)) {
    if (Array.isArray(v)) {
      lines.push(`${k}: [${v.map((x) => JSON.stringify(x)).join(", ")}]`)
    } else {
      lines.push(`${k}: ${JSON.stringify(v)}`)
    }
  }
  lines.push("---", "")
  return lines.join("\n")
}

let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "recent-"))
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe("P11.44 recent notes", () => {
  it("returns zero hits on an empty vault", () => {
    const r = findRecent({ vaultRoot: dir })
    expect(r.scanned).toBe(0)
    expect(r.hits).toEqual([])
  })

  it("returns notes whose updatedAt is within the window", () => {
    const now = new Date()
    const recent = new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000).toISOString()
    const old = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString()
    writeNote(dir, "recent", frontmatter({ unifia_id: "0190f6e2-2c34-7c19-bb3a-9d2c4e8f1001", unifia_updated_at: recent }))
    writeNote(dir, "old", frontmatter({ unifia_id: "0190f6e2-2c34-7c19-bb3a-9d2c4e8f1002", unifia_updated_at: old }))
    const r = findRecent({ vaultRoot: dir, windowDays: 7 })
    expect(r.scanned).toBe(2)
    expect(r.hits.length).toBe(1)
    expect(r.hits[0]?.locator).toBe("recent.md")
  })

  it("respects a custom windowDays (zero = all)", () => {
    const now = new Date()
    const recent = new Date(now.getTime() - 1 * 24 * 60 * 60 * 1000).toISOString()
    writeNote(dir, "a", frontmatter({ unifia_id: "0190f6e2-2c34-7c19-bb3a-9d2c4e8f1001", unifia_updated_at: recent }))
    const r = findRecent({ vaultRoot: dir, windowDays: 0 })
    expect(r.hits.length).toBe(1)
  })

  it("filters by onlyActive when set", () => {
    const now = new Date()
    const recent = new Date(now.getTime() - 1 * 24 * 60 * 60 * 1000).toISOString()
    writeNote(dir, "active-recent", frontmatter({ unifia_id: "0190f6e2-2c34-7c19-bb3a-9d2c4e8f1001", unifia_updated_at: recent, unifia_lifecycle: "active" }))
    writeNote(dir, "archived-recent", frontmatter({ unifia_id: "0190f6e2-2c34-7c19-bb3a-9d2c4e8f1002", unifia_updated_at: recent, unifia_lifecycle: "archived" }))
    const r = findRecent({ vaultRoot: dir, windowDays: 7, onlyActive: true })
    expect(r.hits.length).toBe(1)
    expect(r.hits[0]?.locator).toBe("active-recent.md")
  })

  it("sorts by age ascending (most recent first), then by locator", () => {
    const now = new Date()
    const r1 = new Date(now.getTime() - 5 * 24 * 60 * 60 * 1000).toISOString()
    const r2 = new Date(now.getTime() - 1 * 24 * 60 * 60 * 1000).toISOString()
    writeNote(dir, "b", frontmatter({ unifia_id: "0190f6e2-2c34-7c19-bb3a-9d2c4e8f1001", unifia_updated_at: r1 }))
    writeNote(dir, "a", frontmatter({ unifia_id: "0190f6e2-2c34-7c19-bb3a-9d2c4e8f1002", unifia_updated_at: r2 }))
    const r = findRecent({ vaultRoot: dir, windowDays: 7 })
    expect(r.hits.map((h) => h.locator)).toEqual(["a.md", "b.md"])
  })

  it("respects the limit", () => {
    const now = new Date()
    const recent = new Date(now.getTime() - 1 * 24 * 60 * 60 * 1000).toISOString()
    for (let i = 0; i < 5; i++) {
      writeNote(dir, `n${i}`, frontmatter({
        unifia_id: `0190f6e2-2c34-7c19-bb3a-9d2c4e8f1${i.toString().padStart(3, "0")}`,
        unifia_updated_at: recent,
      }))
    }
    const r = findRecent({ vaultRoot: dir, windowDays: 7, limit: 2 })
    expect(r.hits.length).toBe(2)
  })

  it("rejects a negative windowDays", () => {
    expect(() => findRecent({ vaultRoot: dir, windowDays: -1 })).toThrow(/>= 0/)
  })

  it("rejects a non-absolute vaultRoot", () => {
    expect(() => findRecent({ vaultRoot: "rel" })).toThrow(/absolute/)
  })
})
