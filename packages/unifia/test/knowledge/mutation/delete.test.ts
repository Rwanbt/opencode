/* SPDX-License-Identifier: MIT */
/**
 * Deleting a note, the way Obsidian does (card C33, R-0017).
 *
 * V1 refused `delete` by construction, citing ADR-KNOW-0009. Six reviews of
 * the final report established the gap: the product promised the user the
 * right to see, edit, delete and export their own data, and for a
 * sovereignty product the absence of erasure is not a scope detail.
 *
 * What the ADR actually rejected was a *silent* destructive operation.
 * Deleting to a recorded, restorable trash is neither — which is also
 * exactly what Obsidian does by default.
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test"
import { mkdtempSync, rmSync, readFileSync, existsSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createHash } from "node:crypto"
import { VaultMutationWriter, TRASH_DIR } from "../../../src/knowledge/mutation/writer.js"
import { parseFrontmatter } from "../../../src/knowledge/parser/frontmatter.js"
import { VaultSource } from "../../../src/knowledge/source/vault.js"

const sha256 = (s: string) => createHash("sha256").update(s, "utf8").digest("hex")

const OPEN = {
  remoteModel: "deny",
  localModel: "allow",
  embeddable: "allow",
  exportable: "deny",
} as const

const SPACE = { kind: "personal", id: "p", label: "P" } as const

describe("C33 — delete removes the note and keeps it recoverable", () => {
  let root: string
  let writer: VaultMutationWriter
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "unifia-delete-"))
    writer = new VaultMutationWriter({ root })
  })
  afterEach(() => rmSync(root, { recursive: true, force: true }))

  const hashOf = (locator: string) => sha256(readFileSync(join(root, locator), "utf8"))

  async function seed(locator: string, body = "body") {
    await writer.apply({
      intent: {
        kind: "create",
        targetLocator: locator,
        newContent: { type: "decision", restrictions: OPEN, body },
        reason: "seed",
        source: "test",
      },
      reason: "r",
      source: "s",
    })
    return {
      id: parseFrontmatter(readFileSync(join(root, locator), "utf8")).frontmatter.unifia_id,
      hash: hashOf(locator),
    }
  }

  const del = (id: string, hash: string) =>
    writer.apply({
      intent: {
        kind: "delete",
        targetId: id,
        expectedVersionHash: hash,
        reason: "user asked",
        source: "operator",
      },
      reason: "r",
      source: "s",
    })

  it("removes the note from its locator", async () => {
    const { id, hash } = await seed("n.md")
    const r = await del(id, hash)
    expect(r.applied).toBe(true)
    expect(existsSync(join(root, "n.md"))).toBe(false)
  })

  it("takes the note out of listings and retrieval", async () => {
    const { id, hash } = await seed("n.md")
    await del(id, hash)
    const source = new VaultSource({ root, space: SPACE })
    expect(await source.list({})).toEqual([])
  })

  it("keeps the content in the trash rather than unlinking it", async () => {
    const { id, hash } = await seed("n.md", "still recoverable")
    const r = await del(id, hash)
    const trashed = readFileSync(join(root, TRASH_DIR, `${r.auditId}.md`), "utf8")
    expect(parseFrontmatter(trashed).body.trim()).toBe("still recoverable")
  })

  it("records the deletion in the WAL with no new hash", async () => {
    const { id, hash } = await seed("n.md")
    await del(id, hash)
    const entry = writer.readWal().find((e) => e.kind === "delete")
    expect(entry).toBeDefined()
    expect(entry?.locator).toBe("n.md")
    expect(entry?.newHash).toBeNull()
    expect(entry?.previousHash).toBe(hash)
    // P10 is satisfied by the record, not by the refusal.
    expect(entry?.reason).toBe("user asked")
    expect(entry?.source).toBe("operator")
  })

  it("lists what is in the trash, newest first", async () => {
    const a = await seed("a.md")
    const b = await seed("b.md")
    await del(a.id, a.hash)
    await del(b.id, b.hash)
    const trash = writer.trash()
    expect(trash).toHaveLength(2)
    expect(trash.map((t) => t.locator).sort()).toEqual(["a.md", "b.md"])
  })

  it("restores a deleted note to where it came from", async () => {
    const { id, hash } = await seed("sub/n.md", "restore me")
    const deleted = await del(id, hash)
    expect(existsSync(join(root, "sub/n.md"))).toBe(false)

    const restored = await writer.restoreDeleted(deleted.auditId)
    expect(restored.applied).toBe(true)
    expect(parseFrontmatter(readFileSync(join(root, "sub/n.md"), "utf8")).body.trim()).toBe(
      "restore me",
    )
    // The trash entry is consumed by the restore.
    expect(writer.trash()).toHaveLength(0)
  })

  it("refuses to restore over a locator that is occupied again", async () => {
    const { id, hash } = await seed("n.md")
    const deleted = await del(id, hash)
    await seed("n.md", "written since")
    await expect(writer.restoreDeleted(deleted.auditId)).rejects.toThrow()
    // The newer note is untouched.
    expect(parseFrontmatter(readFileSync(join(root, "n.md"), "utf8")).body.trim()).toBe(
      "written since",
    )
  })

  it("refuses to restore an audit id that is not in the trash", async () => {
    await expect(writer.restoreDeleted("not-an-audit-id")).rejects.toThrow(/nothing in the trash/)
  })

  it("refuses a delete whose CAS hash is stale", async () => {
    const { id, hash } = await seed("n.md")
    await writer.apply({
      intent: {
        kind: "update",
        targetId: id,
        expectedVersionHash: hash,
        newContent: { type: "decision", restrictions: OPEN, body: "changed" },
        reason: "r",
        source: "s",
      },
      reason: "r",
      source: "s",
    })
    // `hash` is stale now: the update rewrote the note.
    await expect(del(id, hash)).rejects.toThrow()
    expect(existsSync(join(root, "n.md"))).toBe(true)
  })

  it("requires a CAS hash: the schema refuses a delete without one", async () => {
    const { id } = await seed("n.md")
    await expect(
      writer.apply({
        intent: { kind: "delete", targetId: id, reason: "r", source: "s" },
        reason: "r",
        source: "s",
      }),
    ).rejects.toThrow()
    expect(existsSync(join(root, "n.md"))).toBe(true)
  })

  it("survives a crash between the trash copy and the unlink", async () => {
    // The copy and the WAL record are durable before the note leaves the
    // vault, so the worst case loses nothing: the note is still readable and
    // the trash holds a copy.
    const { id, hash } = await seed("n.md", "durable")
    const r = await del(id, hash)
    const reopened = new VaultMutationWriter({ root })
    expect(reopened.trash().map((t) => t.auditId)).toContain(r.auditId)
    expect(reopened.readWal().some((e) => e.kind === "delete")).toBe(true)
  })

  it("leaves archive distinct: it retires without removing", async () => {
    const { id, hash } = await seed("n.md")
    await writer.apply({
      intent: {
        kind: "promote",
        targetId: id,
        expectedVersionHash: hash,
        reason: "r",
        source: "s",
      },
      reason: "r",
      source: "s",
    })
    await writer.apply({
      intent: {
        kind: "archive",
        targetId: id,
        expectedVersionHash: hashOf("n.md"),
        reason: "r",
        source: "s",
      },
      reason: "r",
      source: "s",
    })
    // Archived: out of retrieval, still in the vault.
    expect(existsSync(join(root, "n.md"))).toBe(true)
    expect(writer.trash()).toHaveLength(0)
  })

  it("refuses a trash path that would escape the vault", async () => {
    // A hand-edited sidecar must not turn a restore into an arbitrary write.
    const { id, hash } = await seed("n.md")
    const r = await del(id, hash)
    writeFileSync(
      join(root, TRASH_DIR, `${r.auditId}.md.origin.json`),
      JSON.stringify({ locator: "../escaped.md", auditId: r.auditId, deletedAt: "2026-08-30T00:00:00Z" }),
    )
    await expect(writer.restoreDeleted(r.auditId)).rejects.toThrow()
    expect(existsSync(join(root, "..", "escaped.md"))).toBe(false)
  })
})
