/* SPDX-License-Identifier: MIT */
import { describe, it, expect, beforeEach, afterEach } from "bun:test"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { listHeadings } from "../../../src/knowledge/admin/headings.js"

let root: string
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "unifia-head-"))
})
afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

describe("P11.29 headings lister", () => {
  it("returns an empty list for a note with no headings", () => {
    writeFileSync(join(root, "a.md"), "no headings here\njust plain prose")
    const r = listHeadings({ workspaceRoot: root, locator: "a.md" })
    expect(r).toEqual([])
  })

  it("lists the headings of a note", () => {
    const text = `# Title
intro

## Section A
body

## Section B
more body
`
    writeFileSync(join(root, "a.md"), text)
    const r = listHeadings({ workspaceRoot: root, locator: "a.md" })
    expect(r).toHaveLength(3)
    expect(r[0]?.level).toBe(1)
    expect(r[0]?.text).toBe("Title")
    expect(r[0]?.line).toBe(1)
    expect(r[1]?.text).toBe("Section A")
    expect(r[2]?.text).toBe("Section B")
  })

  it("reports the 1-indexed line number", () => {
    const text = `\n\n\n# Title
body`
    writeFileSync(join(root, "a.md"), text)
    const r = listHeadings({ workspaceRoot: root, locator: "a.md" })
    expect(r[0]?.line).toBe(4)
  })

  it("rejects a non-absolute workspaceRoot", () => {
    expect(() => listHeadings({ workspaceRoot: "relative/path", locator: "a.md" })).toThrow(/absolute/)
  })

  it("rejects a missing note", () => {
    expect(() => listHeadings({ workspaceRoot: root, locator: "missing.md" })).toThrow(/not found/)
  })
})
