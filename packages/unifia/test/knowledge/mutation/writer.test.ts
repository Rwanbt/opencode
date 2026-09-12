/* SPDX-License-Identifier: MIT */
/**
 * Class A writer (card C25).
 *
 * V1 had no write path: MutationWriter was an interface with no
 * implementation, so knowledge_propose could only refuse.
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test"
import { mkdtempSync, rmSync, readFileSync, existsSync, writeFileSync, mkdirSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createHash } from "node:crypto"
import { VaultMutationWriter, WAL_FILE } from "../../../src/knowledge/mutation/writer.js"
import { parseFrontmatter } from "../../../src/knowledge/parser/frontmatter.js"
import { composeKnowledgeService } from "../../../src/knowledge/facade/compose.js"
import { portableRestrictionsFromFrontmatter } from "@unifia/contracts/knowledge"

const OPEN = {
  remoteModel: "deny",
  localModel: "allow",
  embeddable: "allow",
  exportable: "deny",
} as const

function createIntent(body: string, over: Record<string, unknown> = {}) {
  return {
    kind: "create",
    targetLocator: "notes/new.md",
    newContent: { type: "decision", restrictions: OPEN, body },
    reason: "characterization",
    source: "test",
    ...over,
  }
}

const sha256 = (s: string) => createHash("sha256").update(s, "utf8").digest("hex")

describe("C25 — VaultMutationWriter", () => {
  let root: string
  let writer: VaultMutationWriter
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "unifia-writer-"))
    writer = new VaultMutationWriter({ root })
  })
  afterEach(() => rmSync(root, { recursive: true, force: true }))

  it("creates a real note on disk that parses back", async () => {
    const r = await writer.apply({ intent: createIntent("a new decision"), reason: "r", source: "s" })
    expect(r.applied).toBe(true)
    const raw = readFileSync(join(root, "notes/new.md"), "utf8")
    const note = parseFrontmatter(raw)
    expect(note.body.trim()).toBe("a new decision")
    expect(note.frontmatter.unifia_type).toBe("decision")
  })

  it("enters a new note as a candidate, never as active", async () => {
    await writer.apply({ intent: createIntent("body"), reason: "r", source: "s" })
    const note = parseFrontmatter(readFileSync(join(root, "notes/new.md"), "utf8"))
    expect(note.frontmatter.unifia_lifecycle).toBe("candidate")
  })

  it("persists a non-default restriction verbatim", async () => {
    await writer.apply({
      intent: createIntent("body", {
        newContent: {
          type: "constraint",
          // local_model: deny is not the default, so it must be written out.
          restrictions: { ...OPEN, localModel: "deny" },
          body: "body",
        },
      }),
      reason: "r",
      source: "s",
    })
    const note = parseFrontmatter(readFileSync(join(root, "notes/new.md"), "utf8"))
    expect(note.frontmatter.unifia_restrictions?.local_model).toBe("deny")
  })

  it("omits defaults but preserves their meaning on read", async () => {
    // remote_model: deny IS the default, so it is not written out — and
    // reading a note without a block resolves it back to deny. Storage stays
    // compact; the semantics are unchanged.
    await writer.apply({ intent: createIntent("body"), reason: "r", source: "s" })
    const note = parseFrontmatter(readFileSync(join(root, "notes/new.md"), "utf8"))
    expect(
      portableRestrictionsFromFrontmatter(note.frontmatter.unifia_restrictions).remoteModel,
    ).toBe("deny")
  })

  it("records an append-only WAL entry before the file becomes visible", async () => {
    await writer.apply({
      intent: createIntent("body", { reason: "why", source: "agent" }),
      reason: "why",
      source: "agent",
    })
    const wal = writer.readWal()
    expect(wal).toHaveLength(1)
    expect(wal[0]?.kind).toBe("create")
    // The intent carries the reason; the WAL records what the intent said.
    expect(wal[0]?.reason).toBe("why")
    expect(wal[0]?.source).toBe("agent")
    expect(wal[0]?.previousHash).toBeNull()
    expect(wal[0]?.newHash).toMatch(/^[0-9a-f]{64}$/)
  })

  it("continues the WAL sequence across writer instances", async () => {
    await writer.apply({ intent: createIntent("one"), reason: "r", source: "s" })
    const second = new VaultMutationWriter({ root })
    await second.apply({
      intent: createIntent("two", { targetLocator: "notes/other.md" }),
      reason: "r",
      source: "s",
    })
    expect(second.readWal().map((e) => e.seq)).toEqual([1, 2])
  })

  it("refuses to write a credential into the vault", async () => {
    await expect(
      writer.apply({
        intent: createIntent("token: ghp_" + "a".repeat(36)),
        reason: "r",
        source: "s",
      }),
    ).rejects.toThrow(/credential/)
    expect(existsSync(join(root, "notes/new.md"))).toBe(false)
  })

  it("refuses to delete a note that does not exist", async () => {
    // delete is supported since the ADR-KNOW-0009 amendment of 2026-08-30;
    // what it still refuses is a target it cannot find. The behaviour this
    // test used to assert — a blanket refusal — was the scope decision the
    // owner reversed. See delete.test.ts for the semantics.
    await expect(
      writer.apply({
        intent: {
          kind: "delete",
          targetId: "0190d2c0-7b00-7000-8000-0000000000ff",
          expectedVersionHash: "0".repeat(64),
          reason: "r",
          source: "s",
        },
        reason: "r",
        source: "s",
      }),
    ).rejects.toThrow(/no note with id/)
  })

  it("refuses a locator escaping the vault", async () => {
    // The intent schema rejects `..` before the writer sees it; either
    // refusal is correct, what matters is that nothing is written outside.
    await expect(
      writer.apply({
        intent: createIntent("body", { targetLocator: "../escape.md" }),
        reason: "r",
        source: "s",
      }),
    ).rejects.toThrow()
    expect(existsSync(join(root, "..", "escape.md"))).toBe(false)
  })

  it("refuses to overwrite an existing note with create", async () => {
    await writer.apply({ intent: createIntent("first"), reason: "r", source: "s" })
    await expect(
      writer.apply({ intent: createIntent("second"), reason: "r", source: "s" }),
    ).rejects.toThrow()
  })

  it("refuses an update whose expected hash does not match", async () => {
    await writer.apply({ intent: createIntent("first"), reason: "r", source: "s" })
    const id = parseFrontmatter(readFileSync(join(root, "notes/new.md"), "utf8")).frontmatter
      .unifia_id
    await expect(
      writer.apply({
        intent: {
          kind: "update",
          targetId: id,
          expectedVersionHash: "f".repeat(64),
          newContent: { type: "decision", restrictions: OPEN, body: "changed" },
          reason: "r",
          source: "s",
        },
        reason: "r",
        source: "s",
      }),
    ).rejects.toThrow()
  })

  it("applies an update when the expected hash matches", async () => {
    await writer.apply({ intent: createIntent("first"), reason: "r", source: "s" })
    const raw = readFileSync(join(root, "notes/new.md"), "utf8")
    const id = parseFrontmatter(raw).frontmatter.unifia_id
    const r = await writer.apply({
      intent: {
        kind: "update",
        targetId: id,
        expectedVersionHash: sha256(raw),
        newContent: { type: "decision", restrictions: OPEN, body: "changed" },
        reason: "r",
        source: "s",
      },
      reason: "r",
      source: "s",
    })
    expect(r.applied).toBe(true)
    expect(parseFrontmatter(readFileSync(join(root, "notes/new.md"), "utf8")).body.trim()).toBe(
      "changed",
    )
  })

  it("refuses a lifecycle transition the table forbids", async () => {
    await writer.apply({ intent: createIntent("first"), reason: "r", source: "s" })
    const raw = readFileSync(join(root, "notes/new.md"), "utf8")
    const id = parseFrontmatter(raw).frontmatter.unifia_id
    // The note is a candidate; candidate -> superseded is not allowed.
    await expect(
      writer.apply({
        intent: {
          kind: "supersede",
          targetId: id,
          successorId: "0190d2c0-7b00-7000-8000-0000000000ff",
          expectedVersionHash: sha256(raw),
          reason: "r",
          source: "s",
        },
        reason: "r",
        source: "s",
      }),
    ).rejects.toThrow(/not allowed/)
  })

  it("promotes a candidate to active", async () => {
    await writer.apply({ intent: createIntent("first"), reason: "r", source: "s" })
    const raw = readFileSync(join(root, "notes/new.md"), "utf8")
    const id = parseFrontmatter(raw).frontmatter.unifia_id
    await writer.apply({
      intent: {
        kind: "promote",
        targetId: id,
        expectedVersionHash: sha256(raw),
        reason: "r",
        source: "s",
      },
      reason: "r",
      source: "s",
    })
    expect(
      parseFrontmatter(readFileSync(join(root, "notes/new.md"), "utf8")).frontmatter
        .unifia_lifecycle,
    ).toBe("active")
  })

  it("leaves no temporary file behind", async () => {
    await writer.apply({ intent: createIntent("body"), reason: "r", source: "s" })
    const stray = new VaultMutationWriter({ root }).readWal()
    expect(stray).toHaveLength(1)
    expect(existsSync(join(root, WAL_FILE))).toBe(true)
  })
})

describe("C25 — propose reaches the writer through the facade", () => {
  let root: string
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "unifia-propose-"))
    mkdirSync(join(root, "memory"))
    writeFileSync(join(root, "memory", ".keep"), "")
  })
  afterEach(() => rmSync(root, { recursive: true, force: true }))

  it("still refuses when the composition is read-only", async () => {
    const { service } = composeKnowledgeService({ workspaceRoot: root, providerId: "cli", destinationKind: "local" })
    await expect(
      service.propose({ intent: createIntent("body"), reason: "r", source: "s" }),
    ).rejects.toThrow(/no Class A writer/)
  })

  it("writes when the composition is writable", async () => {
    const { service } = composeKnowledgeService({
      workspaceRoot: root,
      providerId: "cli",
      destinationKind: "local",
      writable: true,
    })
    const r = await service.propose({ intent: createIntent("body"), reason: "r", source: "s" })
    expect(r.applied).toBe(true)
    expect(existsSync(join(root, "memory", "notes/new.md"))).toBe(true)
  })

  it("reports knowledge_propose as writable in status once a writer exists", async () => {
    const { service } = composeKnowledgeService({
      workspaceRoot: root,
      providerId: "cli",
      destinationKind: "local",
      writable: true,
    })
    const status = await service.status()
    const propose = status.capabilities.find((c) => c.name === "knowledge_propose")
    expect(propose?.readOnly).toBe(false)
  })
})
