/* SPDX-License-Identifier: MIT */
import { describe, it, expect, beforeEach, afterEach } from "bun:test"
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { scanBrokenLinks } from "../../../src/knowledge/admin/broken-links.js"

let root: string
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "unifia-broken-"))
})
afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

const note = (id: string, body: string) => `---
unifia_schema: 1
unifia_id: "${id}"
unifia_type: decision
unifia_lifecycle: active
unifia_created_at: "2026-08-29T00:00:00Z"
unifia_updated_at: "2026-08-29T00:00:00Z"
unifia_project_ref: unifia
unifia_supersedes: []
unifia_tags: []
---

${body}
`

describe("P11.28 broken-links scanner", () => {
  it("returns zero broken links on an empty vault", () => {
    const r = scanBrokenLinks({ vaultRoot: root })
    expect(r.totalBroken).toBe(0)
    expect(r.bySource).toEqual({})
  })

  it("finds a broken link", () => {
    mkdirSync(join(root, "memory"), { recursive: true })
    writeFileSync(
      join(root, "memory/a.md"),
      note("0190d2c0-7b00-7000-8000-000000000001", "See [[memory/missing]]."),
    )
    const r = scanBrokenLinks({ vaultRoot: root })
    expect(r.totalBroken).toBe(1)
    expect(r.bySource["memory/a.md"]).toHaveLength(1)
    expect(r.bySource["memory/a.md"]![0]?.raw).toBe("memory/missing")
  })

  it("ignores links to existing notes", () => {
    mkdirSync(join(root, "memory"), { recursive: true })
    writeFileSync(
      join(root, "memory/a.md"),
      note("0190d2c0-7b00-7000-8000-000000000002", "See [[memory/b]]."),
    )
    writeFileSync(
      join(root, "memory/b.md"),
      note("0190d2c0-7b00-7000-8000-000000000003", "I exist."),
    )
    const r = scanBrokenLinks({ vaultRoot: root })
    expect(r.totalBroken).toBe(0)
  })

  it("strips heading anchors when matching", () => {
    mkdirSync(join(root, "memory"), { recursive: true })
    writeFileSync(
      join(root, "memory/a.md"),
      note("0190d2c0-7b00-7000-8000-000000000004", "See [[memory/b#section]]."),
    )
    writeFileSync(
      join(root, "memory/b.md"),
      note("0190d2c0-7b00-7000-8000-000000000005", "I exist."),
    )
    const r = scanBrokenLinks({ vaultRoot: root })
    expect(r.totalBroken).toBe(0)
  })

  it("matches case-insensitively", () => {
    mkdirSync(join(root, "memory"), { recursive: true })
    writeFileSync(
      join(root, "memory/a.md"),
      note("0190d2c0-7b00-7000-8000-000000000006", "See [[MEMORY/B]]."),
    )
    writeFileSync(
      join(root, "memory/b.md"),
      note("0190d2c0-7b00-7000-8000-000000000007", "I exist."),
    )
    const r = scanBrokenLinks({ vaultRoot: root })
    expect(r.totalBroken).toBe(0)
  })

  it("groups findings by source", () => {
    mkdirSync(join(root, "memory"), { recursive: true })
    writeFileSync(
      join(root, "memory/a.md"),
      note("0190d2c0-7b00-7000-8000-000000000008", "See [[memory/x1]] and [[memory/x2]]."),
    )
    const r = scanBrokenLinks({ vaultRoot: root })
    expect(r.totalBroken).toBe(2)
    expect(r.bySource["memory/a.md"]?.length).toBe(2)
  })

  it("rejects a non-absolute vaultRoot", () => {
    expect(() => scanBrokenLinks({ vaultRoot: "relative/path" })).toThrow(/absolute/)
  })
})
