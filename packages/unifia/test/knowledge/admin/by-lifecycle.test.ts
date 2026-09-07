/* SPDX-License-Identifier: MIT */
import { describe, it, expect, beforeEach, afterEach } from "bun:test"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { listByLifecycle } from "../../../src/knowledge/admin/by-lifecycle.js"

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
  dir = mkdtempSync(join(tmpdir(), "by-lifecycle-"))
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe("P11.35 by-lifecycle listing", () => {
  it("returns zero hits on an empty vault", () => {
    const r = listByLifecycle({ vaultRoot: dir, lifecycle: "active" })
    expect(r.scanned).toBe(0)
    expect(r.hits).toEqual([])
  })

  it("lists notes of the requested lifecycle", () => {
    writeNote(dir, "a", frontmatter({ unifia_id: "0190f6e2-2c34-7c19-bb3a-9d2c4e8f1001", unifia_lifecycle: "active" }))
    writeNote(dir, "b", frontmatter({ unifia_id: "0190f6e2-2c34-7c19-bb3a-9d2c4e8f1002", unifia_lifecycle: "active" }))
    writeNote(dir, "c", frontmatter({ unifia_id: "0190f6e2-2c34-7c19-bb3a-9d2c4e8f1003", unifia_lifecycle: "archived" }))
    const r = listByLifecycle({ vaultRoot: dir, lifecycle: "active" })
    expect(r.scanned).toBe(3)
    expect(r.hits.length).toBe(2)
    expect(r.hits[0]?.lifecycle).toBe("active")
    expect(r.hits[1]?.lifecycle).toBe("active")
  })

  it("sorts hits by locator", () => {
    writeNote(dir, "z", frontmatter({ unifia_id: "0190f6e2-2c34-7c19-bb3a-9d2c4e8f1001", unifia_lifecycle: "active" }))
    writeNote(dir, "a", frontmatter({ unifia_id: "0190f6e2-2c34-7c19-bb3a-9d2c4e8f1002", unifia_lifecycle: "active" }))
    writeNote(dir, "m", frontmatter({ unifia_id: "0190f6e2-2c34-7c19-bb3a-9d2c4e8f1003", unifia_lifecycle: "active" }))
    const r = listByLifecycle({ vaultRoot: dir, lifecycle: "active" })
    expect(r.hits.map((h) => h.locator)).toEqual(["a.md", "m.md", "z.md"])
  })

  it("respects the limit", () => {
    for (let i = 0; i < 5; i++) {
      writeNote(dir, `n${i}`, frontmatter({
        unifia_id: `0190f6e2-2c34-7c19-bb3a-9d2c4e8f1${i.toString().padStart(3, "0")}`,
        unifia_lifecycle: "active",
      }))
    }
    const r = listByLifecycle({ vaultRoot: dir, lifecycle: "active", limit: 2 })
    expect(r.hits.length).toBe(2)
  })

  it("rejects an unknown lifecycle", () => {
    expect(() => listByLifecycle({ vaultRoot: dir, lifecycle: "draft" as never })).toThrow(/candidate/)
  })

  it("rejects a non-absolute vaultRoot", () => {
    expect(() => listByLifecycle({ vaultRoot: "rel", lifecycle: "active" })).toThrow(/absolute/)
  })
})
