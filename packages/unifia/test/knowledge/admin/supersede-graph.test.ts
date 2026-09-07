/* SPDX-License-Identifier: MIT */
import { describe, it, expect, beforeEach, afterEach } from "bun:test"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { supersedeGraph } from "../../../src/knowledge/admin/supersede-graph.js"

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
  dir = mkdtempSync(join(tmpdir(), "supgraph-"))
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

const A_ID = "0190f6e2-2c34-7c19-bb3a-9d2c4e8f1001"
const B_ID = "0190f6e2-2c34-7c19-bb3a-9d2c4e8f1002"
const C_ID = "0190f6e2-2c34-7c19-bb3a-9d2c4e8f1003"

describe("P11.45 supersede graph", () => {
  it("returns an empty graph on an empty vault", () => {
    const r = supersedeGraph({ vaultRoot: dir })
    expect(r.edges).toEqual([])
    expect(r.dangling).toEqual([])
    expect(r.deepest).toEqual([])
  })

  it("reports a single edge A->B", () => {
    writeNote(dir, "a", frontmatter({ unifia_id: A_ID }))
    writeNote(dir, "b", frontmatter({ unifia_id: B_ID, unifia_supersedes: [A_ID] }))
    const r = supersedeGraph({ vaultRoot: dir })
    expect(r.edges.length).toBe(1)
    expect(r.edges[0]?.from).toBe(B_ID)
    expect(r.edges[0]?.to).toBe(A_ID)
    expect(r.dangling).toEqual([])
    expect(r.deepest.length).toBe(1)
    expect(r.deepest[0]?.depth).toBe(1)
  })

  it("reports a chain C->B->A (depth 2)", () => {
    writeNote(dir, "a", frontmatter({ unifia_id: A_ID }))
    writeNote(dir, "b", frontmatter({ unifia_id: B_ID, unifia_supersedes: [A_ID] }))
    writeNote(dir, "c", frontmatter({ unifia_id: C_ID, unifia_supersedes: [B_ID] }))
    const r = supersedeGraph({ vaultRoot: dir })
    expect(r.edges.length).toBe(2)
    expect(r.deepest[0]?.depth).toBe(2)
  })

  it("flags dangling references", () => {
    writeNote(dir, "a", frontmatter({ unifia_id: A_ID, unifia_supersedes: ["99999999-9999-7999-9999-999999999999"] }))
    const r = supersedeGraph({ vaultRoot: dir })
    expect(r.edges.length).toBe(0)
    expect(r.dangling.length).toBe(1)
    expect(r.dangling[0]?.missingId).toBe("99999999-9999-7999-9999-999999999999")
    expect(r.dangling[0]?.locator).toBe("a.md")
  })

  it("reports no edges for a vault with no supersession", () => {
    writeNote(dir, "a", frontmatter({ unifia_id: A_ID, unifia_supersedes: [] }))
    writeNote(dir, "b", frontmatter({ unifia_id: B_ID, unifia_supersedes: [] }))
    const r = supersedeGraph({ vaultRoot: dir })
    expect(r.edges).toEqual([])
    expect(r.dangling).toEqual([])
  })

  it("limits the top-3 deepest to 3 entries", () => {
    // 5 leaves, each with depth 1
    for (let i = 0; i < 5; i++) {
      const id = `0190f6e2-2c34-7c19-bb3a-9d2c4e8f1${i.toString().padStart(3, "0")}`
      const root = `0190f6e2-2c34-7c19-bb3a-9d2c4e8f9${i.toString().padStart(3, "0")}`
      writeNote(dir, `leaf${i}`, frontmatter({ unifia_id: id, unifia_supersedes: [root] }))
      writeNote(dir, `root${i}`, frontmatter({ unifia_id: root, unifia_supersedes: [] }))
    }
    const r = supersedeGraph({ vaultRoot: dir })
    expect(r.edges.length).toBe(5)
    expect(r.deepest.length).toBe(3)
  })

  it("rejects a non-absolute vaultRoot", () => {
    expect(() => supersedeGraph({ vaultRoot: "rel" })).toThrow(/absolute/)
  })
})
