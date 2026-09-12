/* SPDX-License-Identifier: MIT */
/**
 * Crash matrix and concurrency for Class A writes (card C31).
 *
 * The writer wrote a temporary file, appended a WAL line and renamed, with
 * none of the three flushed, nothing serialising two writers, and nothing
 * reconciling a crash. These tests inject the crash points directly against
 * the real filesystem rather than simulating them.
 *
 * The commit point is the durable WAL append. Before it, nothing happened.
 * After it, recovery finishes the rename — it is always safe to redo a
 * rename, never safe to invent a WAL entry.
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test"
import { mkdtempSync, rmSync, readFileSync, writeFileSync, existsSync, mkdirSync, appendFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createHash } from "node:crypto"
import { VaultMutationWriter, WAL_FILE, LOCK_FILE } from "../../../src/knowledge/mutation/writer.js"
import {
  TMP_SUFFIX,
  WriteLock,
  recover,
  readWalTolerant,
  writeFileDurable,
  appendLineDurable,
} from "../../../src/knowledge/mutation/durability.js"
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
  reason: "durability",
  source: "test",
})

describe("C31 — durable commit", () => {
  let root: string
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "unifia-durable-"))
  })
  afterEach(() => rmSync(root, { recursive: true, force: true }))

  it("leaves the note, a WAL entry and no temporary behind", async () => {
    const w = new VaultMutationWriter({ root })
    await w.apply({ intent: createIntent("n.md"), reason: "r", source: "s" })

    expect(existsSync(join(root, "n.md"))).toBe(true)
    expect(existsSync(join(root, `n.md${TMP_SUFFIX}`))).toBe(false)
    const wal = w.readWal()
    expect(wal).toHaveLength(1)
    // The recorded hash is the content that is actually on disk.
    expect(wal[0]?.newHash).toBe(sha256(readFileSync(join(root, "n.md"), "utf8")))
  })

  it("releases the lock after a successful write", async () => {
    const w = new VaultMutationWriter({ root })
    await w.apply({ intent: createIntent("n.md"), reason: "r", source: "s" })
    expect(existsSync(join(root, LOCK_FILE))).toBe(false)
  })

  it("releases the lock after a refused write", async () => {
    const w = new VaultMutationWriter({ root })
    await w.apply({ intent: createIntent("n.md"), reason: "r", source: "s" })
    await expect(
      w.apply({ intent: createIntent("n.md"), reason: "r", source: "s" }),
    ).rejects.toThrow()
    expect(existsSync(join(root, LOCK_FILE))).toBe(false)
  })

  it("continues the sequence from the durable log, not from a line count", async () => {
    const w = new VaultMutationWriter({ root })
    await w.apply({ intent: createIntent("a.md"), reason: "r", source: "s" })
    await w.apply({ intent: createIntent("b.md"), reason: "r", source: "s" })
    // A torn final line must not make the next sequence skip a number.
    appendFileSync(join(root, WAL_FILE), '{"seq":3,"kind":"cre')
    const fresh = new VaultMutationWriter({ root })
    await fresh.apply({ intent: createIntent("c.md"), reason: "r", source: "s" })
    expect(fresh.readWal().map((e) => e.seq)).toEqual([1, 2, 3])
  })
})

describe("C31 — crash matrix", () => {
  let root: string
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "unifia-crash-"))
    mkdirSync(join(root, ".unifia"), { recursive: true })
  })
  afterEach(() => rmSync(root, { recursive: true, force: true }))

  /** A note body and the exact bytes a committed write would leave. */
  function stagedContent(id: string, body: string) {
    return [
      "---",
      "unifia_schema: 1",
      `unifia_id: "0190d2c0-7b00-7000-8000-${id.padStart(12, "0")}"`,
      'unifia_type: "decision"',
      'unifia_lifecycle: "candidate"',
      'unifia_created_at: "2026-08-30T00:00:00Z"',
      'unifia_updated_at: "2026-08-30T00:00:00Z"',
      'unifia_project_ref: "test"',
      "unifia_supersedes: []",
      "unifia_tags: []",
      "---",
      body,
      "",
    ].join("\n")
  }

  function walLine(locator: string, content: string) {
    return JSON.stringify({
      seq: 1,
      kind: "create",
      locator,
      previousHash: null,
      newHash: sha256(content),
      auditId: "audit-1",
      source: "test",
      reason: "crash",
      timestamp: "2026-08-30T00:00:00Z",
    })
  }

  it("crash before the temporary: nothing to do", () => {
    const r = recover(root, WAL_FILE)
    expect(r.completed).toEqual([])
    expect(r.discarded).toEqual([])
  })

  it("crash after the temporary, before the WAL: the write is discarded", () => {
    const content = stagedContent("1", "never committed")
    writeFileDurable(join(root, `n.md${TMP_SUFFIX}`), content)

    const r = recover(root, WAL_FILE)
    // No durable record, so it never happened. Redoing it would invent
    // history the log does not contain.
    expect(r.discarded).toHaveLength(1)
    expect(existsSync(join(root, "n.md"))).toBe(false)
    expect(existsSync(join(root, `n.md${TMP_SUFFIX}`))).toBe(false)
  })

  it("crash after the WAL, before the rename: the write is completed", () => {
    const content = stagedContent("2", "committed but unrenamed")
    writeFileDurable(join(root, `n.md${TMP_SUFFIX}`), content)
    appendLineDurable(join(root, WAL_FILE), walLine("n.md", content))

    const r = recover(root, WAL_FILE)
    expect(r.completed).toHaveLength(1)
    expect(existsSync(join(root, `n.md${TMP_SUFFIX}`))).toBe(false)
    expect(parseFrontmatter(readFileSync(join(root, "n.md"), "utf8")).body.trim()).toBe(
      "committed but unrenamed",
    )
  })

  it("crash after the rename: recovery is idempotent", () => {
    const content = stagedContent("3", "already landed")
    writeFileSync(join(root, "n.md"), content)
    writeFileDurable(join(root, `n.md${TMP_SUFFIX}`), content)
    appendLineDurable(join(root, WAL_FILE), walLine("n.md", content))

    recover(root, WAL_FILE)
    const first = readFileSync(join(root, "n.md"), "utf8")
    recover(root, WAL_FILE)
    expect(readFileSync(join(root, "n.md"), "utf8")).toBe(first)
    expect(existsSync(join(root, `n.md${TMP_SUFFIX}`))).toBe(false)
  })

  it("a torn final WAL line does not lose the entries before it", () => {
    const content = stagedContent("4", "body")
    appendLineDurable(join(root, WAL_FILE), walLine("n.md", content))
    appendFileSync(join(root, WAL_FILE), '{"seq":2,"kind":"upda')

    const { entries, truncated } = readWalTolerant(join(root, WAL_FILE))
    expect(entries).toHaveLength(1)
    expect(truncated).toBe(1)
    expect(recover(root, WAL_FILE).truncatedWalLines).toBe(1)
  })

  it("a temporary whose hash does not match any entry is discarded", () => {
    const committed = stagedContent("5", "recorded")
    const stray = stagedContent("6", "not recorded")
    appendLineDurable(join(root, WAL_FILE), walLine("recorded.md", committed))
    writeFileDurable(join(root, `stray.md${TMP_SUFFIX}`), stray)

    const r = recover(root, WAL_FILE)
    expect(r.discarded).toHaveLength(1)
    expect(existsSync(join(root, "stray.md"))).toBe(false)
  })

  it("recovers on open, before the first write", async () => {
    const content = stagedContent("7", "pending")
    writeFileDurable(join(root, `p.md${TMP_SUFFIX}`), content)
    appendLineDurable(join(root, WAL_FILE), walLine("p.md", content))

    const w = new VaultMutationWriter({ root })
    expect(w.recovery().completed).toHaveLength(1)
    expect(existsSync(join(root, "p.md"))).toBe(true)
  })
})

describe("C31 — concurrency", () => {
  let root: string
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "unifia-lock-"))
    mkdirSync(join(root, ".unifia"), { recursive: true })
  })
  afterEach(() => rmSync(root, { recursive: true, force: true }))

  it("refuses a second holder while the lock is held", () => {
    const a = new WriteLock(join(root, LOCK_FILE))
    const b = new WriteLock(join(root, LOCK_FILE))
    a.acquire()
    try {
      expect(() => b.acquire()).toThrow(/locked by another writer/)
    } finally {
      a.release()
    }
  })

  it("hands the lock over once released", () => {
    const a = new WriteLock(join(root, LOCK_FILE))
    const b = new WriteLock(join(root, LOCK_FILE))
    a.acquire()
    a.release()
    b.acquire()
    b.release()
    expect(existsSync(join(root, LOCK_FILE))).toBe(false)
  })

  it("reclaims a lock abandoned by a dead process", () => {
    // A lock file with an old mtime is what a crashed writer leaves behind.
    const path = join(root, LOCK_FILE)
    writeFileSync(path, JSON.stringify({ pid: 999999, at: "2020-01-01T00:00:00Z" }))
    const old = new Date(Date.now() - 120_000)
    require("node:fs").utimesSync(path, old, old)

    const lock = new WriteLock(path)
    lock.acquire()
    lock.release()
    expect(existsSync(path)).toBe(false)
  })

  it("serialises two writers so neither reuses a sequence number", async () => {
    const a = new VaultMutationWriter({ root })
    const b = new VaultMutationWriter({ root })
    await Promise.all([
      a.apply({ intent: createIntent("a.md"), reason: "r", source: "s" }),
      b.apply({ intent: createIntent("b.md"), reason: "r", source: "s" }),
    ])
    const seqs = a.readWal().map((e) => e.seq)
    expect(seqs).toEqual([1, 2])
    expect(new Set(seqs).size).toBe(seqs.length)
  })
})
