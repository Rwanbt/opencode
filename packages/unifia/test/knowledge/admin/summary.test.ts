/* SPDX-License-Identifier: MIT */
import { describe, it, expect, beforeEach, afterEach } from "bun:test"
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { summarise, formatSummaryOneLine } from "../../../src/knowledge/admin/summary.js"

let root: string
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "unifia-sum-"))
})
afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

const note = (id: string, type: string, lifecycle: string, body = "# hello") => `---
unifia_schema: 1
unifia_id: "${id}"
unifia_type: ${type}
unifia_lifecycle: ${lifecycle}
unifia_created_at: "2026-08-29T00:00:00Z"
unifia_updated_at: "2026-08-29T00:00:00Z"
unifia_project_ref: unifia
unifia_supersedes: []
unifia_tags: []
---

${body}
`

describe("P11.19 summary", () => {
  it("returns zero notes on an empty vault", () => {
    const s = summarise({ vaultRoot: root })
    expect(s.totalNotes).toBe(0)
    expect(s.parseFailures).toBe(0)
    expect(s.policyEgress).toBe("absent")
  })

  it("counts notes by lifecycle and type", () => {
    mkdirSync(join(root, "memory"), { recursive: true })
    writeFileSync(join(root, "memory/a.md"), note("0190d2c0-7b00-7000-8000-000000000001", "decision", "active"))
    writeFileSync(join(root, "memory/b.md"), note("0190d2c0-7b00-7000-8000-000000000002", "decision", "active"))
    writeFileSync(join(root, "memory/c.md"), note("0190d2c0-7b00-7000-8000-000000000003", "failure", "archived"))
    const s = summarise({ vaultRoot: root })
    expect(s.totalNotes).toBe(3)
    expect(s.byLifecycle.active).toBe(2)
    expect(s.byLifecycle.archived).toBe(1)
    expect(s.byType.decision).toBe(2)
    expect(s.byType.failure).toBe(1)
  })

  it("counts parse failures separately", () => {
    mkdirSync(join(root, "memory"), { recursive: true })
    writeFileSync(join(root, "memory/bad.md"), "---\nnot: valid\n---\nbody")
    writeFileSync(join(root, "memory/good.md"), note("0190d2c0-7b00-7000-8000-000000000099", "decision", "active"))
    const s = summarise({ vaultRoot: root })
    expect(s.totalNotes).toBe(2)
    expect(s.parseFailures).toBe(1)
    expect(s.byType.decision).toBe(1)
  })

  it("reports the policy egress and features", () => {
    mkdirSync(join(root, ".unifia"), { recursive: true })
    writeFileSync(join(root, ".unifia/policy.json"), JSON.stringify({
      version: 1,
      egress: "deny",
      egressByDestination: {},
      features: { embedding: false, mcpServer: true, gitAutoPush: false },
      defaultTokenTtlMs: 3600000,
      trustedDevices: [],
      updatedAt: "2026-08-29T00:00:00Z",
    }))
    const s = summarise({ vaultRoot: root })
    expect(s.policyEgress).toBe("deny")
    expect(s.policyFeatures?.mcpServer).toBe(true)
  })

  it("formats a one-line summary", () => {
    mkdirSync(join(root, ".unifia"), { recursive: true })
    writeFileSync(join(root, ".unifia/policy.json"), JSON.stringify({
      version: 1,
      egress: "allow",
      egressByDestination: {},
      features: { embedding: false, mcpServer: false, gitAutoPush: false },
      defaultTokenTtlMs: 3600000,
      trustedDevices: [],
      updatedAt: "2026-08-29T00:00:00Z",
    }))
    const s = summarise({ vaultRoot: root })
    const line = formatSummaryOneLine(s)
    expect(line).toContain("notes=0")
    expect(line).toContain("policy.egress=allow")
  })

  it("rejects a non-absolute vaultRoot", () => {
    expect(() => summarise({ vaultRoot: "relative/path" })).toThrow(/absolute/)
  })
})
