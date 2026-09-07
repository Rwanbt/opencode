/* SPDX-License-Identifier: MIT */
import { describe, it, expect, beforeEach, afterEach } from "bun:test"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { edgeDensity } from "../../../src/knowledge/admin/edge-density.js"

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
  dir = mkdtempSync(join(tmpdir(), "edge-density-"))
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe("P11.55 edge density", () => {
  it("rejects non-absolute vaultRoot", () => {
    expect(() => edgeDensity({ vaultRoot: "x" })).toThrow(
      /vaultRoot must be absolute/,
    )
  })

  it("returns zero counts on an empty vault", () => {
    const r = edgeDensity({ vaultRoot: dir })
    expect(r.scanned).toBe(0)
    expect(r.meanDegree).toBe(0)
    expect(r.isolatedCount).toBe(0)
  })

  it("counts isolated notes (degree 0)", () => {
    writeNote(dir, "iso1", frontmatter({}) + "no links here")
    writeNote(
      dir,
      "iso2",
      frontmatter({ unifia_id: "0190f6e2-2c34-7c19-bb3a-9d2c4e8f1002" }) +
        "still no links",
    )
    const r = edgeDensity({ vaultRoot: dir })
    expect(r.scanned).toBe(2)
    expect(r.buckets["0"]).toBe(2)
    expect(r.isolatedCount).toBe(2)
    expect(r.maxDegree).toBe(0)
  })

  it("counts outbound + inbound edges", () => {
    // a -> b, a -> c, b -> c
    writeNote(
      dir,
      "a",
      frontmatter({ unifia_id: "0190f6e2-2c34-7c19-bb3a-9d2c4e8f1001" }) +
        "see [[b]] and [[c]]",
    )
    writeNote(
      dir,
      "b",
      frontmatter({ unifia_id: "0190f6e2-2c34-7c19-bb3a-9d2c4e8f1002" }) +
        "see [[c]]",
    )
    writeNote(
      dir,
      "c",
      frontmatter({ unifia_id: "0190f6e2-2c34-7c19-bb3a-9d2c4e8f1003" }) +
        "no out",
    )
    const r = edgeDensity({ vaultRoot: dir })
    // a: out=2 (b, c) + in=0 = 2
    // b: out=1 (c) + in=1 (from a) = 2
    // c: out=0 + in=2 (from a, b) = 2
    expect(r.scanned).toBe(3)
    expect(r.maxDegree).toBe(2)
    expect(r.meanDegree).toBe(2)
    expect(r.buckets["2-5"]).toBe(3)
    expect(r.isolatedCount).toBe(0)
  })

  it("puts a highly connected note in the 20+ bucket", () => {
    // hub links to 25 satellites
    let hub = frontmatter({
      unifia_id: "0190f6e2-2c34-7c19-bb3a-9d2c4e8f1001",
    })
    const targets: string[] = []
    for (let i = 0; i < 25; i++) {
      targets.push(`[[s${i}]]`)
    }
    hub += targets.join(" ")
    writeNote(dir, "hub", hub)
    for (let i = 0; i < 25; i++) {
      const sid = `0190f6e2-2c34-7c19-bb3a-9d2c4e8f1${(i + 100).toString().padStart(3, "0")}`
      writeNote(
        dir,
        `s${i}`,
        frontmatter({ unifia_id: sid }) + "satellite",
      )
    }
    const r = edgeDensity({ vaultRoot: dir })
    expect(r.maxDegree).toBe(25)
    expect(r.buckets["20+"]).toBe(1)
  })
})
