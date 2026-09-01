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

/** Errors a Windows rename raises when a handle is still open on the target. */
const TRANSIENT_RENAME_CODES = new Set(["EPERM", "EACCES", "EBUSY"])

/** How long `renameDurable` keeps retrying a transient Windows refusal. */
const RENAME_RETRY_BUDGET_MS = 2_000
const RENAME_RETRY_POLL_MS = 5

/** Block the thread for `ms`. The write path is synchronous by contract. */
export function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
}

/**
 * Rename `from` over `to`, tolerating Windows' open-handle refusals.
 *
 * POSIX `rename` replaces the destination whatever else holds it open.
 * Windows does not: while any process has a handle on `to` — a concurrent
 * reader, an antivirus scanner, the search indexer — `MoveFileEx` fails with
 * `EPERM`, and the write is lost even though the temporary was complete and
 * fsynced. Measured here at roughly one publish in five with four processes
 * writing one small file.
 *
 * Retrying briefly is the remedy every Windows-targeting tool converges on.
 * It is bounded: a destination held open indefinitely is a real failure and
 * still surfaces as one, rather than hanging the caller.
 */
export function renameDurable(from: string, to: string): void {
  const deadline = Date.now() + RENAME_RETRY_BUDGET_MS
  for (;;) {
    try {
      renameSync(from, to)
      return
    } catch (e) {
      const code = (e as NodeJS.ErrnoException).code ?? ""
      if (!TRANSIENT_RENAME_CODES.has(code) || Date.now() >= deadline) throw e
      sleepSync(RENAME_RETRY_POLL_MS)
    }
  }
}

/**
 * Liveness verdict for a recorded PID.
 *
 * - `alive`   : the kernel confirmed the process exists (signal 0 succeeded
 *                or `EPERM` was raised). The holder is real.
 * - `dead`    : the kernel confirmed the process is gone (`ESRCH`). Safe
 *                to reclaim immediately.
 * - `unknown` : the PID is not a candidate for the kernel check at all
 *                (non-integer, non-positive, or our own pid surfaced in an
 *                odd place). The caller must fall back to a different
 *                policy, never to "steal the lock".
 */
export type PidLiveness = "alive" | "dead" | "unknown"

/**
 * Best-effort liveness check for `pid`.
 *
 * Signal 0 on POSIX and the existence check on Windows behave the same
 * way for this purpose: both throw `ESRCH` for a non-existent pid.
 *
 * `unknown` is returned for pids that should not reach the kernel: a
 * zero, a negative, a non-integer, or a value larger than any pid the
 * kernel would ever allocate (the signed 32-bit max). The conservative
 * policy is: if we cannot prove the holder is dead, do not steal the
 * lock.
 */
export function pidLiveness(pid: number): PidLiveness {
  if (!Number.isInteger(pid) || pid <= 0) return "unknown"
  if (pid > 0x7fffffff) return "unknown"
  if (pid === process.pid) return "alive"
  try {
    process.kill(pid, 0)
    return "alive"
  } catch (e) {
    const code = (e as { code?: string } | null)?.code
    if (code === "ESRCH") return "dead"
    if (code === "EPERM") return "alive"
    return "unknown"
  }
}

/**
 * True iff `pid` is verifiably alive. Kept for tests and for callers
 * that want a simple boolean (true iff "alive", false otherwise).
 */
export function isPidAlive(pid: number): boolean {
  return pidLiveness(pid) === "alive"
}

/**
 * Read the recorded pid from a lock file, if any.
 *
 * The lock file is `{ pid, at }` written as JSON. Returns `null` if the
 * file cannot be read or parsed, so the caller can fall back to the
 * time-only heuristic.
 */
function readLockPid(path: string): number | null {
  try {
    const raw = readFileSync(path, "utf8")
    const parsed = JSON.parse(raw) as { pid?: unknown }
    if (typeof parsed.pid === "number" && Number.isInteger(parsed.pid)) {
      return parsed.pid
    }
    return null
  } catch {
    return null
  }
}

/**
 * Exclusive, cross-process write lock.
 *
 * `O_EXCL` makes acquisition atomic even between processes. The holder's pid
 * and timestamp are recorded so a lock left by a crashed process can be
 * reclaimed instead of blocking the vault forever.
 *
 * Reclaim is *liveness-first*: a lock held by a process whose pid is still
 * alive is never stolen, even if its mtime is older than `LOCK_STALE_MS`.
 * The time heuristic is the fallback for locks we cannot read, or whose
 * recorded pid is unverifiable (corrupt file, pid from a previous boot,
 * cross-platform state).
 *
 * The lock is *reentrant*, counted by `depth`. An operation that spans
 * several writes — `supersede` touches two notes — takes the lock once
 * and calls `commit` under it; `commit` takes the same lock again. With a
 * boolean flag the inner `release` unlinked the lock file while the outer
 * operation was still running, so a second writer could land between the
 * successor's write and the target's. The counter makes the physical lock
 * live exactly as long as the outermost `withLock`.
 */
export class WriteLock {
  /**
   * Number of nested `acquire()` calls currently outstanding. The lock file
   * exists on disk for `depth > 0` and only for that span.
   */
  private depth = 0

  constructor(private readonly path: string) {}

  acquire(): void {
    if (this.depth > 0) {
      this.depth += 1
      return
    }
    mkdirSync(dirname(this.path), { recursive: true })
    // Two attempts: one, and one more after reclaiming a dead holder's lock.
    //
    // The second `create` used to be unguarded, on the assumption that
    // reclaiming entitles us to the lock. It does not: between the reclaim
    // and the create, a third process can take it. `openSync(path, "wx")`
    // then threw a raw `EEXIST` straight out of `acquire`, past the typed
    // refusal every caller branches on — so contention surfaced as a
    // filesystem crash instead of "the vault is busy", and callers that
    // retry on contention could not recognise it. Guarding both attempts
    // the same way means every loss of the race leaves by the same door.
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        this.create()
        this.depth = 1
        return
      } catch {
        if (attempt === 1 || !this.reclaimIfStale()) {
          throw KnowledgeFailure.mutationRefused(
            `vault is locked by another writer: ${this.path}`,
          )
        }
      }
    }
  }

  release(): void {
    if (this.depth === 0) return
    this.depth -= 1
    // An inner release only unwinds the counter: the file stays until the
    // outermost holder lets go, so no window opens mid-operation.
    if (this.depth > 0) return
    try {
      unlinkSync(this.path)
    } catch {
      // Already gone; the lock is free either way.
    }
  }

  /** True while this instance physically holds the lock file. */
  get isHeld(): boolean {
    return this.depth > 0
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
    const pid = readLockPid(this.path)
    if (pid !== null) {
      const liveness = pidLiveness(pid)
      if (liveness === "alive") {
        // The recorded holder is still running. We never steal a live
        // holder's lock: the operator has to wait, or kill the holder.
        return false
      }
      if (liveness === "dead") {
        // Dead pid: reclaim regardless of the mtime. A crashed writer is
        // reclaimed as soon as we notice, instead of after LOCK_STALE_MS.
        try {
          unlinkSync(this.path)
          return true
        } catch {
          // Vanished between the failed create and here.
          return true
        }
      }
      // liveness === "unknown": the recorded pid is not something the
      // kernel can check (negative, too large, non-integer). Fall back
      // to the time-only heuristic instead of guessing.
    }

    // No recorded pid (legacy file, corrupt file, or unverifiable).
    // Fall back to the time-only heuristic.
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
 *
 * For `move` and `restore` entries the WAL carries `previousLocator`: the
 * path the note used to live at. If the destination already holds the
 * recorded hash but the source is still there, the write half-completed
 * before the unlink — we drop the source so the vault never carries two
 * silent copies of the same note.
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
        renameDurable(tmp, destination)
        fsyncDirectory(dirname(destination))
      }
      report.completed.push(destination)
    } catch {
      // Leave it for the next attempt rather than losing recorded content.
    }
  }

  // Second pass: a crash between the destination commit and the unlink of
  // the previous path leaves a duplicate. The WAL told us where the note
  // used to live, so we can finish the unlink deterministically.
  for (const entry of entries) {
    if (entry.previousLocator === undefined) continue
    if (entry.newHash === null) continue
    if (entry.kind !== "move" && entry.kind !== "restore") continue

    const destination = join(root, entry.locator)
    const source = join(root, entry.previousLocator)
    try {
      const destinationHash =
        existsSync(destination) && sha256(readFileSync(destination, "utf8"))
      if (destinationHash !== entry.newHash) {
        // The destination is not what the WAL recorded; the write never
        // landed or has been overwritten. Leave the source alone.
        continue
      }
      if (!existsSync(source)) {
        // The unlink had already happened; nothing to do.
        continue
      }
      const sourceHash = sha256(readFileSync(source, "utf8"))
      if (sourceHash !== entry.newHash) {
        // The source is a different note now (or has been edited). The
        // recorder's note is at the destination; do not touch the source.
        continue
      }
      unlinkSync(source)
    } catch {
      // Leave it for the next attempt; we do not invent unlinks.
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
