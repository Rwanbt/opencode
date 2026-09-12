/* SPDX-License-Identifier: MIT */
import { describe, it, expect, beforeEach, afterEach } from "bun:test"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { sizeDistribution } from "../../../src/knowledge/admin/size-distribution.js"

function writeNote(dir: string, name: string, content: string): void {
  writeFileSync(join(dir, `${name}.md`), content, "utf8")
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
  dir = mkdtempSync(join(tmpdir(), "size-dist-"))
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe("P11.53 size distribution", () => {
  it("rejects non-absolute vaultRoot", () => {
    expect(() => sizeDistribution({ vaultRoot: "relative" })).toThrow(
      /vaultRoot must be absolute/,
    )
  })

  it("returns zero counts on an empty vault", () => {
    const r = sizeDistribution({ vaultRoot: dir })
    expect(r.scanned).toBe(0)
    expect(r.totalBytes).toBe(0)
    expect(r.medianBytes).toBe(0)
    expect(r.meanBytes).toBe(0)
    expect(r.maxBytes).toBe(0)
    expect(r.minBytes).toBe(0)
  })

  it("puts a small note in the 0-1KB bin", () => {
    writeNote(dir, "small", frontmatter({}) + "small body")
    const r = sizeDistribution({ vaultRoot: dir })
    expect(r.scanned).toBe(1)
    expect(r.bins["0-1KB"]).toBe(1)
    expect(r.bins["1-5KB"]).toBe(0)
  })

  it("puts a 2KB note in the 1-5KB bin", () => {
    const body = "x".repeat(2 * 1024)
    writeNote(dir, "mid", frontmatter({}) + body)
    const r = sizeDistribution({ vaultRoot: dir })
    expect(r.bins["1-5KB"]).toBe(1)
  })

  it("computes min/max/total correctly", () => {
    writeNote(dir, "a", frontmatter({}) + "a".repeat(100))
    writeNote(dir, "b", frontmatter({ unifia_id: "0190f6e2-2c34-7c19-bb3a-9d2c4e8f1002" }) + "b".repeat(500))
    const r = sizeDistribution({ vaultRoot: dir })
    expect(r.scanned).toBe(2)
    expect(r.minBytes).toBeLessThan(r.maxBytes)
    expect(r.totalBytes).toBeGreaterThan(r.minBytes)
    expect(r.totalBytes).toBeLessThan(r.minBytes + r.maxBytes + 2000)
  })

  it("computes median for odd count", () => {
    writeNote(dir, "a", frontmatter({}) + "a".repeat(100))
    writeNote(dir, "b", frontmatter({ unifia_id: "0190f6e2-2c34-7c19-bb3a-9d2c4e8f1002" }) + "b".repeat(300))
    writeNote(dir, "c", frontmatter({ unifia_id: "0190f6e2-2c34-7c19-bb3a-9d2c4e8f1003" }) + "c".repeat(500))
    const r = sizeDistribution({ vaultRoot: dir })
    expect(r.scanned).toBe(3)
    expect(r.medianBytes).toBeGreaterThan(0)
  })

  it("puts a very large note in the 1MB+ bin", () => {
    const body = "x".repeat(2 * 1024 * 1024) // 2 MB body
    writeNote(dir, "huge", frontmatter({}) + body)
    const r = sizeDistribution({ vaultRoot: dir })
    expect(r.bins["1MB+"]).toBe(1)
  })
})
