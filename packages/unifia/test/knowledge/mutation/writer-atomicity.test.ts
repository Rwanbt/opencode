/* SPDX-License-Identifier: MIT */
/**
 * Move and restore are atomic: the destination commit and the unlink of the
 * previous path happen under one lock, and a crash between the two is
 * recovered by the next open. Without this, a power loss between the rename
 * and the source unlink would leave two silent copies of the same note.
 *
 * The test injects the crash by recreating the post-rename-but-pre-unlink
 * state directly: the destination holds the new content with the recorded
 * hash, the source still exists with the same content, and a WAL entry
 * whose `previousLocator` points at the source. Recovery is then expected
 * to remove the source and leave the destination.
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test"
import { mkdtempSync, rmSync, readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createHash } from "node:crypto"
import { VaultMutationWriter, WAL_FILE, TRASH_DIR } from "../../../src/knowledge/mutation/writer.js"
import { TMP_SUFFIX, recover, appendLineDurable, writeFileDurable } from "../../../src/knowledge/mutation/durability.js"
import { parseFrontmatter } from "../../../src/knowledge/parser/frontmatter.js"

const sha256 = (s: string) => createHash("sha256").update(s, "utf8").digest("hex")

const OPEN = {
  remoteModel: "deny",
  localModel: "allow",
  embeddable: "allow",
  exportable: "deny",
} as const

const createIntent = (locator: string, body = "body") => ({
  kind: "create",
  targetLocator: locator,
  newContent: { type: "decision", restrictions: OPEN, body },
  reason: "atomicity",
  source: "test",
})

function stagedContent(id: string, body: string) {
  return [
    "---",
    "unifia_schema: 1",
    `unifia_id: "0190d2c0-7b00-7000-8000-${id.padStart(12, "0")}"`,
    'unifia_type: "decision"',
    'unifia_lifecycle: "candidate"',
    'unifia_created_at: "2026-08-31T00:00:00Z"',
    'unifia_updated_at: "2026-08-31T00:00:00Z"',
    'unifia_project_ref: "test"',
    "unifia_supersedes: []",
    "unifia_tags: []",
    "---",
    body,
    "",
  ].join("\n")
}

describe("W-MUT-01 — move is crash-consistent", () => {
  let root: string
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "unifia-wmut01-"))
    mkdirSync(join(root, ".unifia"), { recursive: true })
  })
  afterEach(() => rmSync(root, { recursive: true, force: true }))

  it("writes the previousLocator on the WAL so recovery can finish the unlink", async () => {
    const w = new VaultMutationWriter({ root })
    const created = await w.apply({
      intent: createIntent("from.md", "movable body"),
      reason: "r",
      source: "s",
    })
    const id = created.ref?.id as string
    const fromRaw = readFileSync(join(root, "from.md"), "utf8")
    const fromHash = sha256(fromRaw)
    await w.apply({
      intent: {
        kind: "move",
        targetId: id,
        targetLocator: "sub/dest.md",
        expectedVersionHash: fromHash,
        reason: "r",
        source: "s",
      },
      reason: "r",
      source: "s",
    })
    // The WAL must record the previousLocator so a recovery can finish
    // an interrupted unlink of the source.
    const moveEntry = w.readWal().find((e) => e.kind === "move")
    expect(moveEntry).toBeDefined()
    expect(moveEntry?.previousLocator).toBe("from.md")
    expect(existsSync(join(root, "sub/dest.md"))).toBe(true)
    expect(existsSync(join(root, "from.md"))).toBe(false)
  })

  it("recovery drops a source that survived a mid-move crash", () => {
    // The injection: the destination exists with the recorded content and
    // the source is still there with the same content. This is exactly the
    // post-rename / pre-unlink state a process leaves when it is killed
    // between the two.
    const content = stagedContent("1", "recorded once")
    mkdirSync(join(root, "sub"), { recursive: true })
    writeFileSync(join(root, "sub/dest.md"), content)
    writeFileDurable(join(root, `sub/dest.md${TMP_SUFFIX}`), content)
    writeFileSync(join(root, "from.md"), content)
    appendLineDurable(
      join(root, WAL_FILE),
      JSON.stringify({
        seq: 1,
        kind: "move",
        locator: "sub/dest.md",
        previousLocator: "from.md",
        previousHash: null,
        newHash: sha256(content),
        auditId: "audit-mid-move",
        source: "test",
        reason: "crash",
        timestamp: "2026-08-31T00:00:00Z",
      }),
    )

    const r = recover(root, WAL_FILE)
    expect(r.completed).toHaveLength(1)
    expect(existsSync(join(root, "sub/dest.md"))).toBe(true)
    // The orphan source is gone: the WAL told us where it used to be.
    expect(existsSync(join(root, "from.md"))).toBe(false)
  })

  it("recovery keeps the source if the destination is not what the WAL recorded", () => {
    // The destination file is missing the recorded hash (e.g. it was
    // overwritten by a later write that the WAL records under a different
    // audit). The source might be a different note now; do not touch it.
    const committed = stagedContent("1", "old")
    const stray = stagedContent("2", "different")
    mkdirSync(join(root, "sub"), { recursive: true })
    writeFileSync(join(root, "from.md"), stray)
    writeFileSync(join(root, "sub/dest.md"), stray)
    writeFileDurable(join(root, `sub/dest.md${TMP_SUFFIX}`), committed)
    appendLineDurable(
      join(root, WAL_FILE),
      JSON.stringify({
        seq: 1,
        kind: "move",
        locator: "sub/dest.md",
        previousLocator: "from.md",
        previousHash: null,
        newHash: sha256(committed),
        auditId: "audit-stale",
        source: "test",
        reason: "stale",
        timestamp: "2026-08-31T00:00:00Z",
      }),
    )

    recover(root, WAL_FILE)
    expect(existsSync(join(root, "from.md"))).toBe(true)
  })

  it("recovery reopens the vault with no orphan source after a real crash", async () => {
    const w = new VaultMutationWriter({ root })
    const created = await w.apply({
      intent: createIntent("from.md", "real move"),
      reason: "r",
      source: "s",
    })
    const id = created.ref?.id as string
    const fromRaw = readFileSync(join(root, "from.md"), "utf8")
    const fromHash = sha256(fromRaw)

    // Simulate a crash that landed the destination rename and the WAL,
    // but not the source unlink: re-create the post-rename state.
    const destRaw = fromRaw
    mkdirSync(join(root, "sub"), { recursive: true })
    writeFileSync(join(root, "sub/dest.md"), destRaw)
    writeFileDurable(join(root, `sub/dest.md${TMP_SUFFIX}`), destRaw)
    appendLineDurable(
      join(root, WAL_FILE),
      JSON.stringify({
        seq: 2,
        kind: "move",
        locator: "sub/dest.md",
        previousLocator: "from.md",
        previousHash: fromHash,
        newHash: sha256(destRaw),
        auditId: "audit-real",
        source: "test",
        reason: "crash",
        timestamp: "2026-08-31T00:00:00Z",
      }),
    )
    // Leave the source in place: that is the bug we are guarding against.

    // Re-opening the writer triggers recover, which must clean up.
    const reopened = new VaultMutationWriter({ root })
    expect(reopened.recovery().completed).toHaveLength(1)
    expect(existsSync(join(root, "sub/dest.md"))).toBe(true)
    expect(existsSync(join(root, "from.md"))).toBe(false)
    // The destination is still parseable as the same note.
    const fm = parseFrontmatter(readFileSync(join(root, "sub/dest.md"), "utf8")).frontmatter
    expect(fm.unifia_id).toBe(id)
  })
})

describe("W-MUT-05 — restore exact-state", () => {
  let root: string
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "unifia-wmut05-"))
    mkdirSync(join(root, ".unifia"), { recursive: true })
  })
  afterEach(() => rmSync(root, { recursive: true, force: true }))

  it("preserves the original frontmatter exactly across restore", async () => {
    const w = new VaultMutationWriter({ root })
    const created = await w.apply({
      intent: createIntent("n.md", "exact body"),
      reason: "r",
      source: "s",
    })
    const id = created.ref?.id as string
    const raw = readFileSync(join(root, "n.md"), "utf8")
    const hash = sha256(raw)
    const before = parseFrontmatter(raw).frontmatter

    // Promote so the lifecycle is "active" and restrictions stick.
    await w.apply({
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
    const promotedRaw = readFileSync(join(root, "n.md"), "utf8")
    const promotedHash = sha256(promotedRaw)
    const promoted = parseFrontmatter(promotedRaw).frontmatter

    const deleted = await w.apply({
      intent: {
        kind: "delete",
        targetId: id,
        expectedVersionHash: promotedHash,
        reason: "r",
        source: "s",
      },
      reason: "r",
      source: "s",
    })

    const restored = await w.restoreDeleted(deleted.auditId)
    expect(restored.applied).toBe(true)
    const after = parseFrontmatter(readFileSync(join(root, "n.md"), "utf8")).frontmatter
    // Every field the user wrote must come back unchanged.
    expect(after.unifia_id).toBe(before.unifia_id)
    expect(after.unifia_type).toBe(before.unifia_type)
    expect(after.unifia_tags).toEqual(before.unifia_tags)
    expect(after.unifia_project_ref).toBe(before.unifia_project_ref)
    // A restore of an unpromoted note lands it as a candidate; a promote
    // after a delete-and-restore is the operator's job.
    expect(after.unifia_lifecycle).toBe(promoted.unifia_lifecycle)
  })

  it("recovery drops the trashed copy that survived a mid-restore crash", () => {
    const content = stagedContent("1", "restored body")
    writeFileSync(join(root, "n.md"), content)
    mkdirSync(join(root, TRASH_DIR), { recursive: true })
    writeFileSync(join(root, TRASH_DIR, "audit-restore.md"), content)
    writeFileSync(
      join(root, TRASH_DIR, "audit-restore.md.origin.json"),
      JSON.stringify({ locator: "n.md", auditId: "audit-restore", deletedAt: "2026-08-31T00:00:00Z" }),
    )
    appendLineDurable(
      join(root, WAL_FILE),
      JSON.stringify({
        seq: 1,
        kind: "restore",
        locator: "n.md",
        previousLocator: `${TRASH_DIR}/audit-restore.md`,
        previousHash: null,
        newHash: sha256(content),
        auditId: "audit-restore",
        source: "trash",
        reason: "restore of audit-restore",
        timestamp: "2026-08-31T00:00:00Z",
      }),
    )

    recover(root, WAL_FILE)
    // Recovery's second pass unlinks the orphan trash copy, leaving only
    // the restored destination. The destination is intact.
    expect(existsSync(join(root, "n.md"))).toBe(true)
    expect(existsSync(join(root, TRASH_DIR, "audit-restore.md"))).toBe(false)
  })

  it("a real mid-restore crash leaves no duplicate after reopen", async () => {
    const w = new VaultMutationWriter({ root })
    const created = await w.apply({
      intent: createIntent("n.md", "keep me"),
      reason: "r",
      source: "s",
    })
    const id = created.ref?.id as string
    const raw = readFileSync(join(root, "n.md"), "utf8")
    const hash = sha256(raw)

    const deleted = await w.apply({
      intent: {
        kind: "delete",
        targetId: id,
        expectedVersionHash: hash,
        reason: "r",
        source: "s",
      },
      reason: "r",
      source: "s",
    })
    expect(existsSync(join(root, TRASH_DIR, `${deleted.auditId}.md`))).toBe(true)

    // Inject the mid-restore state: the destination has the restored
    // content, the trash still has the same content, the WAL says the
    // previousLocator was the trash path. Recovery must clean the trash.
    const restored = readFileSync(join(root, TRASH_DIR, `${deleted.auditId}.md`), "utf8")
    writeFileSync(join(root, "n.md"), restored)
    appendLineDurable(
      join(root, WAL_FILE),
      JSON.stringify({
        seq: 3,
        kind: "restore",
        locator: "n.md",
        previousLocator: `${TRASH_DIR}/${deleted.auditId}.md`,
        previousHash: hash,
        newHash: sha256(restored),
        auditId: "audit-real-restore",
        source: "trash",
        reason: "restore",
        timestamp: "2026-08-31T00:00:00Z",
      }),
    )

    const reopened = new VaultMutationWriter({ root })
    // Recovery's second pass unlinks the orphan trash copy, leaving only
    // the restored destination. The destination is intact.
    expect(existsSync(join(root, "n.md"))).toBe(true)
    expect(existsSync(join(root, TRASH_DIR, `${deleted.auditId}.md`))).toBe(false)
  })
})
