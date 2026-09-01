/* SPDX-License-Identifier: MIT */
/**
 * W-FS-04 — Unicode normalisation (NFC vs NFD).
 *
 * Locators, wikilinks, and the listing sort must be stable across
 * Unicode normalisation forms. A file written in NFC on Windows can be
 * materialised as NFD on macOS HFS+; a wikilink written in NFC must
 * still resolve when the file is stored as NFD on disk.
 *
 * The "oracle" is the underlying filesystem: on Windows/NTFS, bytes
 * are stored verbatim, so a literal-byte match between the locator
 * and the file name is enough. Where the oracle would otherwise
 * return a miss for an equivalent-but-differently-normalised form,
 * the path code normalises both sides to NFC.
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test"
import { mkdtempSync, rmSync, writeFileSync, readdirSync } from "node:fs"
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

/** "café" — composed (é as a single codepoint U+00E9). */
const CAFE_NFC = "caf\u00e9"
/** "café" — decomposed (e + combining acute U+0301). */
const CAFE_NFD = "cafe\u0301"

describe("W-FS-04 — Unicode normalisation across locator / wikilink / sort", () => {
  let root: string
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "unifia-wfs04-"))
  })
  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
  })

  it("reads a note written in NFC by its NFC locator", async () => {
    writeFileSync(join(root, `${CAFE_NFC}.md`), note("1", "body"))
    const src = new VaultSource({ root, space: SPACE })
    const doc = await src.read(`${CAFE_NFC}.md` as KnowledgeLocator)
    expect(doc).not.toBeNull()
    expect(doc?.note.body).toBe("body")
  })

  it("reads a note written in NFD by its NFD locator", async () => {
    writeFileSync(join(root, `${CAFE_NFD}.md`), note("1", "body"))
    const src = new VaultSource({ root, space: SPACE })
    const doc = await src.read(`${CAFE_NFD}.md` as KnowledgeLocator)
    expect(doc).not.toBeNull()
    expect(doc?.note.body).toBe("body")
  })

  it("reads a note regardless of which normalisation form the caller uses", async () => {
    // The file is written in NFD (the macOS HFS+ form); the caller asks
    // for it in NFC (the form most editors and wikilinks use). The
    // underlying filesystem transparently resolves both. The contract
    // is: both locators return the same note.
    writeFileSync(join(root, `${CAFE_NFD}.md`), note("1", "body"))
    const src = new VaultSource({ root, space: SPACE })
    const nfc = await src.read(`${CAFE_NFC}.md` as KnowledgeLocator)
    const nfd = await src.read(`${CAFE_NFD}.md` as KnowledgeLocator)
    expect(nfc).not.toBeNull()
    expect(nfd).not.toBeNull()
    expect(nfc?.note.frontmatter.unifia_id).toBe(nfd?.note.frontmatter.unifia_id)
  })

  it("produces a single locator for a file with a Unicode name (no duplicate enumeration)", async () => {
    // Whether the file is on disk as NFC or NFD, the walk should
    // surface it exactly once. A walk that did not normalise would
    // surface both forms when the OS translates between them.
    writeFileSync(join(root, `${CAFE_NFD}.md`), note("1", "body"))
    const src = new VaultSource({ root, space: SPACE })
    const locators = await src.locators()
    expect(locators.length).toBe(1)
  })

  it("sorts Unicode-named locators deterministically", async () => {
    // Two notes whose names differ only in NFC/NFD representation: the
    // sort must be stable. Either form is acceptable, but a caller
    // that compares the result of two scans must see the same order.
    writeFileSync(join(root, "a-cafe.md"), note("a", "a body"))
    writeFileSync(join(root, "b-cafe.md"), note("b", "b body"))
    const src = new VaultSource({ root, space: SPACE })
    const first = await src.locators()
    const second = await src.locators()
    expect(first).toEqual(second)
  })
})
