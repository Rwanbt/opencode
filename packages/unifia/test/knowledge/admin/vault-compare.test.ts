/* SPDX-License-Identifier: MIT */
import { describe, it, expect, beforeEach, afterEach } from "bun:test"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { compareVaults } from "../../../src/knowledge/admin/vault-compare.js"

let dirA: string
let dirB: string

beforeEach(() => {
  dirA = mkdtempSync(join(tmpdir(), "vc-a-"))
  dirB = mkdtempSync(join(tmpdir(), "vc-b-"))
})

afterEach(() => {
  rmSync(dirA, { recursive: true, force: true })
  rmSync(dirB, { recursive: true, force: true })
})

function writeA(name: string, body: string): void {
  writeFileSync(join(dirA, `${name}.md`), body, "utf8")
}

function writeB(name: string, body: string): void {
  writeFileSync(join(dirB, `${name}.md`), body, "utf8")
}

describe("P11.43 vault compare", () => {
  it("returns zero diffs for two empty vaults", () => {
    const r = compareVaults({ vaultA: dirA, vaultB: dirB })
    expect(r.onlyA).toEqual([])
    expect(r.onlyB).toEqual([])
    expect(r.changed).toEqual([])
    expect(r.identical).toEqual([])
  })

  it("reports files only in A", () => {
    writeA("only-a", "content")
    const r = compareVaults({ vaultA: dirA, vaultB: dirB })
    expect(r.onlyA).toEqual(["only-a.md"])
    expect(r.onlyB).toEqual([])
  })

  it("reports files only in B", () => {
    writeB("only-b", "content")
    const r = compareVaults({ vaultA: dirA, vaultB: dirB })
    expect(r.onlyA).toEqual([])
    expect(r.onlyB).toEqual(["only-b.md"])
  })

  it("reports identical files when content matches", () => {
    writeA("x", "same content")
    writeB("x", "same content")
    const r = compareVaults({ vaultA: dirA, vaultB: dirB })
    expect(r.identical).toEqual(["x.md"])
    expect(r.changed).toEqual([])
  })

  it("reports changed files when content differs", () => {
    writeA("x", "AAA")
    writeB("x", "BBB")
    const r = compareVaults({ vaultA: dirA, vaultB: dirB })
    expect(r.identical).toEqual([])
    expect(r.changed).toEqual(["x.md"])
  })

  it("handles a mixed scenario", () => {
    writeA("only-a", "a")
    writeA("x", "AAA")
    writeA("both-unchanged", "same")
    writeB("only-b", "b")
    writeB("x", "BBB")
    writeB("both-unchanged", "same")
    const r = compareVaults({ vaultA: dirA, vaultB: dirB })
    expect(r.onlyA).toEqual(["only-a.md"])
    expect(r.onlyB).toEqual(["only-b.md"])
    expect(r.changed).toEqual(["x.md"])
    expect(r.identical).toEqual(["both-unchanged.md"])
    expect(r.fileCountA).toBe(3)
    expect(r.fileCountB).toBe(3)
  })

  it("rejects a non-absolute vaultA", () => {
    expect(() => compareVaults({ vaultA: "rel", vaultB: dirB })).toThrow(/absolute/)
  })

  it("rejects a non-absolute vaultB", () => {
    expect(() => compareVaults({ vaultA: dirA, vaultB: "rel" })).toThrow(/absolute/)
  })
})
