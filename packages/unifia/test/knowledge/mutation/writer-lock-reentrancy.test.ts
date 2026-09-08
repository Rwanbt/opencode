/* SPDX-License-Identifier: MIT */
/**
 * P1-A — the write lock survives a nested `commit` inside `supersede`.
 *
 * `supersede` takes the lock once and writes two notes under it; each write
 * goes through `commit`, which takes the same lock again. While `WriteLock`
 * tracked a boolean `held`, the *inner* release unlinked the lock file even
 * though the outer operation was still running. Between the successor's
 * write and the target's, the vault was unlocked: another writer could land
 * a note there, and if it did, the second `commit` failed with
 * "vault is locked by another writer" — leaving a successor that claims to
 * replace a note nothing marked superseded.
 *
 * `W-MUT-02`'s own suite could not see this: it mutates the successor
 * *before* `apply` is called, so it exercises the plan-vs-apply window, not
 * the window between the two writes. These tests open that window
 * deliberately, from inside the operation, and check it from two angles:
 *
 *   1. `WriteLock` itself — nesting must keep the file on disk and keep a
 *      rival instance out for the whole span.
 *   2. `supersede` — a real second *process* is released exactly between the
 *      two commits and must be refused.
 *
 * The second test replaces the writer's own `commit` on the instance. That
 * is a deliberate test double on a private method: the window it targets
 * exists only between two internal calls, and there is no product reason to
 * expose a seam for it.
 */

import { describe, it, expect, beforeEach, afterEach, spyOn } from "bun:test"
import * as fs from "node:fs"
import { mkdtempSync, rmSync, readFileSync, existsSync, mkdirSync, utimesSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createHash } from "node:crypto"
import { VaultMutationWriter, WAL_FILE, LOCK_FILE } from "../../../src/knowledge/mutation/writer.js"
import { WriteLock } from "../../../src/knowledge/mutation/durability.js"
import { KnowledgeFailure } from "../../../src/knowledge/domain/errors.js"
import { parseFrontmatter } from "../../../src/knowledge/parser/frontmatter.js"

const sha256 = (s: string) => createHash("sha256").update(s, "utf8").digest("hex")

const OPEN = {
  remoteModel: "deny",
  localModel: "allow",
  embeddable: "allow",
  exportable: "deny",
} as const

const CHILD = join(import.meta.dir, "..", "source", "writer-stress-child.ts")

describe("P1-A — reentrant write lock", () => {
  let root: string
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "unifia-p1a-"))
    mkdirSync(join(root, ".unifia"), { recursive: true })
  })
  afterEach(() => rmSync(root, { recursive: true, force: true }))

  it("keeps the lock file for the whole nesting, not just the inner span", () => {
    const path = join(root, LOCK_FILE)
    const lock = new WriteLock(path)
    const seen: boolean[] = []

    lock.withLock(() => {
      seen.push(existsSync(path))
      lock.withLock(() => {
        seen.push(existsSync(path))
      })
      // The inner release must not have unlinked the file: the outer
      // holder is still inside its critical section.
      seen.push(existsSync(path))
    })
    seen.push(existsSync(path))

    expect(seen).toEqual([true, true, true, false])
    expect(lock.isHeld).toBe(false)
  })

  it("keeps a rival holder out for the whole nesting", () => {
    const path = join(root, LOCK_FILE)
    const lock = new WriteLock(path)
    const rival = new WriteLock(path)
    const refusals: string[] = []

    const tryRival = () => {
      try {
        rival.acquire()
        rival.release()
        refusals.push("acquired")
      } catch (e) {
        refusals.push((e as Error).message.includes("locked by another writer") ? "refused" : "other")
      }
    }

    lock.withLock(() => {
      lock.withLock(() => {
        tryRival()
      })
      // This is the window P1-A named: after an inner release, before the
      // outer one.
      tryRival()
    })

    expect(refusals).toEqual(["refused", "refused"])
  })

  it("releases the lock once the outermost holder is done", () => {
    const path = join(root, LOCK_FILE)
    const lock = new WriteLock(path)
    lock.withLock(() => lock.withLock(() => undefined))

    const rival = new WriteLock(path)
    rival.acquire()
    expect(existsSync(path)).toBe(true)
    rival.release()
    expect(existsSync(path)).toBe(false)
  })

  it("refuses a second process released between the two writes of a supersede", async () => {
    const target = await seed(root, "old.md", "old body")
    const successor = await seed(root, "new.md", "new body")

    const writer = new VaultMutationWriter({ root })
    const proto = Object.getPrototypeOf(writer) as Record<string, unknown>
    const realCommit = proto.commit as (...args: unknown[]) => unknown

    const observed: { lockFilePresent: boolean; childExit: number }[] = []
    let commits = 0

    // The seam: after the successor's write lands and before the target's,
    // release a real second process against the same vault.
    ;(writer as unknown as Record<string, unknown>).commit = function (
      this: unknown,
      ...args: unknown[]
    ) {
      const result = realCommit.apply(this, args)
      commits += 1
      if (commits === 1) {
        observed.push({
          lockFilePresent: existsSync(join(root, LOCK_FILE)),
          childExit: runRivalProcess(root),
        })
      }
      return result
    }

    const result = await writer.apply({
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

    // The window was actually entered...
    expect(commits).toBe(2)
    expect(observed).toHaveLength(1)
    // ...the lock file was on disk while it was open...
    expect(observed[0]?.lockFilePresent).toBe(true)
    // ...and the rival process was refused (exit 3 = the writer threw).
    expect(observed[0]?.childExit).toBe(3)
    expect(existsSync(join(root, "notes", "rival.md"))).toBe(false)

    // The supersede itself completed: both notes carry the relation.
    expect(result.applied).toBe(true)
    const successorAfter = parseFrontmatter(readFileSync(join(root, "new.md"), "utf8")).frontmatter
    expect(successorAfter.unifia_supersedes).toContain(target.id)
    const targetAfter = parseFrontmatter(readFileSync(join(root, "old.md"), "utf8")).frontmatter
    expect(targetAfter.unifia_lifecycle).toBe("superseded")

    // And the lock is free again.
    expect(existsSync(join(root, LOCK_FILE))).toBe(false)
  })
})

/**
 * Run `writer-stress-child.ts` against `root` and return its exit code.
 *
 * The child's barrier file is written up front so it proceeds immediately:
 * this call is synchronous and blocks the supersede, which is exactly the
 * determinism the window needs. Exit 0 means the child wrote its note
 * (the lock was open); exit 3 means the writer refused it.
 */
function runRivalProcess(root: string): number {
  const readyDir = mkdtempSync(join(tmpdir(), "unifia-p1a-rival-"))
  const goFile = join(readyDir, "go")
  writeFileSync(goFile, "go")
  const proc = Bun.spawnSync(["bun", CHILD, root, "rival", readyDir, goFile], {
    stdout: "pipe",
    stderr: "pipe",
  })
  rmSync(readyDir, { recursive: true, force: true })
  return proc.exitCode
}

async function seed(root: string, locator: string, body: string) {
  const w = new VaultMutationWriter({ root })
  const r = await w.apply({
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
  const raw = readFileSync(join(root, locator), "utf8")
  const id = r.ref?.id as string
  await w.apply({
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
  return { id, hash: sha256(readFileSync(join(root, locator), "utf8")) }
}

void WAL_FILE

/**
 * P2 follow-up — losing the race after a reclaim is contention, not a crash.
 *
 * `acquire` used to run the second `create` unguarded, on the assumption
 * that reclaiming a stale lock entitles the reclaimer to it. It does not:
 * between the reclaim and the create, a third process can take it, and
 * `openSync(path, "wx")` then threw a raw `EEXIST` straight out of
 * `acquire` — past the typed refusal every caller branches on. Callers
 * that retry on contention could not recognise it, so a loaded machine
 * turned a busy vault into a filesystem crash.
 *
 * The window is forced here by making the reclaim's own `unlinkSync` hand
 * the lock to someone else before it returns.
 */
describe("P2 — a lost reclaim race is a typed refusal", () => {
  let root: string
  const restore: Array<() => void> = []
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "unifia-lockrace-"))
    mkdirSync(join(root, ".unifia"), { recursive: true })
  })
  afterEach(() => {
    for (const r of restore.splice(0)) r()
    rmSync(root, { recursive: true, force: true })
  })

  it("refuses with the typed error instead of leaking EEXIST", () => {
    const path = join(root, LOCK_FILE)
    // A lock with no readable pid and an old mtime: the time-only heuristic
    // decides it is abandoned, so the reclaim succeeds.
    writeFileSync(path, "not json")
    const longAgo = new Date(Date.now() - 10 * 60_000)
    utimesSync(path, longAgo, longAgo)

    // The third process: it takes the lock in the instant the reclaim frees it.
    const spy = spyOn(fs, "unlinkSync")
    const realUnlink = spy.getMockImplementation() as (p: string) => void
    spy.mockImplementation(((p: string) => {
      realUnlink(p)
      if (p === path) writeFileSync(path, JSON.stringify({ pid: process.pid, at: new Date().toISOString() }))
    }) as never)
    restore.push(() => spy.mockRestore())

    let failure: unknown
    try {
      new WriteLock(path).acquire()
    } catch (e) {
      failure = e
    }

    expect(failure).toBeInstanceOf(KnowledgeFailure)
    expect((failure as Error).message).toMatch(/locked by another writer/)
    // Not the raw filesystem error the caller could not classify.
    expect((failure as { code?: string }).code).toBeUndefined()
  })
})
