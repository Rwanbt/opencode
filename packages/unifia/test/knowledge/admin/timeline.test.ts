/* SPDX-License-Identifier: MIT */
import { describe, it, expect, beforeEach, afterEach } from "bun:test"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { buildTimeline, formatTimeline } from "../../../src/knowledge/admin/timeline.js"

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
  dir = mkdtempSync(join(tmpdir(), "timeline-"))
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe("P11.47 daily timeline", () => {
  it("returns zero days on an empty vault", () => {
    const r = buildTimeline({ vaultRoot: dir })
    expect(r.days).toEqual([])
    expect(r.totalNotes).toBe(0)
    expect(r.totalDays).toBe(0)
  })

  it("groups notes by their updatedAt day", () => {
    writeNote(dir, "a", frontmatter({ unifia_id: "0190f6e2-2c34-7c19-bb3a-9d2c4e8f1001", unifia_updated_at: "2026-08-29T10:00:00.000Z" }))
    writeNote(dir, "b", frontmatter({ unifia_id: "0190f6e2-2c34-7c19-bb3a-9d2c4e8f1002", unifia_updated_at: "2026-08-29T12:00:00.000Z" }))
    writeNote(dir, "c", frontmatter({ unifia_id: "0190f6e2-2c34-7c19-bb3a-9d2c4e8f1003", unifia_updated_at: "2026-08-28T09:00:00.000Z" }))
    const r = buildTimeline({ vaultRoot: dir, windowDays: 0 })
    expect(r.totalNotes).toBe(3)
    expect(r.totalDays).toBe(2)
    expect(r.days[0]?.day).toBe("2026-08-29")
    expect(r.days[0]?.count).toBe(2)
    expect(r.days[1]?.day).toBe("2026-08-28")
    expect(r.days[1]?.count).toBe(1)
  })

  it("respects a windowDays filter (default 30)", () => {
    const now = new Date()
    const recent = new Date(now.getTime() - 5 * 24 * 60 * 60 * 1000).toISOString()
    const old = new Date(now.getTime() - 200 * 24 * 60 * 60 * 1000).toISOString()
    writeNote(dir, "a", frontmatter({ unifia_id: "0190f6e2-2c34-7c19-bb3a-9d2c4e8f1001", unifia_updated_at: recent }))
    writeNote(dir, "b", frontmatter({ unifia_id: "0190f6e2-2c34-7c19-bb3a-9d2c4e8f1002", unifia_updated_at: old }))
    const r = buildTimeline({ vaultRoot: dir, windowDays: 30 })
    expect(r.totalNotes).toBe(1)
  })

  it("respects a custom windowDays (zero = no filter)", () => {
    const now = new Date()
    const old = new Date(now.getTime() - 200 * 24 * 60 * 60 * 1000).toISOString()
    writeNote(dir, "a", frontmatter({ unifia_id: "0190f6e2-2c34-7c19-bb3a-9d2c4e8f1001", unifia_updated_at: old }))
    const r = buildTimeline({ vaultRoot: dir, windowDays: 0 })
    expect(r.totalNotes).toBe(1)
  })

  it("sorts days descending (most recent first)", () => {
    writeNote(dir, "a", frontmatter({ unifia_id: "0190f6e2-2c34-7c19-bb3a-9d2c4e8f1001", unifia_updated_at: "2026-08-27T00:00:00.000Z" }))
    writeNote(dir, "b", frontmatter({ unifia_id: "0190f6e2-2c34-7c19-bb3a-9d2c4e8f1002", unifia_updated_at: "2026-08-29T00:00:00.000Z" }))
    writeNote(dir, "c", frontmatter({ unifia_id: "0190f6e2-2c34-7c19-bb3a-9d2c4e8f1003", unifia_updated_at: "2026-08-28T00:00:00.000Z" }))
    const r = buildTimeline({ vaultRoot: dir, windowDays: 0 })
    expect(r.days.map((d) => d.day)).toEqual(["2026-08-29", "2026-08-28", "2026-08-27"])
  })

  it("formats the timeline for CLI display", () => {
    const r = buildTimeline({ vaultRoot: dir, windowDays: 0 })
    const s = formatTimeline(r, 5)
    expect(s).toContain("total-notes:")
    expect(s).toContain("total-days:")
  })

  it("rejects a negative windowDays", () => {
    expect(() => buildTimeline({ vaultRoot: dir, windowDays: -1 })).toThrow(/>= 0/)
  })

  it("rejects a non-absolute vaultRoot", () => {
    expect(() => buildTimeline({ vaultRoot: "rel" })).toThrow(/absolute/)
  })
})
