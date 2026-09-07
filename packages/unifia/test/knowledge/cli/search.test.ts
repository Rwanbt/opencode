/* SPDX-License-Identifier: MIT */
/**
 * The CLI searches the real vault (card C1).
 *
 * `makeRegistry()` declared two notes inline and `cmdSearch` used them, so
 * `search` answered `hits=2 scanned=2` for any query, including one whose
 * terms appeared nowhere. These tests drive the extracted runtime directly.
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test"
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { openWorkspace, resolveWorkspace, takeWorkspace } from "../../../src/cli/knowledge/runtime.js"

const DEV_FIXTURES = resolve(import.meta.dir, "../../../../../tests/knowledge/eval/dev")

const SEARCH = {
  spaces: [],
  types: [],
  tags: [],
  maxCandidates: 50,
  maxPayloadBytes: 1024 * 1024,
  maxSnippetBytes: 64 * 1024,
  deadlineMs: 2_000,
}

function note(id: string, body: string, tags: string[] = []) {
  return [
    "---",
    "unifia_schema: 1",
    `unifia_id: "0190d2c0-7b00-7000-8000-${id.padStart(12, "0")}"`,
    'unifia_type: "decision"',
    'unifia_lifecycle: "active"',
    'unifia_created_at: "2026-08-01T00:00:00Z"',
    'unifia_updated_at: "2026-08-29T00:00:00Z"',
    'unifia_project_ref: "unifia"',
    "unifia_supersedes: []",
    `unifia_tags: [${tags.map((t) => `"${t}"`).join(", ")}]`,
    "---",
    body,
  ].join("\n")
}

describe("C1 — the CLI runtime queries the real corpus", () => {
  it("scans the fixture vault, not two synthetic notes", async () => {
    const { service } = openWorkspace(DEV_FIXTURES)
    const { pack } = await service.search({ ...SEARCH, query: "egress" })
    expect(pack.diagnostics.candidatesScanned).toBe(11)
  })

  it("returns no hit for a term absent from the corpus", async () => {
    const { service } = openWorkspace(DEV_FIXTURES)
    const { pack } = await service.search({
      ...SEARCH,
      query: "term-that-does-not-exist-9f3c",
    })
    expect(pack.items).toHaveLength(0)
  })

  it("gives two different queries two different answers", async () => {
    const { service } = openWorkspace(DEV_FIXTURES)
    const a = await service.search({ ...SEARCH, query: "egress" })
    const b = await service.search({ ...SEARCH, query: "adreno" })
    const locatorsOf = (r: typeof a) => r.pack.items.map((i) => i.ref.locator).sort()
    expect(locatorsOf(a)).not.toEqual(locatorsOf(b))
    expect(locatorsOf(a).length).toBeGreaterThan(0)
    expect(locatorsOf(b).length).toBeGreaterThan(0)
  })

  it("finds the note that actually carries the term", async () => {
    const { service } = openWorkspace(DEV_FIXTURES)
    const { pack } = await service.search({ ...SEARCH, query: "adreno" })
    expect(pack.items.map((i) => i.ref.locator)).toContain("failure-adreno-kquants.md")
  })
})

describe("C1 — workspace resolution", () => {
  let root: string
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "unifia-cli-"))
    mkdirSync(join(root, "memory"))
    writeFileSync(join(root, "memory", "a.md"), note("1", "alpha beta", ["alpha"]))
  })
  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
  })

  it("returns an empty result for an empty workspace rather than inventing one", async () => {
    const empty = mkdtempSync(join(tmpdir(), "unifia-empty-cli-"))
    try {
      const { service } = openWorkspace(empty)
      const { pack } = await service.search({ ...SEARCH, query: "anything" })
      expect(pack.items).toHaveLength(0)
      expect(pack.diagnostics.candidatesScanned).toBe(0)
    } finally {
      rmSync(empty, { recursive: true, force: true })
    }
  })

  it("refuses a workspace that does not exist", () => {
    expect(() => openWorkspace(join(root, "missing"))).toThrow(/does not exist/)
  })

  it("resolves a relative path to an absolute one", () => {
    expect(resolveWorkspace(".")).toBe(resolve("."))
  })

  it("accepts --workspace and a leading positional the same way", () => {
    expect(takeWorkspace(["--workspace", "/w", "x"]).workspace).toBe("/w")
    expect(takeWorkspace(["/w", "x"]).workspace).toBe("/w")
    expect(takeWorkspace(["--flag"]).workspace).toBeUndefined()
  })

  it("does not serve a note the workspace policy denies locally", async () => {
    writeFileSync(
      join(root, "memory", "secret.md"),
      note("2", "alpha secret").replace(
        "unifia_supersedes: []",
        "unifia_supersedes: []\nunifia_restrictions:\n  local_model: deny",
      ),
    )
    const { service } = openWorkspace(root)
    const { pack } = await service.search({ ...SEARCH, query: "alpha" })
    expect(pack.items.map((i) => i.ref.locator)).not.toContain("secret.md")
  })
})
