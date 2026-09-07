/* SPDX-License-Identifier: MIT */
import { describe, it, expect, beforeEach, afterEach } from "bun:test"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { listByProject } from "../../../src/knowledge/admin/by-project.js"

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
  dir = mkdtempSync(join(tmpdir(), "by-project-"))
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe("P11.36 by-project listing", () => {
  it("returns zero hits on an empty vault", () => {
    const r = listByProject({ vaultRoot: dir, projectRef: "unifia" })
    expect(r.scanned).toBe(0)
    expect(r.hits).toEqual([])
  })

  it("lists notes belonging to the requested project", () => {
    writeNote(dir, "a", frontmatter({ unifia_id: "0190f6e2-2c34-7c19-bb3a-9d2c4e8f1001", unifia_project_ref: "unifia" }))
    writeNote(dir, "b", frontmatter({ unifia_id: "0190f6e2-2c34-7c19-bb3a-9d2c4e8f1002", unifia_project_ref: "unifia" }))
    writeNote(dir, "c", frontmatter({ unifia_id: "0190f6e2-2c34-7c19-bb3a-9d2c4e8f1003", unifia_project_ref: "lumen" }))
    const r = listByProject({ vaultRoot: dir, projectRef: "unifia" })
    expect(r.scanned).toBe(3)
    expect(r.hits.length).toBe(2)
    expect(r.hits[0]?.projectRef).toBe("unifia")
    expect(r.hits[1]?.projectRef).toBe("unifia")
  })

  it("sorts hits by locator", () => {
    writeNote(dir, "z", frontmatter({ unifia_id: "0190f6e2-2c34-7c19-bb3a-9d2c4e8f1001", unifia_project_ref: "unifia" }))
    writeNote(dir, "a", frontmatter({ unifia_id: "0190f6e2-2c34-7c19-bb3a-9d2c4e8f1002", unifia_project_ref: "unifia" }))
    writeNote(dir, "m", frontmatter({ unifia_id: "0190f6e2-2c34-7c19-bb3a-9d2c4e8f1003", unifia_project_ref: "unifia" }))
    const r = listByProject({ vaultRoot: dir, projectRef: "unifia" })
    expect(r.hits.map((h) => h.locator)).toEqual(["a.md", "m.md", "z.md"])
  })

  it("respects the limit", () => {
    for (let i = 0; i < 5; i++) {
      writeNote(dir, `n${i}`, frontmatter({
        unifia_id: `0190f6e2-2c34-7c19-bb3a-9d2c4e8f1${i.toString().padStart(3, "0")}`,
        unifia_project_ref: "unifia",
      }))
    }
    const r = listByProject({ vaultRoot: dir, projectRef: "unifia", limit: 3 })
    expect(r.hits.length).toBe(3)
  })

  it("rejects an empty projectRef", () => {
    expect(() => listByProject({ vaultRoot: dir, projectRef: "" })).toThrow(/non-empty/)
  })

  it("rejects a non-absolute vaultRoot", () => {
    expect(() => listByProject({ vaultRoot: "rel", projectRef: "unifia" })).toThrow(/absolute/)
  })

  it("returns no hits when no notes match the project", () => {
    writeNote(dir, "a", frontmatter({ unifia_id: "0190f6e2-2c34-7c19-bb3a-9d2c4e8f1001", unifia_project_ref: "lumen" }))
    const r = listByProject({ vaultRoot: dir, projectRef: "unifia" })
    expect(r.scanned).toBe(1)
    expect(r.hits.length).toBe(0)
  })
})
