/* SPDX-License-Identifier: MIT */
import { describe, it, expect, beforeEach, afterEach } from "bun:test"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { classifySupersede } from "../../../src/knowledge/admin/supersede-classify.js"

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
  dir = mkdtempSync(join(tmpdir(), "supclass-"))
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

const A_ID = "0190f6e2-2c34-7c19-bb3a-9d2c4e8f1001"
const B_ID = "0190f6e2-2c34-7c19-bb3a-9d2c4e8f1002"
const C_ID = "0190f6e2-2c34-7c19-bb3a-9d2c4e8f1003"
const D_ID = "0190f6e2-2c34-7c19-bb3a-9d2c4e8f1004"

describe("P11.49 supersede classification", () => {
  it("returns all zero counts on an empty vault", () => {
    const r = classifySupersede({ vaultRoot: dir })
    expect(r.scanned).toBe(0)
    expect(r.totalByRole.isolated).toBe(0)
    expect(r.totalByRole.root).toBe(0)
    expect(r.totalByRole.leaf).toBe(0)
    expect(r.totalByRole.chain).toBe(0)
  })

  it("classifies a single isolated note", () => {
    writeNote(dir, "a", frontmatter({ unifia_id: A_ID }))
    const r = classifySupersede({ vaultRoot: dir })
    expect(r.totalByRole.isolated).toBe(1)
    expect(r.totalByRole.root).toBe(0)
    expect(r.totalByRole.leaf).toBe(0)
    expect(r.totalByRole.chain).toBe(0)
  })

  it("classifies a root (B supersedes A)", () => {
    writeNote(dir, "a", frontmatter({ unifia_id: A_ID }))
    writeNote(dir, "b", frontmatter({ unifia_id: B_ID, unifia_supersedes: [A_ID] }))
    const r = classifySupersede({ vaultRoot: dir })
    expect(r.totalByRole.root).toBe(1) // b
    expect(r.totalByRole.leaf).toBe(1) // a
    expect(r.totalByRole.isolated).toBe(0)
    expect(r.totalByRole.chain).toBe(0)
  })

  it("classifies a chain (C supersedes B supersedes A)", () => {
    writeNote(dir, "a", frontmatter({ unifia_id: A_ID }))
    writeNote(dir, "b", frontmatter({ unifia_id: B_ID, unifia_supersedes: [A_ID] }))
    writeNote(dir, "c", frontmatter({ unifia_id: C_ID, unifia_supersedes: [B_ID] }))
    const r = classifySupersede({ vaultRoot: dir })
    expect(r.totalByRole.root).toBe(1) // c
    expect(r.totalByRole.chain).toBe(1) // b
    expect(r.totalByRole.leaf).toBe(1) // a
  })

  it("classifies a diamond (D supersedes B and C, both supersede A)", () => {
    writeNote(dir, "a", frontmatter({ unifia_id: A_ID }))
    writeNote(dir, "b", frontmatter({ unifia_id: B_ID, unifia_supersedes: [A_ID] }))
    writeNote(dir, "c", frontmatter({ unifia_id: C_ID, unifia_supersedes: [A_ID] }))
    writeNote(dir, "d", frontmatter({ unifia_id: D_ID, unifia_supersedes: [B_ID, C_ID] }))
    const r = classifySupersede({ vaultRoot: dir })
    expect(r.totalByRole.root).toBe(1) // d
    expect(r.totalByRole.chain).toBe(2) // b, c
    expect(r.totalByRole.leaf).toBe(1) // a
  })

  it("sorts each role by locator", () => {
    writeNote(dir, "z", frontmatter({ unifia_id: A_ID }))
    writeNote(dir, "a", frontmatter({ unifia_id: B_ID }))
    const r = classifySupersede({ vaultRoot: dir })
    expect(r.byRole.isolated[0]?.locator).toBe("a.md")
    expect(r.byRole.isolated[1]?.locator).toBe("z.md")
  })

  it("rejects a non-absolute vaultRoot", () => {
    expect(() => classifySupersede({ vaultRoot: "rel" })).toThrow(/absolute/)
  })
})
