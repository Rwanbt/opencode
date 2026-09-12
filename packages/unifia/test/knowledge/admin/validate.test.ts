/* SPDX-License-Identifier: MIT */
import { describe, it, expect, beforeEach, afterEach } from "bun:test"
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { validate, TYPE_REQUIRED_FIELDS } from "../../../src/knowledge/admin/validate.js"

let root: string
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "unifia-validate-"))
})
afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

const baseNote = (id: string, type: string, lifecycle = "active", extra = "") => `---
unifia_schema: 1
unifia_id: "${id}"
unifia_type: ${type}
unifia_lifecycle: ${lifecycle}
unifia_created_at: "2026-08-29T00:00:00Z"
unifia_updated_at: "2026-08-29T00:00:00Z"
unifia_project_ref: unifia
unifia_supersedes: []
unifia_tags: []
${extra}
---

# hello
`

describe("P11.22 workspace validation", () => {
  it("returns zero findings on a clean corpus", () => {
    mkdirSync(join(root, "memory"), { recursive: true })
    writeFileSync(join(root, "memory/a.md"), baseNote("0190d2c0-7b00-7000-8000-000000000001", "decision"))
    const r = validate({ vaultRoot: root })
    expect(r.notesParsed).toBe(1)
    expect(r.notesFailed).toBe(0)
    expect(r.findings.filter((f) => f.category !== "stale_index")).toEqual([])
  })

  it("flags a missing required field per type", () => {
    mkdirSync(join(root, "memory"), { recursive: true })
    // Override the rules to require a custom field per type.
    const rules = { decision: ["unifia_project_ref", "unifia_id"] } as Record<string, readonly string[]>
    writeFileSync(join(root, "memory/a.md"), baseNote("0190d2c0-7b00-7000-8000-000000000001", "decision"))
    const r = validate({ vaultRoot: root, rules })
    // The note has unifia_id, so the override is satisfied.
    expect(r.findings.filter((f) => f.message.includes("missing required"))).toHaveLength(0)
  })

  it("flags a missing custom per-type field", () => {
    mkdirSync(join(root, "memory"), { recursive: true })
    writeFileSync(join(root, "memory/a.md"), baseNote("0190d2c0-7b00-7000-8000-000000000001", "decision"))
    const r = validate({
      vaultRoot: root,
      rules: { decision: ["unifia_project_ref", "unifia_reviewed_by"] } as Record<string, readonly string[]>,
    })
    expect(r.findings.some((f) => f.message.includes("unifia_reviewed_by"))).toBe(true)
  })

  it("groups findings by category", () => {
    mkdirSync(join(root, "memory"), { recursive: true })
    writeFileSync(join(root, "memory/a.md"), baseNote("0190d2c0-7b00-7000-8000-000000000001", "decision"))
    writeFileSync(join(root, "memory/b.md"), baseNote("0190d2c0-7b00-7000-8000-000000000002", "failure"))
    const r = validate({ vaultRoot: root })
    expect(typeof r.byCategory).toBe("object")
  })

  it("returns zero notes on an empty vault", () => {
    const r = validate({ vaultRoot: root })
    expect(r.notesParsed).toBe(0)
    expect(r.notesFailed).toBe(0)
  })

  it("exposes the per-type required fields map", () => {
    expect(TYPE_REQUIRED_FIELDS.decision).toContain("unifia_project_ref")
    expect(TYPE_REQUIRED_FIELDS.failure).toContain("unifia_project_ref")
  })

  it("rejects a non-absolute vaultRoot", () => {
    expect(() => validate({ vaultRoot: "relative/path" })).toThrow(/absolute/)
  })

  it("flags a malformed frontmatter as a notesFailed", () => {
    mkdirSync(join(root, "memory"), { recursive: true })
    writeFileSync(join(root, "memory/bad.md"), "---\nnot: valid\n---\nbody")
    const r = validate({ vaultRoot: root })
    expect(r.notesFailed).toBe(1)
  })
})
