/* SPDX-License-Identifier: MIT */
/**
 * VaultSource reads Class A from disk (card C1).
 *
 * Exercised against the real dev fixture corpus, not a synthetic registry:
 * the defect this closes was precisely that the only source the CLI ever used
 * returned two hardcoded notes.
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test"
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import type { KnowledgeLocator } from "@unifia/contracts/knowledge"
import { VaultSource } from "../../../src/knowledge/source/vault.js"

const DEV_FIXTURES = resolve(import.meta.dir, "../../../../../tests/knowledge/eval/dev")

const SPACE = { kind: "personal", id: "p", label: "Personal" } as const

function note(id: string, opts: { type?: string; lifecycle?: string; updated?: string } = {}) {
  return [
    "---",
    "unifia_schema: 1",
    `unifia_id: "0190d2c0-7b00-7000-8000-${id.padStart(12, "0")}"`,
    `unifia_type: "${opts.type ?? "decision"}"`,
    `unifia_lifecycle: "${opts.lifecycle ?? "active"}"`,
    "unifia_created_at: \"2026-08-01T00:00:00Z\"",
    `unifia_updated_at: "${opts.updated ?? "2026-08-29T00:00:00Z"}"`,
    "unifia_project_ref: \"unifia\"",
    "unifia_supersedes: []",
    "unifia_tags: []",
    "---",
    `body of ${id}`,
  ].join("\n")
}

describe("VaultSource against the dev fixtures", () => {
  const source = new VaultSource({ root: DEV_FIXTURES, space: SPACE })

  it("lists the real corpus, not a synthetic pair", async () => {
    const notes = await source.list({})
    // 12 markdown files, one of which (README.md) is not a note.
    expect(notes.length).toBe(11)
    expect(source.lastScanErrors.length).toBe(1)
    expect(source.lastScanErrors[0]?.locator).toBe("README.md")
  })

  it("reads a note by locator", async () => {
    const doc = await source.read("decision-thinking-budget.md" as KnowledgeLocator)
    expect(doc).not.toBeNull()
    expect(doc?.note.frontmatter.unifia_type).toBe("decision")
  })

  it("returns null for a locator that does not exist", async () => {
    expect(await source.read("no-such-note.md" as KnowledgeLocator)).toBeNull()
  })

  it("resolves a note by id", async () => {
    const listed = await source.list({})
    const target = listed[0]
    expect(target).toBeDefined()
    const doc = await source.read(undefined, target?.ref.id)
    expect(doc?.note.frontmatter.unifia_id).toBe(target?.ref.id ?? "")
  })

  it("refuses a locator escaping the vault root", async () => {
    await expect(
      source.read("../../../etc/passwd" as KnowledgeLocator),
    ).rejects.toThrow(/escapes the vault root/)
  })

  it("refuses to pretend it can watch", () => {
    expect(() => source.watch(() => {})).toThrow(/not implemented in V1/)
  })
})

describe("VaultSource filtering and bounds", () => {
  let root: string
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "unifia-vault-"))
    writeFileSync(join(root, "a.md"), note("1", { updated: "2026-08-01T00:00:00Z" }))
    writeFileSync(join(root, "b.md"), note("2", { type: "failure", updated: "2026-08-20T00:00:00Z" }))
    writeFileSync(join(root, "c.md"), note("3", { lifecycle: "archived", updated: "2026-08-10T00:00:00Z" }))
    mkdirSync(join(root, "sub"))
    writeFileSync(join(root, "sub", "d.md"), note("4", { updated: "2026-08-05T00:00:00Z" }))
  })
  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
  })

  it("walks subdirectories and normalises locators to POSIX separators", async () => {
    const src = new VaultSource({ root, space: SPACE })
    const locators = (await src.list({})).map((n) => n.ref.locator)
    expect(locators).toContain("sub/d.md")
  })

  it("honours the lifecycles filter", async () => {
    const src = new VaultSource({ root, space: SPACE })
    const notes = await src.list({ lifecycles: ["archived"] })
    expect(notes.map((n) => n.ref.locator)).toEqual(["c.md"])
  })

  it("honours the prefix filter", async () => {
    const src = new VaultSource({ root, space: SPACE })
    const notes = await src.list({ prefix: "sub/" as KnowledgeLocator })
    expect(notes.map((n) => n.ref.locator)).toEqual(["sub/d.md"])
  })

  it("honours the limit and returns newest first", async () => {
    const src = new VaultSource({ root, space: SPACE })
    const notes = await src.list({ limit: 2 })
    expect(notes.length).toBe(2)
    expect(notes[0]?.ref.locator).toBe("b.md")
  })

  it("returns an empty list for an empty vault", async () => {
    const empty = mkdtempSync(join(tmpdir(), "unifia-empty-"))
    try {
      const src = new VaultSource({ root: empty, space: SPACE })
      expect(await src.list({})).toEqual([])
    } finally {
      rmSync(empty, { recursive: true, force: true })
    }
  })

  it("skips a malformed note instead of failing the whole scan", async () => {
    writeFileSync(join(root, "broken.md"), "---\nnot: valid\n---\nbody")
    const src = new VaultSource({ root, space: SPACE })
    const notes = await src.list({})
    expect(notes.length).toBe(4)
    expect(src.lastScanErrors.map((e) => e.locator)).toEqual(["broken.md"])
  })

  it("requires an absolute root", () => {
    expect(() => new VaultSource({ root: "relative/path", space: SPACE })).toThrow(/absolute/)
  })
})
