/* SPDX-License-Identifier: MIT */
import { describe, it, expect, beforeEach, afterEach } from "bun:test"
import { mkdtempSync, rmSync, existsSync, readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import {
  readPortableStore,
  writePortableStore,
  upsertPortableEntry,
  removePortableEntry,
  listPortableEntries,
  PORTABLE_FILE,
  type PortableStore,
} from "../../../src/knowledge/classb/portable-store.js"

let root: string
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "unifia-portable-"))
})
afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

describe("P2.6 portable store — I/O", () => {
  it("readPortableStore returns an empty store when the file is absent", () => {
    const s = readPortableStore(root)
    expect(s.entries).toEqual({})
    expect(s.version).toBe(1)
  })

  it("writePortableStore creates the .unifia/portable directory and the file", () => {
    const store: PortableStore = {
      entries: { a: { alias: "a", locator: "x.md", revision: 0 } },
      version: 1,
      updatedAt: "2026-08-29T00:00:00Z",
    }
    writePortableStore(root, store)
    expect(existsSync(resolve(root, PORTABLE_FILE))).toBe(true)
    const text = readFileSync(resolve(root, PORTABLE_FILE), "utf8")
    expect(text).toContain('"alias": "a"')
  })

  it("upsertPortableEntry adds an entry with revision 0", () => {
    const s = upsertPortableEntry(root, "k1", "memory/k1.md", undefined)
    expect(s.entries["k1"]?.locator).toBe("memory/k1.md")
    expect(s.entries["k1"]?.revision).toBe(0)
  })

  it("upsertPortableEntry increments revision on re-upsert", () => {
    upsertPortableEntry(root, "k1", "memory/k1.md", undefined)
    const s = upsertPortableEntry(root, "k1", "memory/k1.md", "github")
    expect(s.entries["k1"]?.revision).toBe(1)
    expect(s.entries["k1"]?.externalSource).toBe("github")
  })

  it("removePortableEntry deletes an entry", () => {
    upsertPortableEntry(root, "k1", "memory/k1.md", undefined)
    const s = removePortableEntry(root, "k1")
    expect(s.entries["k1"]).toBeUndefined()
  })

  it("removePortableEntry is a no-op when the entry is absent", () => {
    const s = removePortableEntry(root, "nope")
    expect(s.entries).toEqual({})
  })

  it("listPortableEntries returns all entries", () => {
    upsertPortableEntry(root, "k1", "memory/k1.md", undefined)
    upsertPortableEntry(root, "k2", "memory/k2.md", undefined)
    const all = listPortableEntries(root)
    expect(all).toHaveLength(2)
  })

  it("round-trips through disk (write → read)", () => {
    upsertPortableEntry(root, "k1", "memory/k1.md", undefined)
    const reread = readPortableStore(root)
    expect(reread.entries["k1"]?.locator).toBe("memory/k1.md")
  })

  it("rejects a non-absolute workspaceRoot", () => {
    expect(() => readPortableStore("relative/path")).toThrow(/absolute/)
    expect(() => writePortableStore("relative/path", { entries: {}, version: 1, updatedAt: "now" })).toThrow(/absolute/)
  })

  it("rejects a corrupt store file", () => {
    const { writeFileSync, mkdirSync } = require("node:fs")
    mkdirSync(resolve(root, ".unifia/portable"), { recursive: true })
    writeFileSync(resolve(root, PORTABLE_FILE), "{not json", "utf8")
    expect(() => readPortableStore(root)).toThrow()
  })
})
