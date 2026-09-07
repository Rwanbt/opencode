/* SPDX-License-Identifier: MIT */
import { describe, it, expect, beforeEach, afterEach } from "bun:test"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { findOrphans } from "../../../src/knowledge/admin/orphans.js"

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
  dir = mkdtempSync(join(tmpdir(), "orphans-"))
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe("P11.37 orphans scan", () => {
  it("returns zero hits on an empty vault", () => {
    const r = findOrphans({ vaultRoot: dir })
    expect(r.scanned).toBe(0)
    expect(r.hits).toEqual([])
  })

  it("returns notes with zero outbound wikilinks (default maxLinks=0)", () => {
    writeNote(dir, "orphan-a", frontmatter({ unifia_id: "0190f6e2-2c34-7c19-bb3a-9d2c4e8f1001" }) + "no links here")
    writeNote(dir, "linked", frontmatter({ unifia_id: "0190f6e2-2c34-7c19-bb3a-9d2c4e8f1002" }) + "links to [[other-note]]")
    writeNote(dir, "orphan-b", frontmatter({ unifia_id: "0190f6e2-2c34-7c19-bb3a-9d2c4e8f1003" }) + "still no links")
    const r = findOrphans({ vaultRoot: dir })
    expect(r.scanned).toBe(3)
    expect(r.hits.length).toBe(2)
    expect(r.hits.map((h) => h.locator).sort()).toEqual(["orphan-a.md", "orphan-b.md"])
  })

  it("respects a custom maxLinks threshold", () => {
    writeNote(dir, "a", frontmatter({ unifia_id: "0190f6e2-2c34-7c19-bb3a-9d2c4e8f1001" }) + "no links")
    writeNote(dir, "b", frontmatter({ unifia_id: "0190f6e2-2c34-7c19-bb3a-9d2c4e8f1002" }) + "links to [[x]] and [[y]]")
    writeNote(dir, "c", frontmatter({ unifia_id: "0190f6e2-2c34-7c19-bb3a-9d2c4e8f1003" }) + "links to [[z]]")
    const r = findOrphans({ vaultRoot: dir, maxLinks: 1 })
    expect(r.hits.length).toBe(2)
    expect(r.hits.map((h) => h.locator).sort()).toEqual(["a.md", "c.md"])
  })

  it("sorts hits by outboundCount then locator", () => {
    writeNote(dir, "z", frontmatter({ unifia_id: "0190f6e2-2c34-7c19-bb3a-9d2c4e8f1001" }) + "no links")
    writeNote(dir, "a", frontmatter({ unifia_id: "0190f6e2-2c34-7c19-bb3a-9d2c4e8f1002" }) + "no links")
    const r = findOrphans({ vaultRoot: dir })
    expect(r.hits.map((h) => h.locator)).toEqual(["a.md", "z.md"])
  })

  it("respects the limit", () => {
    for (let i = 0; i < 5; i++) {
      writeNote(dir, `n${i}`, frontmatter({
        unifia_id: `0190f6e2-2c34-7c19-bb3a-9d2c4e8f1${i.toString().padStart(3, "0")}`,
      }) + "no links")
    }
    const r = findOrphans({ vaultRoot: dir, limit: 2 })
    expect(r.hits.length).toBe(2)
  })

  it("rejects a non-absolute vaultRoot", () => {
    expect(() => findOrphans({ vaultRoot: "rel" })).toThrow(/absolute/)
  })
})
