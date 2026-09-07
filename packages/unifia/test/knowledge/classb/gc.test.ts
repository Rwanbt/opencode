/* SPDX-License-Identifier: MIT */
import { describe, it, expect, beforeEach, afterEach } from "bun:test"
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  recommendGc,
  applyGcRecommendation,
} from "../../../src/knowledge/classb/gc.js"
import { upsertPortableEntry, readPortableStore } from "../../../src/knowledge/classb/portable-store.js"

let root: string
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "unifia-gc-"))
})
afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

describe("P2.8 Class B GC recommendation", () => {
  it("returns a noop when the store and the vault are both empty", () => {
    const r = recommendGc(root)
    expect(r.action).toBe("noop")
    expect(r.safeToApply).toBe(true)
  })

  it("returns a noop when everything is reachable and no missing sidecars", () => {
    mkdirSync(join(root, "memory"), { recursive: true })
    writeFileSync(join(root, "memory/a.md"), "# a")
    upsertPortableEntry(root, "ka", "memory/a.md", undefined)
    const r = recommendGc(root)
    expect(r.action).toBe("noop")
    expect(r.orphanAliases).toEqual([])
    expect(r.missingSidecarLocators).toEqual([])
  })

  it("flags orphans as candidates for removal", () => {
    mkdirSync(join(root, "memory"), { recursive: true })
    writeFileSync(join(root, "memory/a.md"), "# a")
    upsertPortableEntry(root, "ka", "memory/a.md", undefined)
    upsertPortableEntry(root, "kor", "memory/orphan.md", undefined)
    const r = recommendGc(root)
    expect(r.action).toBe("remove-orphans")
    expect(r.orphanAliases).toEqual(["kor"])
    expect(r.reachableAliases).toEqual(["ka"])
    expect(r.safeToApply).toBe(true)
  })

  it("flags missing sidecars and refuses safeToApply", () => {
    mkdirSync(join(root, "memory"), { recursive: true })
    writeFileSync(join(root, "memory/a.md"), "# a")
    writeFileSync(join(root, "memory/b.md"), "# b")
    upsertPortableEntry(root, "ka", "memory/a.md", undefined)
    const r = recommendGc(root)
    expect(r.action).toBe("rebuild-class-b")
    expect(r.missingSidecarLocators).toEqual(["memory/b.md"])
    expect(r.safeToApply).toBe(false)
  })

  it("applyGcRecommendation removes the orphans", () => {
    mkdirSync(join(root, "memory"), { recursive: true })
    writeFileSync(join(root, "memory/a.md"), "# a")
    upsertPortableEntry(root, "ka", "memory/a.md", undefined)
    upsertPortableEntry(root, "kor", "memory/orphan.md", undefined)
    const r = recommendGc(root)
    const after = applyGcRecommendation(root, r)
    expect(Object.keys(after.entries)).toEqual(["ka"])
    // Verify the file was updated.
    const reread = readPortableStore(root)
    expect(Object.keys(reread.entries)).toEqual(["ka"])
  })

  it("applyGcRecommendation refuses to apply when safeToApply is false", () => {
    mkdirSync(join(root, "memory"), { recursive: true })
    writeFileSync(join(root, "memory/a.md"), "# a")
    writeFileSync(join(root, "memory/b.md"), "# b")
    upsertPortableEntry(root, "ka", "memory/a.md", undefined)
    const r = recommendGc(root)
    expect(r.safeToApply).toBe(false)
    expect(() => applyGcRecommendation(root, r)).toThrow(/refusing/i)
  })

  it("applyGcRecommendation is a no-op when the recommendation is noop", () => {
    mkdirSync(join(root, "memory"), { recursive: true })
    writeFileSync(join(root, "memory/a.md"), "# a")
    upsertPortableEntry(root, "ka", "memory/a.md", undefined)
    const r = recommendGc(root)
    expect(r.action).toBe("noop")
    const after = applyGcRecommendation(root, r)
    expect(Object.keys(after.entries)).toEqual(["ka"])
  })

  it("rejects a non-absolute workspaceRoot", () => {
    expect(() => recommendGc("relative/path")).toThrow(/absolute/)
    expect(() => applyGcRecommendation("relative/path", { orphanAliases: [], reachableAliases: [], missingSidecarLocators: [], action: "noop", safeToApply: true, workspaceRoot: "x" })).toThrow(/absolute/)
  })
})
