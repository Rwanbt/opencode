/* SPDX-License-Identifier: MIT */
/**
 * W-FS-03 — maxNoteBytes: cap the size of a single note before the full
 * read.
 *
 * The walk records every `.md` under the vault and the read path loads
 * the entire file. A 500 MB note would pin that memory in the reader
 * even when downstream consumers only want a snippet. The bound is
 * `maxNoteBytes`; the size is checked before the full read so an
 * oversized note is rejected with a typed error rather than silently
 * loaded.
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test"
import { mkdtempSync, rmSync, writeFileSync, statSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { KnowledgeLocator } from "@unifia/contracts/knowledge"
import { VaultSource } from "../../../src/knowledge/source/vault.js"

const SPACE = { kind: "personal", id: "p", label: "P" } as const

function note(id: string, body: string): string {
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
    body,
  ].join("\n")
}

describe("W-FS-03 — maxNoteBytes on the read path", () => {
  let root: string
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "unifia-wfs03-"))
  })
  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
  })

  it("reads a small note within the default bound", async () => {
    writeFileSync(join(root, "small.md"), note("1", "tiny body"))
    const src = new VaultSource({ root, space: SPACE })
    const doc = await src.read("small.md" as KnowledgeLocator)
    expect(doc).not.toBeNull()
    expect(doc?.note.body).toBe("tiny body")
  })

  it("refuses a note larger than maxNoteBytes without reading it", async () => {
    // A 4 MB note with a 1 KB cap: the read must fail with a typed error
    // before loading the file into memory.
    const big = "x".repeat(4 * 1024 * 1024)
    writeFileSync(join(root, "big.md"), note("1", big))
    const src = new VaultSource({ root, space: SPACE, maxNoteBytes: 1024 })
    await expect(src.read("big.md" as KnowledgeLocator)).rejects.toThrow(
      /maxNoteBytes|exceeds/i,
    )
  })

  it("reads a note whose size is exactly at the bound", async () => {
    // The cap is inclusive: a file whose size equals maxNoteBytes
    // passes the check. The body size is irrelevant to the cap; the
    // total file size (frontmatter + body) is what is measured.
    const body = "x".repeat(1024)
    const filePath = join(root, "exact.md")
    writeFileSync(filePath, note("1", body))
    const fileSize = statSync(filePath).size
    const src = new VaultSource({ root, space: SPACE, maxNoteBytes: fileSize })
    const doc = await src.read("exact.md" as KnowledgeLocator)
    expect(doc).not.toBeNull()
    expect(doc?.note.body.length).toBe(body.length)
  })

  it("does not read a note at the bound + 1", async () => {
    // The cap is strict: a file one byte over maxNoteBytes is rejected.
    // Use a generous bound and write a file that exceeds it by 1.
    const body = "x".repeat(2048)
    const filePath = join(root, "plus1.md")
    writeFileSync(filePath, note("1", body))
    const fileSize = statSync(filePath).size
    const src = new VaultSource({ root, space: SPACE, maxNoteBytes: fileSize - 1 })
    await expect(src.read("plus1.md" as KnowledgeLocator)).rejects.toThrow(
      /maxNoteBytes|exceeds/i,
    )
  })

  it("reports oversize notes in the listing without aborting the scan", async () => {
    // The list() path also enforces maxNoteBytes; oversized notes become
    // scan errors rather than being silently loaded or killing the scan.
    const big = "x".repeat(2 * 1024)
    writeFileSync(join(root, "ok.md"), note("1", "fine"))
    writeFileSync(join(root, "big.md"), note("2", big))
    const src = new VaultSource({ root, space: SPACE, maxNoteBytes: 1024 })
    const notes = await src.list({})
    expect(notes.map((n) => n.ref.locator)).toEqual(["ok.md"])
    expect(src.lastScanErrors.length).toBe(1)
    expect(src.lastScanErrors[0]?.locator).toBe("big.md")
    expect(src.lastScanErrors[0]?.message).toMatch(/maxNoteBytes|exceeds/i)
  })

  it("refuses a non-positive maxNoteBytes rather than reading unbounded", async () => {
    writeFileSync(join(root, "small.md"), note("1", "tiny body"))
    // A bound of 0 is a contract violation, not a request to disable
    // the cap. The source refuses at construction so a misconfigured
    // caller cannot accidentally read an unbounded note.
    expect(() => new VaultSource({ root, space: SPACE, maxNoteBytes: 0 })).toThrow(
      /maxNoteBytes must be > 0/i,
    )
  })
})
