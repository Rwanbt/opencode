import { Broadcast } from "../server/broadcast"
import { Log } from "../util/log"

const log = Log.create({ service: "file-lock" })

export namespace FileLock {
  export interface LockInfo {
    filePath: string
    userID: string
    username: string
    sessionID: string
    version: number
    acquiredAt: number
  }

  export interface ConflictInfo {
    filePath: string
    heldBy: {
      userID: string
      username: string
      sessionID: string
    }
    acquiredAt: number
  }

  const locks = new Map<string, LockInfo>()

  /** Acquire a lock on a file. Returns the lock info or conflict info if already held by another user. */
  export function acquire(
    filePath: string,
    userID: string,
    username: string,
    sessionID: string,
  ): { ok: true; lock: LockInfo } | { ok: false; conflict: ConflictInfo } {
    const existing = locks.get(filePath)

    // Same user can re-acquire (update)
    if (existing && existing.userID !== userID) {
      return {
        ok: false,
        conflict: {
          filePath,
          heldBy: {
            userID: existing.userID,
            username: existing.username,
            sessionID: existing.sessionID,
          },
          acquiredAt: existing.acquiredAt,
        },
      }
    }

    const lock: LockInfo = {
      filePath,
      userID,
      username,
      sessionID,
      version: (existing?.version ?? 0) + 1,
      acquiredAt: existing?.acquiredAt ?? Date.now(),
    }
    locks.set(filePath, lock)

    Broadcast.send({
      type: "file.locked",
      filePath,
      userID,
      username,
      sessionID,
      timestamp: Date.now(),
    })

    return { ok: true, lock }
  }

  /** Release a lock. Only the lock holder or admin can release. */
  export function release(filePath: string, userID?: string): boolean {
    const existing = locks.get(filePath)
    if (!existing) return false
    if (userID && existing.userID !== userID) return false

    locks.delete(filePath)
    Broadcast.send({
      type: "file.unlocked",
      filePath,
      userID: existing.userID,
      timestamp: Date.now(),
    })
    return true
  }

  /** Check if a file is locked by someone else */
  export function check(filePath: string, userID?: string): ConflictInfo | null {
    const existing = locks.get(filePath)
    if (!existing) return null
    if (userID && existing.userID === userID) return null // Same user, no conflict

    return {
      filePath,
      heldBy: {
        userID: existing.userID,
        username: existing.username,
        sessionID: existing.sessionID,
      },
      acquiredAt: existing.acquiredAt,
    }
  }

  /** Get the lock holder for a file */
  export function holder(filePath: string): LockInfo | undefined {
    return locks.get(filePath)
  }

  /** List all active locks */
  export function list(): LockInfo[] {
    return Array.from(locks.values())
  }

  /** Release all locks held by a specific user (on disconnect) */
  export function releaseAllForUser(userID: string): number {
    let count = 0
    for (const [path, lock] of locks) {
      if (lock.userID === userID) {
        locks.delete(path)
        count++
      }
    }
    if (count > 0) {
      Broadcast.send({
        type: "file.locks_released",
        userID,
        count,
        timestamp: Date.now(),
      })
      log.info("released all locks for user", { userID, count })
    }
    return count
  }

  /** Release all locks for a session (on session end) */
  export function releaseAllForSession(sessionID: string): number {
    let count = 0
    for (const [path, lock] of locks) {
      if (lock.sessionID === sessionID) {
        locks.delete(path)
        count++
      }
    }
    return count
  }
}
