/* SPDX-License-Identifier: MIT */
import { describe, it, expect, beforeEach, afterEach } from "bun:test"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { tagCooccurrence } from "../../../src/knowledge/admin/tag-cooccurrence.js"

function writeNote(dir: string, name: string, body: string): void {
  writeFileSync(join(dir, `${name}.md`), body, "utf8")
}

function frontmatter(extra: Record<string, unknown>): string {
  const base = {
    unifia_id: "0190f6e2-2c34-7c19-bb3a-9d2c4e8f1001",
    unifia_type: "decision",
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
  dir = mkdtempSync(join(tmpdir(), "tagco-"))
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe("P11.48 tag co-occurrence", () => {
  it("returns zero pairs on an empty vault", () => {
    const r = tagCooccurrence({ vaultRoot: dir })
    expect(r.scanned).toBe(0)
    expect(r.pairs).toEqual([])
  })

  it("returns zero pairs when no note has >= 2 tags", () => {
    writeNote(dir, "a", frontmatter({ unifia_id: "0190f6e2-2c34-7c19-bb3a-9d2c4e8f1001", unifia_tags: ["x"] }))
    writeNote(dir, "b", frontmatter({ unifia_id: "0190f6e2-2c34-7c19-bb3a-9d2c4e8f1002", unifia_tags: ["y"] }))
    const r = tagCooccurrence({ vaultRoot: dir, minCount: 1 })
    expect(r.pairs).toEqual([])
  })

  it("counts a pair that appears in one note", () => {
    writeNote(dir, "a", frontmatter({ unifia_id: "0190f6e2-2c34-7c19-bb3a-9d2c4e8f1001", unifia_tags: ["x", "y"] }))
    const r = tagCooccurrence({ vaultRoot: dir, minCount: 1 })
    expect(r.pairs.length).toBe(1)
    expect(r.pairs[0]?.a).toBe("x")
    expect(r.pairs[0]?.b).toBe("y")
    expect(r.pairs[0]?.count).toBe(1)
  })

  it("counts a pair that appears in multiple notes", () => {
    writeNote(dir, "a", frontmatter({ unifia_id: "0190f6e2-2c34-7c19-bb3a-9d2c4e8f1001", unifia_tags: ["x", "y"] }))
    writeNote(dir, "b", frontmatter({ unifia_id: "0190f6e2-2c34-7c19-bb3a-9d2c4e8f1002", unifia_tags: ["x", "y"] }))
    writeNote(dir, "c", frontmatter({ unifia_id: "0190f6e2-2c34-7c19-bb3a-9d2c4e8f1003", unifia_tags: ["x", "y"] }))
    const r = tagCooccurrence({ vaultRoot: dir, minCount: 1 })
    expect(r.pairs.length).toBe(1)
    expect(r.pairs[0]?.count).toBe(3)
  })

  it("respects minCount filter", () => {
    writeNote(dir, "a", frontmatter({ unifia_id: "0190f6e2-2c34-7c19-bb3a-9d2c4e8f1001", unifia_tags: ["x", "y"] }))
    writeNote(dir, "b", frontmatter({ unifia_id: "0190f6e2-2c34-7c19-bb3a-9d2c4e8f1002", unifia_tags: ["x", "y", "z"] }))
    const r = tagCooccurrence({ vaultRoot: dir, minCount: 2 })
    // (x,y) appears in both, count=2 -> kept.
    // (x,z) appears once, count=1 -> dropped.
    // (y,z) appears once, count=1 -> dropped.
    expect(r.pairs.length).toBe(1)
    expect(r.pairs[0]?.a).toBe("x")
    expect(r.pairs[0]?.b).toBe("y")
  })

  it("is case-insensitive", () => {
    writeNote(dir, "a", frontmatter({ unifia_id: "0190f6e2-2c34-7c19-bb3a-9d2c4e8f1001", unifia_tags: ["TOOL:BASH", "secret"] }))
    writeNote(dir, "b", frontmatter({ unifia_id: "0190f6e2-2c34-7c19-bb3a-9d2c4e8f1002", unifia_tags: ["tool:bash", "Secret"] }))
    const r = tagCooccurrence({ vaultRoot: dir, minCount: 1 })
    expect(r.pairs.length).toBe(1)
    expect(r.pairs[0]?.count).toBe(2)
  })

  it("sorts pairs by count descending then by tag", () => {
    writeNote(dir, "a", frontmatter({ unifia_id: "0190f6e2-2c34-7c19-bb3a-9d2c4e8f1001", unifia_tags: ["a", "b"] }))
    writeNote(dir, "b", frontmatter({ unifia_id: "0190f6e2-2c34-7c19-bb3a-9d2c4e8f1002", unifia_tags: ["a", "b"] }))
    writeNote(dir, "c", frontmatter({ unifia_id: "0190f6e2-2c34-7c19-bb3a-9d2c4e8f1003", unifia_tags: ["c", "d"] }))
    const r = tagCooccurrence({ vaultRoot: dir, minCount: 1 })
    expect(r.pairs.length).toBe(2)
    expect(r.pairs[0]?.a).toBe("a")
    expect(r.pairs[0]?.count).toBe(2)
    expect(r.pairs[1]?.a).toBe("c")
    expect(r.pairs[1]?.count).toBe(1)
  })

  it("respects the limit", () => {
    for (let i = 0; i < 5; i++) {
      const tags = [`t${i}`, `t${i + 1}`]
      writeNote(dir, `n${i}`, frontmatter({
        unifia_id: `0190f6e2-2c34-7c19-bb3a-9d2c4e8f1${i.toString().padStart(3, "0")}`,
        unifia_tags: tags,
      }))
    }
    const r = tagCooccurrence({ vaultRoot: dir, minCount: 1, limit: 2 })
    expect(r.pairs.length).toBe(2)
  })

  it("rejects a minCount < 1", () => {
    expect(() => tagCooccurrence({ vaultRoot: dir, minCount: 0 })).toThrow(/>= 1/)
  })

  it("rejects a non-absolute vaultRoot", () => {
    expect(() => tagCooccurrence({ vaultRoot: "rel" })).toThrow(/absolute/)
  })
})
