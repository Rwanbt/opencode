/* SPDX-License-Identifier: MIT */
import { describe, it, expect, beforeEach, afterEach } from "bun:test"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { noteStats } from "../../../src/knowledge/admin/note-stats.js"

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
    unifia_tags: ["egress", "policy"],
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
  dir = mkdtempSync(join(tmpdir(), "note-stats-"))
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe("P11.52 note stats", () => {
  it("rejects when neither locator nor id is given", () => {
    expect(() => noteStats({ vaultRoot: dir })).toThrow(
      /either locator or id is required/,
    )
  })

  it("rejects when locator is unknown", () => {
    expect(() =>
      noteStats({ vaultRoot: dir, locator: "missing.md" }),
    ).toThrow(/note not found/)
  })

  it("rejects non-absolute vaultRoot", () => {
    expect(() =>
      noteStats({ vaultRoot: "relative/path", locator: "x.md" }),
    ).toThrow(/vaultRoot must be absolute/)
  })

  it("returns zero counts for a note with no body and no frontmatter extras", () => {
    const body = frontmatter({})
    writeNote(dir, "empty", body)
    const r = noteStats({ vaultRoot: dir, locator: "empty.md" })
    expect(r.locator).toBe("empty.md")
    expect(r.id).toBe("0190f6e2-2c34-7c19-bb3a-9d2c4e8f1001")
    expect(r.type).toBe("constraint")
    expect(r.lifecycle).toBe("active")
    expect(r.projectRef).toBe("unifia")
    expect(r.bodyChars).toBe(0)
    expect(r.bodyLines).toBe(0)
    expect(r.headingCount).toBe(0)
    expect(r.maxHeadingDepth).toBe(0)
    expect(r.wikilinkOutCount).toBe(0)
    expect(r.wikilinkInCount).toBe(0)
    expect(r.distinctTagCount).toBe(2)
  })

  it("counts headings, body lines, and outbound wikilinks", () => {
    const body =
      frontmatter({}) +
      [
        "# Title",
        "intro",
        "## Section A",
        "see [[other-note]] and [[other-note|alias]]",
        "### Subsection",
        "back to [[empty]]",
        "",
      ].join("\n")
    writeNote(dir, "stats", body)
    writeNote(dir, "other-note", frontmatter({}) + "\n# Other\n")
    const r = noteStats({ vaultRoot: dir, locator: "stats.md" })
    expect(r.headingCount).toBe(3)
    expect(r.maxHeadingDepth).toBe(3)
    expect(r.wikilinkOutCount).toBe(3)
    // 1 backlink from other-note (none) + 1 from itself ("back to [[empty]]")
    // "back to [[empty]]" points to empty.md (not stats.md), so 0 inbound.
    expect(r.wikilinkInCount).toBe(0)
  })

  it("counts inbound wikilinks correctly", () => {
    writeNote(
      dir,
      "target",
      frontmatter({}) + "\n# Target\nsee [[linker]].\n",
    )
    writeNote(
      dir,
      "linker",
      frontmatter({ unifia_id: "0190f6e2-2c34-7c19-bb3a-9d2c4e8f1002" }) +
        "\n# Linker\npoints to [[target]] and [[target]].\n",
    )
    const r = noteStats({ vaultRoot: dir, locator: "target.md" })
    expect(r.wikilinkOutCount).toBe(1)
    expect(r.wikilinkInCount).toBe(2)
  })

  it("resolves by id when locator is omitted", () => {
    writeNote(dir, "x", frontmatter({}) + "\n")
    const r = noteStats({
      vaultRoot: dir,
      id: "0190f6e2-2c34-7c19-bb3a-9d2c4e8f1001",
    })
    expect(r.locator).toBe("x.md")
  })

  it("returns distinct tag count (case-insensitive)", () => {
    writeNote(
      dir,
      "tags",
      frontmatter({ unifia_tags: ["Egress", "egress", "Policy", "policy"] }) +
        "\n",
    )
    const r = noteStats({ vaultRoot: dir, locator: "tags.md" })
    expect(r.tagCount).toBe(4)
    expect(r.distinctTagCount).toBe(2)
  })

  it("lists frontmatter field names sorted", () => {
    writeNote(
      dir,
      "fm",
      frontmatter({ custom_field: "value", another: 42 }) + "\n",
    )
    const r = noteStats({ vaultRoot: dir, locator: "fm.md" })
    const names = r.frontmatterFieldNames
    expect(names.length).toBe(r.frontmatterFieldCount)
    // sorted ascending
    const sorted = [...names].sort()
    expect(names).toEqual(sorted)
  })
})
