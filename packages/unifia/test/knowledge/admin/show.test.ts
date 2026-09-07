/* SPDX-License-Identifier: MIT */
import { describe, it, expect, beforeEach, afterEach } from "bun:test"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { showNote } from "../../../src/knowledge/admin/show.js"

let root: string
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "unifia-show-"))
})
afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

describe("P11.31 note display", () => {
  it("returns the full content of a note", () => {
    const text = `---
unifia_id: "0190d2c0-7b00-7000-8000-000000000001"
---

# hello
`
    writeFileSync(join(root, "a.md"), text)
    const r = showNote({ workspaceRoot: root, locator: "a.md" })
    expect(r).toContain("unifia_id")
    expect(r).toContain("# hello")
  })

  it("rejects a non-absolute workspaceRoot", () => {
    expect(() => showNote({ workspaceRoot: "relative/path", locator: "a.md" })).toThrow(/absolute/)
  })

  it("rejects a missing note", () => {
    expect(() => showNote({ workspaceRoot: root, locator: "missing.md" })).toThrow(/not found/)
  })
})
