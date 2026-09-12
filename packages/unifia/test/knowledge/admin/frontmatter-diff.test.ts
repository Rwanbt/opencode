/* SPDX-License-Identifier: MIT */
import { describe, it, expect, beforeEach, afterEach } from "bun:test"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { frontmatterDiff } from "../../../src/knowledge/admin/frontmatter-diff.js"

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
  dir = mkdtempSync(join(tmpdir(), "fm-diff-"))
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe("P11.56 frontmatter diff", () => {
  it("rejects when both targetA and idA are missing", () => {
    expect(() =>
      frontmatterDiff({ vaultRoot: dir, targetB: "y.md" }),
    ).toThrow(/targetA or idA is required/)
  })

  it("rejects when both targetB and idB are missing", () => {
    expect(() =>
      frontmatterDiff({ vaultRoot: dir, targetA: "x.md" }),
    ).toThrow(/targetB or idB is required/)
  })

  it("rejects non-absolute vaultRoot", () => {
    expect(() =>
      frontmatterDiff({
        vaultRoot: "x",
        targetA: "a.md",
        targetB: "b.md",
      }),
    ).toThrow(/vaultRoot must be absolute/)
  })

  it("reports no diff for identical frontmatters", () => {
    writeNote(dir, "a", frontmatter({}))
    writeNote(
      dir,
      "b",
      frontmatter({ unifia_id: "0190f6e2-2c34-7c19-bb3a-9d2c4e8f1002" }),
    )
    const r = frontmatterDiff({
      vaultRoot: dir,
      targetA: "a.md",
      targetB: "b.md",
    })
    // unifia_id is different, so 1 change
    expect(r.added).toEqual([])
    expect(r.removed).toEqual([])
    expect(r.changed.length).toBe(1)
    expect(r.changed[0]?.key).toBe("unifia_id")
  })

  it("reports added, removed, and changed keys (within V1 strict frontmatter)", () => {
    // V1 frontmatter is strict: only the 9 known fields are kept.
    // So `added` and `removed` are always empty in practice. We
    // exercise `changed` and `unchanged` instead.
    writeNote(
      dir,
      "a",
      frontmatter({
        unifia_lifecycle: "active",
        unifia_tags: ["egress"],
      }),
    )
    writeNote(
      dir,
      "b",
      frontmatter({
        unifia_id: "0190f6e2-2c34-7c19-bb3a-9d2c4e8f1002",
        unifia_lifecycle: "archived",
        unifia_tags: ["egress", "policy"],
      }),
    )
    const r = frontmatterDiff({
      vaultRoot: dir,
      targetA: "a.md",
      targetB: "b.md",
    })
    // added and removed are empty (both have the same 9 fields)
    expect(r.added).toEqual([])
    expect(r.removed).toEqual([])
    // changed: unifia_id, unifia_lifecycle, unifia_tags
    const changedKeys = r.changed.map((c) => c.key).sort()
    expect(changedKeys).toContain("unifia_id")
    expect(changedKeys).toContain("unifia_lifecycle")
    expect(changedKeys).toContain("unifia_tags")
    // unchanged: the rest of the 9 fields
    expect(r.unchanged).toContain("unifia_type")
    expect(r.unchanged).toContain("unifia_project_ref")
  })

  it("detects array changes (added element)", () => {
    writeNote(dir, "a", frontmatter({ unifia_tags: ["egress"] }))
    writeNote(
      dir,
      "b",
      frontmatter({
        unifia_id: "0190f6e2-2c34-7c19-bb3a-9d2c4e8f1002",
        unifia_tags: ["egress", "policy"],
      }),
    )
    const r = frontmatterDiff({
      vaultRoot: dir,
      targetA: "a.md",
      targetB: "b.md",
    })
    const ch = r.changed.find((c) => c.key === "unifia_tags")
    expect(ch).toBeDefined()
  })

  it("resolves by id when locator is omitted", () => {
    writeNote(dir, "a", frontmatter({}))
    writeNote(
      dir,
      "b",
      frontmatter({ unifia_id: "0190f6e2-2c34-7c19-bb3a-9d2c4e8f1002" }),
    )
    const r = frontmatterDiff({
      vaultRoot: dir,
      idA: "0190f6e2-2c34-7c19-bb3a-9d2c4e8f1001",
      idB: "0190f6e2-2c34-7c19-bb3a-9d2c4e8f1002",
    })
    expect(r.aLocator).toBe("a.md")
    expect(r.bLocator).toBe("b.md")
  })
})
