/* SPDX-License-Identifier: MIT */
/**
 * W-FS-02 — maxDepth: configurable depth limit on the filesystem walk,
 * visible truncation and reason metadata.
 *
 * The walk descends directories without bound: a pathological tree
 * (deeply nested, or a cycle that realpath did not catch) would consume
 * the stack. The bound is `maxDepth`, default 50. When the bound stops
 * the walk, callers can observe `truncated: true` and `reason: "maxDepth"`.
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test"
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs"
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
    `body of ${id}`,
  ].join("\n")
}

/** Build a tree of `levels` nested directories, each holding a single note. */
function buildDeepTree(root: string, levels: number): void {
  let path = root
  for (let i = 0; i < levels; i++) {
    path = join(path, `lvl${i}`)
    mkdirSync(path)
  }
  writeFileSync(join(path, "leaf.md"), note("leaf"))
}

describe("W-FS-02 — maxDepth on the walk", () => {
  let root: string
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "unifia-wfs02-"))
  })
  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
  })

  it("uses a default bound that tolerates realistic vault depths", async () => {
    // The default is 50 levels; a 30-level tree must still be listed in
    // full (no truncation), and the API does not require the caller to
    // know the bound in advance.
    buildDeepTree(root, 30)
    const src = new VaultSource({ root, space: SPACE })
    const locators = await src.locators()
    expect(locators.length).toBe(1)
    expect(src.lastScan.truncated).toBe(false)
  })

  it("truncates the walk with reason 'maxDepth' when the tree exceeds the bound", async () => {
    // 10 levels, bound 3: only the top 3 levels are listed, and the
    // caller can observe the reason.
    buildDeepTree(root, 10)
    const src = new VaultSource({ root, space: SPACE, maxDepth: 3 })
    const locators = await src.locators()
    // We expect 0 leaf at depth 10 (cut at depth 3), and the truncation
    // flag is observable.
    expect(src.lastScan.truncated).toBe(true)
    expect(src.lastScan.reason).toBe("maxDepth")
    // Nothing was actually listed because the leaf sits at depth 11.
    expect(locators.length).toBe(0)
  })

  it("does not truncate when the depth is exactly at the bound", async () => {
    // 3 levels, bound 3: the leaf at depth 3 is reachable.
    buildDeepTree(root, 3)
    const src = new VaultSource({ root, space: SPACE, maxDepth: 3 })
    const locators = await src.locators()
    expect(src.lastScan.truncated).toBe(false)
    expect(src.lastScan.reason).toBeNull()
    expect(locators.length).toBe(1)
  })

  it("truncates at N+1 but not at N (boundary check)", async () => {
    // depth N → no truncation; depth N+1 → truncation.
    buildDeepTree(root, 5)
    const ok = new VaultSource({ root, space: SPACE, maxDepth: 5 })
    expect((await ok.locators()).length).toBe(1)
    expect(ok.lastScan.truncated).toBe(false)

    const cut = new VaultSource({ root, space: SPACE, maxDepth: 4 })
    expect((await cut.locators()).length).toBe(0)
    expect(cut.lastScan.truncated).toBe(true)
    expect(cut.lastScan.reason).toBe("maxDepth")
  })

  it("refuses a non-positive maxDepth rather than walking unbounded", async () => {
    // A bound of 0 or a negative value is a contract violation, not a
    // request to disable the bound. The source refuses at construction
    // so a misconfigured caller cannot trigger an unbounded walk by
    // accident.
    expect(() => new VaultSource({ root, space: SPACE, maxDepth: 0 })).toThrow(
      /maxDepth must be >= 1/i,
    )
  })

  it("does not surface a stale truncation state across scans", async () => {
    // First scan: tree deeper than the bound, so truncation is true.
    buildDeepTree(root, 6)
    const src = new VaultSource({ root, space: SPACE, maxDepth: 3 })
    await src.locators()
    expect(src.lastScan.truncated).toBe(true)

    // Remove the deep tree; second scan: empty, no truncation.
    rmSync(root, { recursive: true, force: true })
    mkdirSync(root)
    const locators2 = await src.locators()
    expect(locators2.length).toBe(0)
    expect(src.lastScan.truncated).toBe(false)
    expect(src.lastScan.reason).toBeNull()
  })
})
