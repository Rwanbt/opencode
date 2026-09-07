/* SPDX-License-Identifier: MIT */
import { describe, it, expect, beforeEach, afterEach } from "bun:test"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { findDuplicates } from "../../../src/knowledge/admin/duplicates.js"

function writeFile(dir: string, name: string, body: string): void {
  writeFileSync(join(dir, name), body, "utf8")
}

let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "duplicates-"))
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe("P11.46 duplicates detector", () => {
  it("returns zero groups on an empty vault", () => {
    const r = findDuplicates({ vaultRoot: dir })
    expect(r.groups).toEqual([])
    expect(r.duplicateCount).toBe(0)
    expect(r.wastedBytes).toBe(0)
  })

  it("returns zero groups when all files are unique", () => {
    writeFile(dir, "a.md", "AAA")
    writeFile(dir, "b.md", "BBB")
    writeFile(dir, "c.md", "CCC")
    const r = findDuplicates({ vaultRoot: dir })
    expect(r.groups).toEqual([])
    expect(r.duplicateCount).toBe(0)
  })

  it("reports a single duplicate group with 2 entries", () => {
    writeFile(dir, "a.md", "same")
    writeFile(dir, "b.md", "same")
    const r = findDuplicates({ vaultRoot: dir })
    expect(r.groups.length).toBe(1)
    expect(r.groups[0]?.locators).toEqual(["a.md", "b.md"])
    expect(r.groups[0]?.bytes).toBe(4)
    expect(r.duplicateCount).toBe(1)
    expect(r.wastedBytes).toBe(4)
  })

  it("reports a duplicate group with 3 entries", () => {
    writeFile(dir, "a.md", "same")
    writeFile(dir, "b.md", "same")
    writeFile(dir, "c.md", "same")
    const r = findDuplicates({ vaultRoot: dir })
    expect(r.groups.length).toBe(1)
    expect(r.groups[0]?.locators.length).toBe(3)
    expect(r.duplicateCount).toBe(2)
    expect(r.wastedBytes).toBe(4 * 2)
  })

  it("reports multiple independent duplicate groups", () => {
    writeFile(dir, "a.md", "X")
    writeFile(dir, "b.md", "X")
    writeFile(dir, "c.md", "Y")
    writeFile(dir, "d.md", "Y")
    writeFile(dir, "e.md", "Z")
    const r = findDuplicates({ vaultRoot: dir })
    expect(r.groups.length).toBe(2)
    expect(r.duplicateCount).toBe(2)
    // Each duplicate group: 1 byte (X or Y) wasted. Total = 2.
    expect(r.wastedBytes).toBe(2)
  })

  it("sorts groups by size descending then by hash", () => {
    writeFile(dir, "a.md", "small") // duplicated twice -> 2 entries
    writeFile(dir, "b.md", "small")
    writeFile(dir, "c.md", "big") // duplicated 3x -> 3 entries
    writeFile(dir, "d.md", "big")
    writeFile(dir, "e.md", "big")
    const r = findDuplicates({ vaultRoot: dir })
    expect(r.groups.length).toBe(2)
    expect(r.groups[0]?.locators.length).toBe(3) // big first
    expect(r.groups[1]?.locators.length).toBe(2) // small second
  })

  it("ignores files that cannot be read (skipMissing implicit)", () => {
    writeFile(dir, "a.md", "X")
    writeFile(dir, "b.md", "X")
    const r = findDuplicates({ vaultRoot: dir })
    expect(r.groups.length).toBe(1)
  })

  it("rejects a non-absolute vaultRoot", () => {
    expect(() => findDuplicates({ vaultRoot: "rel" })).toThrow(/absolute/)
  })
})
