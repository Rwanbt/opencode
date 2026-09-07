/* SPDX-License-Identifier: MIT */
/**
 * The writer honours its declared contract (card C30).
 *
 * Four defects, all of them a gap between what the contract said and what the
 * writer did:
 *  A. `archive` was impossible — the WAL grouped it with `delete` and demanded
 *     no new hash, but archive rewrites the note and keeps the file.
 *  B. `supersede` validated `successorId` and then ignored it, copying the
 *     target's own list back onto itself, so nothing recorded the replacement.
 *  C. `move` was in the contract and reached "unsupported mutation kind".
 *  D. the schema exempted lifecycle transitions from compare-and-swap while
 *     the writer required it, so a schema-valid intent was refused anyway.
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test"
import { mkdtempSync, rmSync, readFileSync, existsSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createHash } from "node:crypto"
import { VaultMutationWriter } from "../../../src/knowledge/mutation/writer.js"
import { parseFrontmatter } from "../../../src/knowledge/parser/frontmatter.js"

type Restrictions = {
  remoteModel: "allow" | "deny"
  localModel: "allow" | "deny"
  embeddable: "allow" | "deny"
  exportable: "allow" | "deny"
}

const OPEN: Restrictions = {
  remoteModel: "deny",
  localModel: "allow",
  embeddable: "allow",
  exportable: "deny",
}

const sha256 = (s: string) => createHash("sha256").update(s, "utf8").digest("hex")

function createIntent(locator: string, body = "body", restrictions = OPEN) {
  return {
    kind: "create",
    targetLocator: locator,
    newContent: { type: "decision", restrictions, body },
    reason: "characterization",
    source: "test",
  }
}

describe("C30 — writer contract", () => {
  let root: string
  let writer: VaultMutationWriter
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "unifia-c30-"))
    writer = new VaultMutationWriter({ root })
  })
  afterEach(() => rmSync(root, { recursive: true, force: true }))

  const hashOf = (locator: string) => sha256(readFileSync(join(root, locator), "utf8"))
  const reread = (locator: string) =>
    parseFrontmatter(readFileSync(join(root, locator), "utf8")).frontmatter

  async function seed(locator: string, body = "body", restrictions = OPEN) {
    await writer.apply({
      intent: createIntent(locator, body, restrictions),
      reason: "r",
      source: "s",
    })
    return { id: reread(locator).unifia_id, hash: hashOf(locator) }
  }

  async function promote(locator: string, id: string) {
    await writer.apply({
      intent: {
        kind: "promote",
        targetId: id,
        expectedVersionHash: hashOf(locator),
        reason: "r",
        source: "s",
      },
      reason: "r",
      source: "s",
    })
  }

  // -- A: archive -----------------------------------------------------------

  it("archives an active note, where the WAL used to refuse the entry", async () => {
    const { id } = await seed("n.md")
    await promote("n.md", id)
    const r = await writer.apply({
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
    expect(r.applied).toBe(true)
    expect(r.newLifecycle).toBe("archived")
    expect(reread("n.md").unifia_lifecycle).toBe("archived")
  })

  it("restores an archived note", async () => {
    const { id } = await seed("n.md")
    await promote("n.md", id)
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
    await writer.apply({
      intent: {
        kind: "restore",
        targetId: id,
        expectedVersionHash: hashOf("n.md"),
        reason: "r",
        source: "s",
      },
      reason: "r",
      source: "s",
    })
    expect(reread("n.md").unifia_lifecycle).toBe("active")
  })

  // -- B: supersede ---------------------------------------------------------

  async function supersede(targetId: string, successorId: string, targetLocator: string) {
    return writer.apply({
      intent: {
        kind: "supersede",
        targetId,
        successorId,
        expectedVersionHash: hashOf(targetLocator),
        reason: "r",
        source: "s",
      },
      reason: "r",
      source: "s",
    })
  }

  it("records the replacement on the successor, not just on the target", async () => {
    const target = await seed("old.md", "old body")
    const successor = await seed("new.md", "new body")
    await promote("old.md", target.id)
    await supersede(target.id, successor.id, "old.md")

    expect(reread("old.md").unifia_lifecycle).toBe("superseded")
    // The half that was dropped: successorId was validated, then ignored.
    expect(reread("new.md").unifia_supersedes).toContain(target.id)
  })

  it("writes both halves of a supersession under one auditId", async () => {
    const target = await seed("old.md")
    const successor = await seed("new.md")
    await promote("old.md", target.id)
    const r = await supersede(target.id, successor.id, "old.md")
    const shared = writer.readWal().filter((e) => e.auditId === r.auditId)
    expect(shared.map((e) => e.kind).sort()).toEqual(["supersede", "update"])
  })

  it("refuses a note superseding itself", async () => {
    const { id } = await seed("n.md")
    await promote("n.md", id)
    await expect(supersede(id, id, "n.md")).rejects.toThrow(/cannot supersede itself/)
  })

  it("refuses a supersession whose successor does not exist", async () => {
    const { id } = await seed("n.md")
    await promote("n.md", id)
    await expect(
      supersede(id, "0190d2c0-7b00-7000-8000-0000000000ee", "n.md"),
    ).rejects.toThrow(/no note with id/)
  })

  it("refuses a supersession cycle", async () => {
    const a = await seed("a.md")
    const b = await seed("b.md")
    await promote("a.md", a.id)
    await promote("b.md", b.id)
    await supersede(b.id, a.id, "b.md")
    await expect(supersede(a.id, b.id, "a.md")).rejects.toThrow(/cycle/)
  })

  it("preserves restrictions across a supersession", async () => {
    const target = await seed("old.md", "b", { ...OPEN, localModel: "deny" })
    const successor = await seed("new.md")
    await promote("old.md", target.id)
    await supersede(target.id, successor.id, "old.md")
    expect(reread("old.md").unifia_restrictions?.local_model).toBe("deny")
  })

  // -- C: move --------------------------------------------------------------

  it("moves a note instead of failing after dispatch", async () => {
    const { id, hash } = await seed("from.md", "movable")
    const r = await writer.apply({
      intent: {
        kind: "move",
        targetId: id,
        targetLocator: "sub/to.md",
        expectedVersionHash: hash,
        reason: "r",
        source: "s",
      },
      reason: "r",
      source: "s",
    })
    expect(r.applied).toBe(true)
    expect(r.ref?.locator).toBe("sub/to.md")
    expect(existsSync(join(root, "sub/to.md"))).toBe(true)
    expect(existsSync(join(root, "from.md"))).toBe(false)
    expect(parseFrontmatter(readFileSync(join(root, "sub/to.md"), "utf8")).body.trim()).toBe(
      "movable",
    )
  })

  it("refuses a move onto an existing note", async () => {
    const { id, hash } = await seed("from.md")
    await seed("taken.md")
    await expect(
      writer.apply({
        intent: {
          kind: "move",
          targetId: id,
          targetLocator: "taken.md",
          expectedVersionHash: hash,
          reason: "r",
          source: "s",
        },
        reason: "r",
        source: "s",
      }),
    ).rejects.toThrow()
    expect(existsSync(join(root, "from.md"))).toBe(true)
  })

  it("refuses a move escaping the vault", async () => {
    const { id, hash } = await seed("from.md")
    await expect(
      writer.apply({
        intent: {
          kind: "move",
          targetId: id,
          targetLocator: "../escaped.md",
          expectedVersionHash: hash,
          reason: "r",
          source: "s",
        },
        reason: "r",
        source: "s",
      }),
    ).rejects.toThrow()
    expect(existsSync(join(root, "..", "escaped.md"))).toBe(false)
  })

  // -- D: compare-and-swap --------------------------------------------------

  it("requires a CAS hash for every lifecycle transition", async () => {
    const { id } = await seed("n.md")
    for (const kind of ["promote", "archive", "restore"]) {
      await expect(
        writer.apply({
          intent: { kind, targetId: id, reason: "r", source: "s" },
          reason: "r",
          source: "s",
        }),
      ).rejects.toThrow(/expectedVersionHash|missing required fields/)
    }
  })

  it("refuses a transition whose CAS hash is stale", async () => {
    const { id, hash } = await seed("n.md")
    await promote("n.md", id)
    // `hash` is now stale: promote rewrote the note.
    await expect(
      writer.apply({
        intent: {
          kind: "archive",
          targetId: id,
          expectedVersionHash: hash,
          reason: "r",
          source: "s",
        },
        reason: "r",
        source: "s",
      }),
    ).rejects.toThrow()
  })

  it("returns ref and newLifecycle on every applied mutation", async () => {
    const r = await writer.apply({
      intent: createIntent("n.md"),
      reason: "r",
      source: "s",
    })
    expect(r.ref?.locator).toBe("n.md")
    expect(r.ref?.versionHash).toMatch(/^[0-9a-f]{64}$/)
    expect(r.ref?.id).toMatch(/^[0-9a-f-]{36}$/)
    expect(r.newLifecycle).toBe("candidate")
  })
})
