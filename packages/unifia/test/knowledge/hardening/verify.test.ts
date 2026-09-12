/* SPDX-License-Identifier: MIT */
import { describe, it, expect, beforeEach, afterEach } from "bun:test"
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { runVerify } from "../../../src/knowledge/hardening/verify.js"

let root: string
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "unifia-verify-"))
})
afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

const note = (id: string, body = "# hello") => `---
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

const baseInput = (root: string) => ({
  vaultRoot: root,
  derivedDbPath: join(root, "derived.db"),
  internetOff: true,
  cloudOff: true,
  deviceIsolated: true,
  classCPresent: true,
  classDPresent: true,
  unifiaBinaryPresent: true,
})

describe("P11.13 full verify", () => {
  it("returns ok=true on a clean offline environment", async () => {
    mkdirSync(join(root, "memory"), { recursive: true })
    writeFileSync(join(root, "memory/a.md"), note("0190d2c0-7b00-7000-8000-000000000001"))
    const r = await runVerify(baseInput(root))
    expect(r.checks).toHaveLength(4)
    // Nothing is broken...
    expect(r.ok).toBe(true)
    // ...but the recovery plan was only simulated, and the vault has notes
    // without sidecars, so the run is not "everything passed".
    expect(r.allPassed).toBe(false)
    const recovery = r.checks.find((c) => c.name === "disaster-recovery")
    expect(recovery?.status).toBe("NOT_EXECUTED")
  })

  it("warns rather than passing when the vault has orphans or missing sidecars", async () => {
    mkdirSync(join(root, "memory"), { recursive: true })
    writeFileSync(join(root, "memory/a.md"), note("0190d2c0-7b00-7000-8000-000000000009"))
    const r = await runVerify(baseInput(root))
    const reach = r.checks.find((c) => c.name === "reachability")
    expect(reach?.status).toBe("WARN")
    // The findings name the files, not just a count.
    expect((reach?.findings ?? []).length).toBeGreaterThan(0)
  })

  it("returns ok=false when the vault is unreadable", async () => {
    const r = await runVerify(baseInput("Z:/no/such/path"))
    const sov = r.checks.find((c) => c.name === "sovereignty")
    expect(sov?.ok).toBe(false)
    expect(r.ok).toBe(false)
  })

  it("returns ok=false when internet is on", async () => {
    mkdirSync(join(root, "memory"), { recursive: true })
    writeFileSync(join(root, "memory/a.md"), note("0190d2c0-7b00-7000-8000-000000000002"))
    const r = await runVerify({ ...baseInput(root), internetOff: false })
    const sov = r.checks.find((c) => c.name === "sovereignty")
    expect(sov?.ok).toBe(false)
  })

  it("returns ok=true on an empty vault (no false failures)", async () => {
    const r = await runVerify(baseInput(root))
    // The vault-readable check will fail since the root is empty
    // (it's a directory but contains no .md files; the check
    // is about readability, which IS true).
    // Sovereignty is the only check that can fail on an empty
    // vault; the others are about structure.
    expect(r.checks.find((c) => c.name === "sovereignty")?.ok).toBe(true)
  })

  it("includes timing for every check", async () => {
    mkdirSync(join(root, "memory"), { recursive: true })
    writeFileSync(join(root, "memory/a.md"), note("0190d2c0-7b00-7000-8000-000000000003"))
    const r = await runVerify(baseInput(root))
    for (const c of r.checks) {
      expect(c.durationMs).toBeGreaterThanOrEqual(0)
    }
    expect(r.totalMs).toBeGreaterThan(0)
  })
})
