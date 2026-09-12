/* SPDX-License-Identifier: MIT */
import { describe, it, expect, beforeEach, afterEach } from "bun:test"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { findReferences } from "../../../src/knowledge/admin/references.js"

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
  dir = mkdtempSync(join(tmpdir(), "references-"))
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe("P11.40 references listing", () => {
  it("rejects when neither targetId nor targetLocator is given", () => {
    expect(() => findReferences({ vaultRoot: dir })).toThrow(/required/)
  })

  it("rejects when both targetId and targetLocator are given", () => {
    expect(() =>
      findReferences({ vaultRoot: dir, targetId: "0190f6e2-2c34-7c19-bb3a-9d2c4e8f1001", targetLocator: "a.md" }),
    ).toThrow(/mutually exclusive/)
  })

  it("returns an empty list when the target does not exist", () => {
    const r = findReferences({ vaultRoot: dir, targetLocator: "missing.md" })
    expect(r.target).toBeNull()
    expect(r.references).toEqual([])
  })

  it("lists the outbound wikilinks of a target note", () => {
    writeNote(
      dir,
      "a",
      frontmatter({ unifia_id: "0190f6e2-2c34-7c19-bb3a-9d2c4e8f1001" }) +
        "links to [[other-note]] and [[another|alias]] and [[third#heading]]",
    )
    const r = findReferences({ vaultRoot: dir, targetLocator: "a.md" })
    expect(r.target?.id).toBe("0190f6e2-2c34-7c19-bb3a-9d2c4e8f1001")
    expect(r.references.length).toBe(3)
    expect(r.references[0]?.target).toBe("other-note")
    expect(r.references[1]?.target).toBe("another")
    expect(r.references[1]?.alias).toBe("alias")
    expect(r.references[2]?.target).toBe("third")
    expect(r.references[2]?.heading).toBe("heading")
  })

  it("returns zero references for a note with no wikilinks", () => {
    writeNote(dir, "a", frontmatter({ unifia_id: "0190f6e2-2c34-7c19-bb3a-9d2c4e8f1001" }) + "no links here")
    const r = findReferences({ vaultRoot: dir, targetLocator: "a.md" })
    expect(r.references.length).toBe(0)
  })

  it("finds the target by id when no locator is given", () => {
    writeNote(dir, "a", frontmatter({ unifia_id: "0190f6e2-2c34-7c19-bb3a-9d2c4e8f1001" }) + "links to [[x]]")
    const r = findReferences({ vaultRoot: dir, targetId: "0190f6e2-2c34-7c19-bb3a-9d2c4e8f1001" })
    expect(r.target?.locator).toBe("a.md")
    expect(r.references.length).toBe(1)
  })

  it("rejects a non-absolute vaultRoot", () => {
    expect(() => findReferences({ vaultRoot: "rel", targetLocator: "a.md" })).toThrow(/absolute/)
  })
})
