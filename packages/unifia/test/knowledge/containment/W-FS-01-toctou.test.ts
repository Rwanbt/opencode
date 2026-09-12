/* SPDX-License-Identifier: MIT */
/**
 * W-FS-01 — TOCTOU on read: refuse when the file's real identity changes
 * between the canonical-path validation and the read.
 *
 * The read path validates the canonical real path of a locator, then reads
 * the file at the lexical path. If a concurrent actor swaps the lexical
 * entry for a symlink pointing outside the vault after validation, the
 * read would otherwise follow the swap and exfiltrate the target.
 *
 * The contract: read must happen via the validated canonical path. If the
 * identity the kernel resolves at read time differs from the identity
 * captured at validation, the call must refuse with a typed error.
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test"
import { mkdtempSync, rmSync, writeFileSync, symlinkSync, renameSync, unlinkSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { KnowledgeLocator } from "@unifia/contracts/knowledge"
import { VaultSource } from "../../../src/knowledge/source/vault.js"
import { KnowledgeFailure } from "../../../src/knowledge/domain/errors.js"

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

describe("W-FS-01 — TOCTOU on VaultSource.read", () => {
  let root: string
  let outside: string
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "unifia-wfs01-"))
    outside = mkdtempSync(join(tmpdir(), "unifia-wfs01-out-"))
    writeFileSync(join(root, "inside.md"), note("1"))
    writeFileSync(join(outside, "secret.md"), "TOP_SECRET outside the vault\n")
  })
  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
    rmSync(outside, { recursive: true, force: true })
  })

  it("refuses a swap that replaces the in-vault file with an outside link (lexical swap)", async () => {
    // Capture the canonical real identity of inside.md BEFORE the swap.
    const src = new VaultSource({ root, space: SPACE })
    // Force the canonical real path to be captured by calling read() once.
    const before = await src.read("inside.md" as KnowledgeLocator)
    expect(before).not.toBeNull()

    // Swap: delete the in-vault file and replace it with a symlink to outside.
    unlinkSync(join(root, "inside.md"))
    try {
      symlinkSync(join(outside, "secret.md"), join(root, "inside.md"))
    } catch {
      // Link creation unavailable in this environment — accept the skip.
      return
    }

    // The second read must refuse: the canonical real path is no longer
    // the in-vault file's inode.
    await expect(src.read("inside.md" as KnowledgeLocator)).rejects.toThrow(
      /identity changed|outside the vault|escapes the vault root|swapped/i,
    )
  })

  it("returns the in-vault content when the file is renamed but not replaced (no identity change at the inode)", async () => {
    const src = new VaultSource({ root, space: SPACE })
    // A pure rename to a new in-vault name is not a containment violation.
    // The renamed file should remain reachable under its new locator.
    renameSync(join(root, "inside.md"), join(root, "renamed.md"))
    const doc = await src.read("renamed.md" as KnowledgeLocator)
    expect(doc).not.toBeNull()
    expect(doc?.note.body).toContain("body of 1")
  })

  it("refuses a swap that redirects a directory entry inside the vault to a junction pointing outside", async () => {
    const src = new VaultSource({ root, space: SPACE })

    // A directory link inside the vault already fails containment; this
    // test pins that the read path surfaces a typed error rather than
    // serving the outside content.
    try {
      symlinkSync(outside, join(root, "escape"), "junction")
    } catch {
      return // junction creation unavailable in this environment
    }
    writeFileSync(join(outside, "secret.md"), "TOP_SECRET outside the vault\n")
    await expect(src.read("escape/secret.md" as KnowledgeLocator)).rejects.toThrow(
      /outside the vault root|escapes the vault root|identity changed|swapped/i,
    )
  })

  it("does not throw a typed error when the file simply does not exist", async () => {
    const src = new VaultSource({ root, space: SPACE })
    const doc = await src.read("nope.md" as KnowledgeLocator)
    expect(doc).toBeNull()
  })

  it("throws a KnowledgeFailure (not a generic Error) on identity change", async () => {
    const src = new VaultSource({ root, space: SPACE })
    // Pre-validate the file's identity by reading once.
    await src.read("inside.md" as KnowledgeLocator)

    unlinkSync(join(root, "inside.md"))
    try {
      symlinkSync(join(outside, "secret.md"), join(root, "inside.md"))
    } catch {
      return // symlink unavailable
    }

    let caught: unknown
    try {
      await src.read("inside.md" as KnowledgeLocator)
    } catch (e) {
      caught = e
    }
    expect(caught).toBeInstanceOf(KnowledgeFailure)
  })
})
