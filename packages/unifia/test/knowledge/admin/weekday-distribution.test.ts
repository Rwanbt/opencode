/* SPDX-License-Identifier: MIT */
import { describe, it, expect, beforeEach, afterEach } from "bun:test"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { weekdayDistribution } from "../../../src/knowledge/admin/weekday-distribution.js"

function writeNote(dir: string, name: string, body: string): void {
  writeFileSync(join(dir, `${name}.md`), body, "utf8")
}

function frontmatterWithDate(isoDate: string): string {
  const base = {
    unifia_id: "0190f6e2-2c34-7c19-bb3a-9d2c4e8f1001",
    unifia_type: "constraint",
    unifia_lifecycle: "active",
    unifia_project_ref: "unifia",
    unifia_created_at: "2026-08-29T00:00:00.000Z",
    unifia_updated_at: isoDate,
    unifia_tags: [],
    unifia_supersedes: [],
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
  dir = mkdtempSync(join(tmpdir(), "weekday-dist-"))
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe("P11.54 weekday distribution", () => {
  it("rejects non-absolute vaultRoot", () => {
    expect(() => weekdayDistribution({ vaultRoot: "x" })).toThrow(
      /vaultRoot must be absolute/,
    )
  })

  it("returns zero counts on an empty vault", () => {
    const r = weekdayDistribution({ vaultRoot: dir })
    expect(r.scanned).toBe(0)
    expect(r.total).toBe(0)
  })

  it("groups notes by UTC weekday", () => {
    // 2026-08-29 is a Saturday (UTC). JS getUTCDay = 6 (Sun=0).
    // Normalize to Mon=0 .. Sun=6 -> Saturday = 5
    writeNote(dir, "sat", frontmatterWithDate("2026-08-29T12:00:00.000Z"))
    const r = weekdayDistribution({ vaultRoot: dir })
    expect(r.scanned).toBe(1)
    expect(r.total).toBe(1)
    expect(r.byWeekday["Sat"]).toBe(1)
    expect(r.byWeekday["Mon"]).toBe(0)
  })

  it("skips notes without unifia_updated_at (filtered by strict Zod)", () => {
    writeNote(
      dir,
      "bad",
      [
        "---",
        'unifia_id: "0190f6e2-2c34-7c19-bb3a-9d2c4e8f1001"',
        'unifia_type: "constraint"',
        'unifia_lifecycle: "active"',
        "---",
        "",
      ].join("\n"),
    )
    const r = weekdayDistribution({ vaultRoot: dir })
    expect(r.scanned).toBe(0)
    expect(r.total).toBe(0)
  })

  it("counts multiple weekdays", () => {
    // Mon 2026-08-24
    writeNote(dir, "mon", frontmatterWithDate("2026-08-24T12:00:00.000Z"))
    // Tue 2026-08-25
    writeNote(
      dir,
      "tue",
      frontmatterWithDate("2026-08-25T12:00:00.000Z").replace(
        "1001",
        "1002",
      ),
    )
    // Mon 2026-08-24 (second)
    writeNote(
      dir,
      "mon2",
      frontmatterWithDate("2026-08-24T18:00:00.000Z").replace(
        "1001",
        "1003",
      ),
    )
    const r = weekdayDistribution({ vaultRoot: dir })
    expect(r.scanned).toBe(3)
    expect(r.total).toBe(3)
    expect(r.byWeekday["Mon"]).toBe(2)
    expect(r.byWeekday["Tue"]).toBe(1)
  })

  it("rejects an unparseable date (filtered by strict Zod)", () => {
    writeNote(dir, "broken", frontmatterWithDate("not-a-date"))
    const r = weekdayDistribution({ vaultRoot: dir })
    expect(r.scanned).toBe(0)
    expect(r.total).toBe(0)
  })
})
