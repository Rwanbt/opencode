/* SPDX-License-Identifier: MIT */
import { describe, it, expect, beforeEach, afterEach } from "bun:test"
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { allProjects } from "../../../src/knowledge/admin/projects.js"

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
    } else if (typeof v === "string") {
      lines.push(`${k}: ${JSON.stringify(v)}`)
    } else {
      lines.push(`${k}: ${JSON.stringify(v)}`)
    }
  }
  lines.push("---", "")
  return lines.join("\n")
}

let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "projects-"))
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe("P11.33 all-projects listing", () => {
  it("returns an empty list on an empty vault", () => {
    const r = allProjects({ vaultRoot: dir })
    expect(r.scanned).toBe(0)
    expect(r.projects).toEqual([])
  })

  it("returns the unique project refs with their counts", () => {
    writeNote(dir, "a", frontmatter({ unifia_project_ref: "alpha" }))
    writeNote(dir, "b", frontmatter({ unifia_project_ref: "alpha" }))
    writeNote(dir, "c", frontmatter({ unifia_project_ref: "beta" }))
    const r = allProjects({ vaultRoot: dir })
    expect(r.scanned).toBe(3)
    expect(r.projects.length).toBe(2)
    expect(r.projects[0]?.projectRef).toBe("alpha")
    expect(r.projects[0]?.count).toBe(2)
    expect(r.projects[1]?.projectRef).toBe("beta")
    expect(r.projects[1]?.count).toBe(1)
  })

  it("sorts by count descending, then alphabetical", () => {
    writeNote(dir, "a", frontmatter({ unifia_project_ref: "zeta" }))
    writeNote(dir, "b", frontmatter({ unifia_project_ref: "alpha" }))
    writeNote(dir, "c", frontmatter({ unifia_project_ref: "alpha" }))
    writeNote(dir, "d", frontmatter({ unifia_project_ref: "alpha" }))
    writeNote(dir, "e", frontmatter({ unifia_project_ref: "beta" }))
    writeNote(dir, "f", frontmatter({ unifia_project_ref: "beta" }))
    const r = allProjects({ vaultRoot: dir })
    expect(r.projects.map((p) => p.projectRef)).toEqual(["alpha", "beta", "zeta"])
    expect(r.projects.map((p) => p.count)).toEqual([3, 2, 1])
  })

  it("skips malformed notes without crashing", () => {
    writeNote(dir, "a", frontmatter({ unifia_project_ref: "alpha" }))
    writeFileSync(join(dir, "broken.md"), "not a valid note at all", "utf8")
    writeNote(dir, "c", frontmatter({ unifia_project_ref: "beta" }))
    const r = allProjects({ vaultRoot: dir })
    expect(r.scanned).toBe(2)
    expect(r.projects.length).toBe(2)
  })

  it("rejects a non-absolute vaultRoot", () => {
    expect(() => allProjects({ vaultRoot: "relative/path" })).toThrow(/absolute/)
  })
})
