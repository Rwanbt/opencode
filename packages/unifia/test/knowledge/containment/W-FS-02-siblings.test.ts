/* SPDX-License-Identifier: MIT */
/**
 * P2 (maxDepth) — one over-deep subtree must not hide the rest of the vault.
 *
 * The first `maxDepth` implementation returned from the walk as soon as any
 * subtree hit the bound. The bound was respected and the truncation was
 * recorded, but every sibling *after* the deep directory went unvisited: a
 * single stray tree could drop most of a vault out of every listing,
 * search and count. Worse, the record was a boolean on the source that no
 * production consumer read, so the smaller number was reported as the
 * answer.
 *
 * Two properties, then. Depth truncates a branch, not the walk. And what was
 * cut reaches something a user can see.
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test"
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { VaultSource } from "../../../src/knowledge/source/vault.js"

const SPACE = { kind: "personal", id: "p", label: "P" } as const

function note(id: string): string {
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
    "unifia_tags: []",
    "---",
    `body ${id}`,
  ].join("\n")
}

describe("P2 — maxDepth truncates a branch, not the vault", () => {
  let root: string
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "unifia-p2depth-"))
  })
  afterEach(() => rmSync(root, { recursive: true, force: true }))

  /**
   * `a-deep/` sits before `z-shallow/` alphabetically, so a walk that
   * returns on the first truncation loses the sibling on every platform
   * whose `readdir` is ordered.
   */
  function seedDeepAndShallow(): void {
    const deep = join(root, "a-deep", "l1", "l2", "l3", "l4")
    mkdirSync(deep, { recursive: true })
    writeFileSync(join(deep, "buried.md"), note("1"))
    writeFileSync(join(root, "a-deep", "shallow-in-deep.md"), note("2"))

    mkdirSync(join(root, "z-shallow"), { recursive: true })
    writeFileSync(join(root, "z-shallow", "visible.md"), note("3"))
    writeFileSync(join(root, "top.md"), note("4"))
  }

  it("still lists the siblings that follow a truncated subtree", async () => {
    seedDeepAndShallow()
    const src = new VaultSource({ root, space: SPACE, maxDepth: 2 })
    const locators = await src.locators()

    expect(src.lastScan.truncated).toBe(true)
    expect(src.lastScan.reason).toBe("maxDepth")
    // The bound did its job: the buried note is out of reach.
    expect(locators).not.toContain("a-deep/l1/l2/l3/l4/buried.md")
    // And everything the bound does not cover is still there — this is the
    // part the early return destroyed.
    expect(locators).toContain("top.md")
    expect(locators).toContain("z-shallow/visible.md")
    expect(locators).toContain("a-deep/shallow-in-deep.md")
  })

  it("names the subtrees it refused to descend into, and bounds the list", async () => {
    seedDeepAndShallow()
    const src = new VaultSource({ root, space: SPACE, maxDepth: 2 })
    await src.locators()

    expect(src.lastScan.truncatedPaths.length).toBeGreaterThan(0)
    expect(src.lastScan.truncatedPaths.length).toBeLessThanOrEqual(20)
    expect(src.lastScan.truncatedPaths.some((p) => p.startsWith("a-deep/"))).toBe(true)
  })

  it("reports a complete walk as complete", async () => {
    seedDeepAndShallow()
    const src = new VaultSource({ root, space: SPACE, maxDepth: 50 })
    const locators = await src.locators()

    expect(src.lastScan.truncated).toBe(false)
    expect(src.lastScan.reason).toBeNull()
    expect(src.lastScan.truncatedPaths).toEqual([])
    expect(locators).toContain("a-deep/l1/l2/l3/l4/buried.md")
  })

  it("clears the truncation state between scans", async () => {
    seedDeepAndShallow()
    const src = new VaultSource({ root, space: SPACE, maxDepth: 2 })
    await src.locators()
    expect(src.lastScan.truncated).toBe(true)

    rmSync(join(root, "a-deep"), { recursive: true, force: true })
    await src.locators()
    expect(src.lastScan.truncated).toBe(false)
    expect(src.lastScan.truncatedPaths).toEqual([])
  })

  it("surfaces the truncation through list(), not only through the walk", async () => {
    seedDeepAndShallow()
    const src = new VaultSource({ root, space: SPACE, maxDepth: 2 })
    const notes = await src.list({})

    // A count taken from a truncated scan is a floor, and the source says so.
    expect(notes.length).toBeGreaterThan(0)
    expect(src.lastScan.truncated).toBe(true)
  })
})
