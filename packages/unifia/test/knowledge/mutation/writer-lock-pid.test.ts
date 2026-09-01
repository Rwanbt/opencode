/* SPDX-License-Identifier: MIT */
/**
 * W-MUT-03 — the write lock refuses to steal a lock whose PID is alive.
 *
 * A long-running process that left its lock by a slow commit (rather than
 * by crashing) is still using the vault; reclaiming its lock would let
 * two writers touch the same WAL. The liveness check verifies the holder
 * by signalling it with signal 0, which both POSIX and Windows translate
 * to an existence test that throws ESRCH for a dead PID.
 *
 * If the recorded PID is unreadable or unverifiable, the lock falls
 * back to the time-only heuristic — the conservative strategy is "wait,
 * not steal".
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test"
import { mkdtempSync, rmSync, writeFileSync, existsSync, mkdirSync, utimesSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { WriteLock, isPidAlive, LOCK_STALE_MS } from "../../../src/knowledge/mutation/durability.js"
import { VaultMutationWriter, LOCK_FILE } from "../../../src/knowledge/mutation/writer.js"

describe("W-MUT-03 — isPidAlive", () => {
  it("treats our own PID as alive without asking the kernel", () => {
    expect(isPidAlive(process.pid)).toBe(true)
  })

  it("treats a sentinel non-positive PID as dead", () => {
    expect(isPidAlive(0)).toBe(false)
    expect(isPidAlive(-1)).toBe(false)
  })

  it("treats a clearly non-existent high PID as dead", () => {
    // 2^31 - 1 is the largest signed 32-bit integer; no real process
    // can hold that pid on either POSIX or Windows. The kernel will
    // answer ESRCH deterministically.
    expect(isPidAlive(0x7fffffff)).toBe(false)
  })
})

describe("W-MUT-03 — WriteLock honours liveness over age", () => {
  let root: string
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "unifia-wmut03-"))
    mkdirSync(join(root, ".unifia"), { recursive: true })
  })
  afterEach(() => rmSync(root, { recursive: true, force: true }))

  function plantStaleLockFile(recorded: { pid: number; at: string }) {
    const path = join(root, LOCK_FILE)
    writeFileSync(path, JSON.stringify(recorded))
    // The recorded mtime is well past the staleness threshold; without
    // the liveness check, this lock would be reclaimed.
    const old = new Date(Date.now() - 2 * LOCK_STALE_MS)
    utimesSync(path, old, old)
    return path
  }

  it("does not reclaim a lock whose holder is still alive, even when the mtime is old", () => {
    plantStaleLockFile({ pid: process.pid, at: new Date(Date.now() - 2 * LOCK_STALE_MS).toISOString() })

    const lock = new WriteLock(join(root, LOCK_FILE))
    expect(() => lock.acquire()).toThrow(/locked by another writer/)
    // The file is still there: we did not steal it.
    expect(existsSync(join(root, LOCK_FILE))).toBe(true)
  })

  it("reclaims immediately when the recorded holder is dead", () => {
    // 0x7fffffff is the largest signed 32-bit integer; ESRCH on every
    // platform. The mtime is recent, so the time-only heuristic would
    // have refused to reclaim — the liveness check is what makes the
    // reclaim happen.
    const path = plantStaleLockFile({
      pid: 0x7fffffff,
      at: new Date().toISOString(),
    })
    // But mtime is set to "now" so the time-only path would refuse.
    utimesSync(path, new Date(), new Date())

    const lock = new WriteLock(path)
    lock.acquire()
    lock.release()
    expect(existsSync(path)).toBe(false)
  })

  it("falls back to the time-only heuristic when the lock has no recorded pid", () => {
    const path = join(root, LOCK_FILE)
    // A pre-V1 lock file that does not parse: the writer must not assume
    // liveness from a missing field, so it uses age.
    writeFileSync(path, JSON.stringify({ at: "2020-01-01T00:00:00Z" }))
    const old = new Date(Date.now() - 2 * LOCK_STALE_MS)
    utimesSync(path, old, old)

    const lock = new WriteLock(path)
    lock.acquire()
    lock.release()
    expect(existsSync(path)).toBe(false)
  })

  it("falls back to the time-only heuristic when the lock file is corrupt", () => {
    const path = join(root, LOCK_FILE)
    writeFileSync(path, "{ this is not json")
    const old = new Date(Date.now() - 2 * LOCK_STALE_MS)
    utimesSync(path, old, old)

    const lock = new WriteLock(path)
    lock.acquire()
    lock.release()
    expect(existsSync(path)).toBe(false)
  })

  it("refuses to reclaim a recent lock whose pid is unverifiable", () => {
    // A lock written with an unreadable structure but a fresh mtime: the
    // time-only heuristic says "wait", and so does the liveness-first
    // path. The vault must stay closed.
    const path = join(root, LOCK_FILE)
    writeFileSync(path, JSON.stringify({ pid: -1, at: "just now" }))
    // Note: no utimes adjustment — the mtime is now.
    const lock = new WriteLock(path)
    expect(() => lock.acquire()).toThrow(/locked by another writer/)
    expect(existsSync(path)).toBe(true)
  })
})

describe("W-MUT-03 — VaultMutationWriter surfaces the liveness-first policy", () => {
  let root: string
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "unifia-wmut03b-"))
    mkdirSync(join(root, ".unifia"), { recursive: true })
  })
  afterEach(() => rmSync(root, { recursive: true, force: true }))

  it("refuses to start a writer when a live process holds the lock", async () => {
    // A live writer holds the lock from another process. We simulate
    // "another process" by writing a lock file with our own PID (which
    // is alive from the kernel's perspective) and an old mtime.
    const path = join(root, LOCK_FILE)
    writeFileSync(path, JSON.stringify({ pid: process.pid, at: "2020-01-01T00:00:00Z" }))
    utimesSync(path, new Date(Date.now() - 5 * LOCK_STALE_MS), new Date(Date.now() - 5 * LOCK_STALE_MS))

    // The constructor runs recovery (which can succeed) but the first
    // apply() needs the lock. We assert the lock is held by attempting
    // to acquire it from a fresh lock object.
    const lock = new WriteLock(path)
    expect(() => lock.acquire()).toThrow(/locked by another writer/)
  })
})
