/* SPDX-License-Identifier: MIT */
/**
 * Durability primitives for Class A writes (card C31).
 *
 * The writer wrote a temporary file, appended a WAL line and renamed. None of
 * the three was flushed, nothing serialised two writers, and nothing
 * reconciled a crash — so a power loss could leave a WAL entry with no file,
 * a file with no entry, or two processes reusing one sequence number.
 *
 * The commit invariant this module implements:
 *
 *   1. the temporary file is written and **fsynced** — its bytes are on disk;
 *   2. the WAL line is appended and **fsynced** — the intent is durable;
 *   3. the rename makes it visible — atomic on both NTFS and POSIX;
 *   4. the directory is fsynced where the platform supports it.
 *
 * "Committed" means step 2 completed: the WAL is the record of truth. A crash
 * before it leaves an orphan temporary and no entry — nothing happened. A
 * crash between 2 and 3 leaves an entry whose target does not yet match, and
 * recovery finishes the rename. That asymmetry is deliberate: it is always
 * safe to redo a rename, never safe to invent a WAL entry.
 */

import {
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  readSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  unlinkSync,
  writeFileSync,
  writeSync,
} from "node:fs"
import { dirname, join } from "node:path"
import { createHash } from "node:crypto"
import type { WalEntry } from "../wal/wal.js"
import { KnowledgeFailure } from "../domain/errors.js"

/** Suffix that marks a not-yet-visible write. */
export const TMP_SUFFIX = ".unifia-tmp"

/** A lock older than this is treated as abandoned by a dead process. */
export const LOCK_STALE_MS = 30_000

const sha256 = (s: string) => createHash("sha256").update(s, "utf8").digest("hex")

/** Write `content` and flush it to the physical device before returning. */
export function writeFileDurable(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, content, "utf8")
  const fd = openSync(path, "r+")
  try {
    fsyncSync(fd)
  } finally {
    closeSync(fd)
  }
}

/**
 * Append `line` to `path` and flush it.
 *
 * A crash mid-append leaves a partial line with no terminating newline. The
 * next append must not run into it: without the separator below, the torn
 * tail and the new entry concatenate into one unparseable line, so a single
 * interrupted write would corrupt the *next* one too.
 */
export function appendLineDurable(path: string, line: string): void {
  mkdirSync(dirname(path), { recursive: true })
  const needsSeparator = endsMidLine(path)
  const fd = openSync(path, "a")
  try {
    writeSync(fd, `${needsSeparator ? "\n" : ""}${line}\n`)
    fsyncSync(fd)
  } finally {
    closeSync(fd)
  }
}

/** True when the file exists and its last byte is not a newline. */
function endsMidLine(path: string): boolean {
  try {
    const size = statSync(path).size
    if (size === 0) return false
    const fd = openSync(path, "r")
    try {
      const tail = Buffer.alloc(1)
      readSync(fd, tail, 0, 1, size - 1)
      return tail[0] !== 0x0a
    } finally {
      closeSync(fd)
    }
  } catch {
    return false
  }
}

/**
 * Flush a directory entry so a rename survives a power loss.
 *
 * Windows does not allow opening a directory for fsync; the rename is already
 * ordered there, so the failure is expected and ignored rather than reported
 * as an error the operator can do nothing about.
 */
export function fsyncDirectory(path: string): void {
  let fd: number
  try {
    fd = openSync(path, "r")
  } catch {
    return
  }
  try {
    fsyncSync(fd)
  } catch {
    // Directory fsync is not supported on this platform.
  } finally {
    closeSync(fd)
  }
}

/**
 * Exclusive, cross-process write lock.
 *
 * `O_EXCL` makes acquisition atomic even between processes. The holder's pid
 * and timestamp are recorded so a lock left by a crashed process can be
 * reclaimed instead of blocking the vault forever.
 */
export class WriteLock {
  private held = false

  constructor(private readonly path: string) {}

  acquire(): void {
    if (this.held) return
    mkdirSync(dirname(this.path), { recursive: true })
    try {
      this.create()
    } catch {
      if (!this.reclaimIfStale()) {
        throw KnowledgeFailure.mutationRefused(
          `vault is locked by another writer: ${this.path}`,
        )
      }
      this.create()
    }
    this.held = true
  }

  release(): void {
    if (!this.held) return
    this.held = false
    try {
      unlinkSync(this.path)
    } catch {
      // Already gone; the lock is free either way.
    }
  }

  /** Run `work` while holding the lock, releasing it whatever happens. */
  withLock<T>(work: () => T): T {
    this.acquire()
    try {
      return work()
    } finally {
      this.release()
    }
  }

  private create(): void {
    const fd = openSync(this.path, "wx")
    try {
      writeSync(fd, JSON.stringify({ pid: process.pid, at: new Date().toISOString() }))
      fsyncSync(fd)
    } finally {
      closeSync(fd)
    }
  }

  private reclaimIfStale(): boolean {
    try {
      const age = Date.now() - statSync(this.path).mtimeMs
      if (age < LOCK_STALE_MS) return false
      unlinkSync(this.path)
      return true
    } catch {
      // The lock vanished between the failed create and here: retry.
      return true
    }
  }
}

export interface RecoveryReport {
  /** Temporary files whose WAL entry says they were committed. */
  completed: string[]
  /** Temporary files with no committed entry: the write never happened. */
  discarded: string[]
  /** WAL lines that could not be parsed, usually a torn final append. */
  truncatedWalLines: number
}

/**
 * Reconcile the vault with its WAL after a crash.
 *
 * A temporary file is finished only when the WAL says its content was
 * committed and the destination does not already hold it. Everything else is
 * discarded: an unrecorded temporary is a write that never reached the log,
 * and redoing it would invent history.
 */
export function recover(root: string, walFile: string): RecoveryReport {
  const report: RecoveryReport = { completed: [], discarded: [], truncatedWalLines: 0 }

  const { entries, truncated } = readWalTolerant(join(root, walFile))
  report.truncatedWalLines = truncated
  const committed = new Map<string, WalEntry>()
  for (const e of entries) {
    if (e.newHash !== null) committed.set(e.newHash, e)
  }

  for (const tmp of findTemporaries(root)) {
    let content: string
    try {
      content = readFileSync(tmp, "utf8")
    } catch {
      continue
    }
    const entry = committed.get(sha256(content))
    const destination = tmp.slice(0, tmp.lastIndexOf(TMP_SUFFIX))

    if (entry === undefined) {
      // No durable record of this write: it never happened.
      try {
        unlinkSync(tmp)
        report.discarded.push(tmp)
      } catch {
        // Someone else cleaned it up.
      }
      continue
    }

    try {
      const already = existsSync(destination) && sha256(readFileSync(destination, "utf8"))
      if (already === entry.newHash) {
        // The rename had already landed; drop the leftover.
        unlinkSync(tmp)
      } else {
        renameSync(tmp, destination)
        fsyncDirectory(dirname(destination))
      }
      report.completed.push(destination)
    } catch {
      // Leave it for the next attempt rather than losing recorded content.
    }
  }

  return report
}

/**
 * Read a WAL, tolerating a torn final line.
 *
 * An append interrupted by a power loss leaves a partial JSON line. Refusing
 * to read the whole log because of it would lose every prior entry, so the
 * unparseable tail is counted and skipped.
 */
export function readWalTolerant(path: string): { entries: WalEntry[]; truncated: number } {
  if (!existsSync(path)) return { entries: [], truncated: 0 }
  const lines = readFileSync(path, "utf8").split("\n").filter((l) => l.trim().length > 0)
  const entries: WalEntry[] = []
  let truncated = 0
  for (const line of lines) {
    try {
      entries.push(JSON.parse(line) as WalEntry)
    } catch {
      truncated += 1
    }
  }
  return { entries, truncated }
}

/** Every `*.unifia-tmp` under `root`, skipping the control directory. */
function findTemporaries(root: string, out: string[] = []): string[] {
  let names: string[]
  try {
    names = readdirSync(root)
  } catch {
    return out
  }
  for (const name of names) {
    if (name === ".git" || name === "node_modules") continue
    const full = join(root, name)
    let stats: ReturnType<typeof statSync>
    try {
      stats = statSync(full)
    } catch {
      continue
    }
    if (stats.isDirectory()) findTemporaries(full, out)
    else if (name.endsWith(TMP_SUFFIX)) out.push(full)
  }
  return out
}

/** Remove a directory tree, used by tests and by the operator's own tooling. */
export function removeTree(path: string): void {
  rmSync(path, { recursive: true, force: true })
}
