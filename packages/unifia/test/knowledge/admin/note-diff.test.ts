/* SPDX-License-Identifier: MIT */
import { describe, it, expect, beforeEach, afterEach } from "bun:test"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { noteDiff } from "../../../src/knowledge/admin/note-diff.js"

function writeFile(dir: string, name: string, body: string): void {
  writeFileSync(join(dir, `${name}.md`), body, "utf8")
}

function fm(extra: Record<string, unknown>): string {
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
  dir = mkdtempSync(join(tmpdir(), "notediff-"))
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

const A_ID = "0190f6e2-2c34-7c19-bb3a-9d2c4e8f1001"
const B_ID = "0190f6e2-2c34-7c19-bb3a-9d2c4e8f1002"

describe("P11.50 note diff", () => {
  it("rejects when noteA is missing", () => {
    expect(() => noteDiff({
      vaultRoot: dir,
      noteALocator: "a.md",
      noteBLocator: "b.md",
    })).toThrow(/noteA not found/)
  })

  it("rejects when noteB is missing", () => {
    writeFile(dir, "a", fm({ unifia_id: A_ID }))
    expect(() => noteDiff({
      vaultRoot: dir,
      noteALocator: "a.md",
      noteBLocator: "b.md",
    })).toThrow(/noteB not found/)
  })

  it("rejects a non-absolute vaultRoot", () => {
    expect(() => noteDiff({
      vaultRoot: "rel",
      noteALocator: "a.md",
      noteBLocator: "b.md",
    })).toThrow(/absolute/)
  })

  it("returns zero added/removed when notes are identical", () => {
    const text = fm({ unifia_id: A_ID }) + "same body"
    writeFile(dir, "a", text)
    writeFile(dir, "b", text)
    const r = noteDiff({ vaultRoot: dir, noteALocator: "a.md", noteBLocator: "b.md" })
    expect(r.added).toBe(0)
    expect(r.removed).toBe(0)
    // Context lines are present but no add/remove.
    expect(r.frontmatterDiff.every((l) => l.kind === "context")).toBe(true)
    expect(r.bodyDiff.every((l) => l.kind === "context")).toBe(true)
  })

  it("detects added and removed lines in the body", () => {
    // Use the same id for both to focus on body diff (no frontmatter change).
    const textA = fm({ unifia_id: A_ID }) + "line1\nline2\nline3\n"
    const textB = fm({ unifia_id: A_ID }) + "line1\nline2-modified\nline3\nline4\n"
    writeFile(dir, "a", textA)
    writeFile(dir, "b", textB)
    const r = noteDiff({ vaultRoot: dir, noteALocator: "a.md", noteBLocator: "b.md" })
    expect(r.added).toBe(2)
    expect(r.removed).toBe(1)
  })

  it("detects frontmatter changes (lifecycle)", () => {
    writeFile(dir, "a", fm({ unifia_id: A_ID, unifia_lifecycle: "active" }))
    writeFile(dir, "b", fm({ unifia_id: B_ID, unifia_lifecycle: "superseded" }))
    const r = noteDiff({ vaultRoot: dir, noteALocator: "a.md", noteBLocator: "b.md" })
    // Expect at least one remove + one add in frontmatter
    const fmAdds = r.frontmatterDiff.filter((l) => l.kind === "add").length
    const fmRems = r.frontmatterDiff.filter((l) => l.kind === "remove").length
    expect(fmAdds).toBeGreaterThan(0)
    expect(fmRems).toBeGreaterThan(0)
  })

  it("finds targets by id when no locator is given", () => {
    writeFile(dir, "a", fm({ unifia_id: A_ID }) + "A")
    writeFile(dir, "b", fm({ unifia_id: B_ID }) + "B")
    const r = noteDiff({ vaultRoot: dir, noteAId: A_ID, noteBId: B_ID })
    expect(r.noteA?.id).toBe(A_ID)
    expect(r.noteB?.id).toBe(B_ID)
  })
})
