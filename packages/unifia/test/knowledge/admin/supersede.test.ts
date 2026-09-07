/* SPDX-License-Identifier: MIT */
import { describe, it, expect, beforeEach, afterEach } from "bun:test"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { planSupersede } from "../../../src/knowledge/admin/supersede.js"

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

const TARGET_ID = "0190f6e2-2c34-7c19-bb3a-9d2c4e8f1001"
const SUCCESSOR_ID = "0190f6e2-2c34-7c19-bb3a-9d2c4e8f1002"

let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "supersede-"))
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe("P11.34 supersede plan", () => {
  it("rejects when neither targetId nor targetLocator is given", () => {
    const r = planSupersede({
      vaultRoot: dir,
      source: "tester",
      reason: "x",
    })
    expect(r.ok).toBe(false)
    expect(r.reason).toMatch(/required/)
  })

  it("rejects when both targetId and targetLocator are given", () => {
    const r = planSupersede({
      vaultRoot: dir,
      targetId: TARGET_ID,
      targetLocator: "a.md",
      source: "tester",
      reason: "x",
    })
    expect(r.ok).toBe(false)
    expect(r.reason).toMatch(/mutually exclusive/)
  })

  it("rejects when source or reason is empty", () => {
    const r1 = planSupersede({ vaultRoot: dir, targetLocator: "a.md", source: "", reason: "x" })
    expect(r1.ok).toBe(false)
    const r2 = planSupersede({ vaultRoot: dir, targetLocator: "a.md", source: "x", reason: "" })
    expect(r2.ok).toBe(false)
  })

  it("returns ok=true with a supersede intent for an active target (no successor)", () => {
    writeNote(dir, "a", frontmatter({ unifia_id: TARGET_ID, unifia_lifecycle: "active" }))
    const r = planSupersede({
      vaultRoot: dir,
      targetLocator: "a.md",
      source: "tester",
      reason: "outdated",
    })
    expect(r.ok).toBe(true)
    expect(r.target?.id).toBe(TARGET_ID)
    expect(r.intent?.kind).toBe("supersede")
    expect(r.intent?.targetId).toBe(TARGET_ID)
    expect(r.intent?.reason).toBe("outdated")
    expect(r.warnings).toBeDefined()
  })

  it("rejects a non-active target (candidate, archived, superseded)", () => {
    for (const lc of ["candidate", "archived", "superseded"]) {
      writeNote(dir, "a", frontmatter({ unifia_id: TARGET_ID, unifia_lifecycle: lc }))
      const r = planSupersede({
        vaultRoot: dir,
        targetLocator: "a.md",
        source: "tester",
        reason: "x",
      })
      expect(r.ok).toBe(false)
      expect(r.reason).toMatch(/only 'active'/)
    }
  })

  it("rejects when the target does not exist", () => {
    const r = planSupersede({
      vaultRoot: dir,
      targetLocator: "missing.md",
      source: "tester",
      reason: "x",
    })
    expect(r.ok).toBe(false)
    expect(r.reason).toMatch(/not found/)
  })

  it("rejects when successorLocator points to a missing note", () => {
    writeNote(dir, "a", frontmatter({ unifia_id: TARGET_ID, unifia_lifecycle: "active" }))
    const r = planSupersede({
      vaultRoot: dir,
      targetLocator: "a.md",
      successorLocator: "missing.md",
      source: "tester",
      reason: "x",
    })
    expect(r.ok).toBe(false)
    expect(r.reason).toMatch(/successor not found/)
  })

  it("rejects when successor has an invalid lifecycle (archived)", () => {
    writeNote(dir, "a", frontmatter({ unifia_id: TARGET_ID, unifia_lifecycle: "active" }))
    writeNote(dir, "b", frontmatter({ unifia_id: SUCCESSOR_ID, unifia_lifecycle: "archived" }))
    const r = planSupersede({
      vaultRoot: dir,
      targetLocator: "a.md",
      successorLocator: "b.md",
      source: "tester",
      reason: "x",
    })
    expect(r.ok).toBe(false)
    expect(r.reason).toMatch(/successor lifecycle/)
  })

  it("accepts successor with active or candidate lifecycle", () => {
    writeNote(dir, "a", frontmatter({ unifia_id: TARGET_ID, unifia_lifecycle: "active" }))
    writeNote(dir, "b", frontmatter({ unifia_id: SUCCESSOR_ID, unifia_lifecycle: "candidate" }))
    const r = planSupersede({
      vaultRoot: dir,
      targetLocator: "a.md",
      successorLocator: "b.md",
      source: "tester",
      reason: "x",
    })
    expect(r.ok).toBe(true)
    expect(r.successor?.id).toBe(SUCCESSOR_ID)
    expect(r.warnings).toBeUndefined()
  })

  it("finds target by id and accepts plan", () => {
    writeNote(dir, "a", frontmatter({ unifia_id: TARGET_ID, unifia_lifecycle: "active" }))
    const r = planSupersede({
      vaultRoot: dir,
      targetId: TARGET_ID,
      source: "tester",
      reason: "x",
    })
    expect(r.ok).toBe(true)
    expect(r.target?.id).toBe(TARGET_ID)
  })

  it("rejects a non-absolute vaultRoot", () => {
    expect(() =>
      planSupersede({ vaultRoot: "rel", targetLocator: "a.md", source: "x", reason: "y" }),
    ).toThrow(/absolute/)
  })
})
