/* SPDX-License-Identifier: MIT */
import { describe, it, expect, beforeEach, afterEach } from "bun:test"
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  listMarkdownLocators,
  scanReachability,
} from "../../../src/knowledge/classb/reachability.js"
import { upsertPortableEntry } from "../../../src/knowledge/classb/portable-store.js"

let root: string
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "unifia-reach-"))
})
afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

describe("P2.7 reachability scan", () => {
  it("listMarkdownLocators returns absolute-rooted .md files", () => {
    mkdirSync(join(root, "memory"), { recursive: true })
    writeFileSync(join(root, "memory/a.md"), "# a")
    writeFileSync(join(root, "memory/b.md"), "# b")
    writeFileSync(join(root, "memory/c.txt"), "not markdown")
    const locs = listMarkdownLocators(root)
    expect(locs.sort()).toEqual(["memory/a.md", "memory/b.md"])
  })

  it("ignores .git, .unifia, and node_modules", () => {
    mkdirSync(join(root, ".git/refs"), { recursive: true })
    mkdirSync(join(root, ".unifia/portable"), { recursive: true })
    mkdirSync(join(root, "node_modules/x"), { recursive: true })
    mkdirSync(join(root, "memory"), { recursive: true })
    writeFileSync(join(root, ".git/refs/main.md"), "# git")
    writeFileSync(join(root, ".unifia/portable/x.md"), "# unifia")
    writeFileSync(join(root, "node_modules/x/y.md"), "# nm")
    writeFileSync(join(root, "memory/a.md"), "# a")
    const locs = listMarkdownLocators(root)
    expect(locs).toEqual(["memory/a.md"])
  })

  it("scanReachability reports orphans and missing sidecars", () => {
    mkdirSync(join(root, "memory"), { recursive: true })
    writeFileSync(join(root, "memory/a.md"), "# a")
    writeFileSync(join(root, "memory/b.md"), "# b")
    upsertPortableEntry(root, "ka", "memory/a.md", undefined)
    upsertPortableEntry(root, "kor", "memory/orphan.md", undefined)
    const r = scanReachability(root)
    expect(r.reachable).toContain("memory/a.md")
    expect(r.orphans).toContain("memory/orphan.md")
    expect(r.missingSidecars).toContain("memory/b.md")
    expect(r.classALocators).toContain("memory/a.md")
  })

  it("scanReachability returns empty lists when the vault is empty", () => {
    const r = scanReachability(root)
    expect(r.classALocators).toEqual([])
    expect(r.reachable).toEqual([])
    expect(r.orphans).toEqual([])
    expect(r.missingSidecars).toEqual([])
  })

  it("rejects a non-absolute workspaceRoot", () => {
    expect(() => scanReachability("relative/path")).toThrow(/absolute/)
    expect(() => listMarkdownLocators("relative/path")).toThrow(/absolute/)
  })
})
