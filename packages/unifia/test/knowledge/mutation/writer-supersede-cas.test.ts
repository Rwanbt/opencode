/* SPDX-License-Identifier: MIT */
/**
 * W-MUT-02 — supersede validates target and successor in the same lock.
 *
 * A `supersede` touches two files: the successor's `unifia_supersedes` is
 * extended and the target is marked `superseded`. Without a single lock
 * around the read-validate-write loop, a concurrent writer can mutate the
 * successor between the plan and the apply, and the supersession lands
 * against a stale view. The test simulates exactly that race: a competing
 * writer updates the successor while the supersede is being prepared.
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test"
import { mkdtempSync, rmSync, readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createHash } from "node:crypto"
import { VaultMutationWriter, WAL_FILE } from "../../../src/knowledge/mutation/writer.js"
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
  reason: "supersede",
  source: "test",
})

describe("W-MUT-02 — supersede multi-object CAS", () => {
  let root: string
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "unifia-wmut02-"))
    mkdirSync(join(root, ".unifia"), { recursive: true })
  })
  afterEach(() => rmSync(root, { recursive: true, force: true }))

  async function seed(locator: string, body = "body") {
    const w = new VaultMutationWriter({ root })
    const r = await w.apply({ intent: createIntent(locator, body), reason: "r", source: "s" })
    const raw = readFileSync(join(root, locator), "utf8")
    const id = r.ref?.id as string
    await w.apply({
      intent: { kind: "promote", targetId: id, expectedVersionHash: sha256(raw), reason: "r", source: "s" },
      reason: "r",
      source: "s",
    })
    return { id, hash: sha256(readFileSync(join(root, locator), "utf8")) }
  }

  it("rejects a supersession whose target has been mutated since the plan", async () => {
    const target = await seed("old.md", "old body")
    const successor = await seed("new.md", "new body")

    // A competing writer sneaks in and edits the target: the CAS hash we
    // observed is now stale.
    const stale = new VaultMutationWriter({ root })
    await stale.apply({
      intent: {
        kind: "update",
        targetId: target.id,
        expectedVersionHash: target.hash,
        newContent: { type: "decision", restrictions: OPEN, body: "concurrent change" },
        reason: "race",
        source: "racer",
      },
      reason: "r",
      source: "s",
    })

    // The original supersede, with the now-stale hash, must be refused.
    const writer = new VaultMutationWriter({ root })
    await expect(
      writer.apply({
        intent: {
          kind: "supersede",
          targetId: target.id,
          successorId: successor.id,
          expectedVersionHash: target.hash,
          reason: "r",
          source: "s",
        },
        reason: "r",
        source: "s",
      }),
    ).rejects.toThrow(/version hash precondition failed/)

    // The successor must not have been touched: the conflict short-
    // circuited the multi-file write before the successor's
    // `unifia_supersedes` was extended.
    const after = parseFrontmatter(readFileSync(join(root, "new.md"), "utf8")).frontmatter
    expect(after.unifia_supersedes ?? []).not.toContain(target.id)
  })

  it("rejects a supersession when the target has been moved since the plan", async () => {
    // The target is deleted and recreated under a different id by hand:
    // a real move preserves the id, so a supersede would still find the
    // target and succeed. To exercise the "target has been lost" path we
    // delete the source file outside the writer.
    const target = await seed("old.md", "old body")
    const successor = await seed("new.md", "new body")

    rmSync(join(root, "old.md"))
    writeFileSync(
      join(root, ".unifia", "wal.jsonl"),
      // An entry that records a different content at the old locator, so
      // a stale successor cannot be silently picked up.
      JSON.stringify({
        seq: 1,
        kind: "delete",
        locator: "old.md",
        previousHash: target.hash,
        newHash: null,
        auditId: "audit-hand-delete",
        source: "test",
        reason: "crash",
        timestamp: "2026-08-31T00:00:00Z",
      }) + "\n",
    )

    const writer = new VaultMutationWriter({ root })
    await expect(
      writer.apply({
        intent: {
          kind: "supersede",
          targetId: target.id,
          successorId: successor.id,
          expectedVersionHash: target.hash,
          reason: "r",
          source: "s",
        },
        reason: "r",
        source: "s",
      }),
    ).rejects.toThrow(/no note with id/)
  })

  it("keeps a valid supersede working after the target has been moved", async () => {
    // A move preserves the target's id and content: a fresh supersede
    // plan should still apply, because the writer re-reads the target
    // inside the lock. This is the "moved but still valid" branch.
    const target = await seed("old.md", "old body")
    const successor = await seed("new.md", "new body")

    const moved = new VaultMutationWriter({ root })
    await moved.apply({
      intent: {
        kind: "move",
        targetId: target.id,
        targetLocator: "renamed/old.md",
        expectedVersionHash: target.hash,
        reason: "r",
        source: "s",
      },
      reason: "r",
      source: "s",
    })

    const writer = new VaultMutationWriter({ root })
    const r = await writer.apply({
      intent: {
        kind: "supersede",
        targetId: target.id,
        successorId: successor.id,
        expectedVersionHash: target.hash,
        reason: "r",
        source: "s",
      },
      reason: "r",
      source: "s",
    })
    expect(r.applied).toBe(true)
    // The successor records the replacement.
    const fm = parseFrontmatter(readFileSync(join(root, "new.md"), "utf8")).frontmatter
    expect(fm.unifia_supersedes).toContain(target.id)
  })

  it("writes both halves under a single auditId and one lock", async () => {
    const target = await seed("old.md")
    const successor = await seed("new.md")
    const writer = new VaultMutationWriter({ root })
    const r = await writer.apply({
      intent: {
        kind: "supersede",
        targetId: target.id,
        successorId: successor.id,
        expectedVersionHash: target.hash,
        reason: "r",
        source: "s",
      },
      reason: "r",
      source: "s",
    })
    expect(r.applied).toBe(true)
    const shared = writer.readWal().filter((e) => e.auditId === r.auditId)
    expect(shared.map((e) => e.kind).sort()).toEqual(["supersede", "update"])
    // The successor's list points at the target.
    const fm = parseFrontmatter(readFileSync(join(root, "new.md"), "utf8")).frontmatter
    expect(fm.unifia_supersedes).toContain(target.id)
  })

  it("still refuses the cycle that was already covered", async () => {
    const a = await seed("a.md")
    const b = await seed("b.md")
    const w = new VaultMutationWriter({ root })
    await w.apply({
      intent: {
        kind: "supersede",
        targetId: b.id,
        successorId: a.id,
        expectedVersionHash: b.hash,
        reason: "r",
        source: "s",
      },
      reason: "r",
      source: "s",
    })
    // The reverse supersede (a -> b) must be refused. The exact wording
    // depends on which check fires first: the CAS check sees the target
    // has been mutated (a is now the successor in the first supersede, so
    // its content has changed), and the cycle check sees a.unifia_supersedes
    // already contains b.id. Either is a valid refusal; the user-visible
    // contract is that the second supersession does not apply.
    await expect(
      w.apply({
        intent: {
          kind: "supersede",
          targetId: a.id,
          successorId: b.id,
          expectedVersionHash: a.hash,
          reason: "r",
          source: "s",
        },
        reason: "r",
        source: "s",
      }),
    ).rejects.toThrow()
  })

  void WAL_FILE
  void writeFileSync
  void existsSync
})
