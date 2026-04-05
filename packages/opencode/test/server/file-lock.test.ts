import { describe, it, expect } from "bun:test"
import { FileLock } from "../../src/file/lock"

describe("FileLock", () => {
  it("acquires lock on a file", () => {
    const result = FileLock.acquire("/test/file1.ts", "user1", "alice", "ses_1")
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.lock.filePath).toBe("/test/file1.ts")
      expect(result.lock.userID).toBe("user1")
    }
    FileLock.release("/test/file1.ts", "user1")
  })

  it("detects conflict when another user holds lock", () => {
    FileLock.acquire("/test/file2.ts", "user1", "alice", "ses_1")
    const result = FileLock.acquire("/test/file2.ts", "user2", "bob", "ses_2")
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.conflict.heldBy.userID).toBe("user1")
      expect(result.conflict.heldBy.username).toBe("alice")
    }
    FileLock.release("/test/file2.ts", "user1")
  })

  it("allows same user to re-acquire", () => {
    FileLock.acquire("/test/file3.ts", "user1", "alice", "ses_1")
    const result = FileLock.acquire("/test/file3.ts", "user1", "alice", "ses_1")
    expect(result.ok).toBe(true)
    FileLock.release("/test/file3.ts", "user1")
  })

  it("check returns null for unlocked files", () => {
    expect(FileLock.check("/test/nonexistent.ts")).toBeNull()
  })

  it("check returns null for own locks", () => {
    FileLock.acquire("/test/file4.ts", "user1", "alice", "ses_1")
    expect(FileLock.check("/test/file4.ts", "user1")).toBeNull()
    expect(FileLock.check("/test/file4.ts", "user2")).not.toBeNull()
    FileLock.release("/test/file4.ts", "user1")
  })

  it("releases all locks for a user", () => {
    FileLock.acquire("/test/a.ts", "user-bulk", "alice", "ses_1")
    FileLock.acquire("/test/b.ts", "user-bulk", "alice", "ses_1")
    const count = FileLock.releaseAllForUser("user-bulk")
    expect(count).toBe(2)
    expect(FileLock.holder("/test/a.ts")).toBeUndefined()
  })

  it("releases all locks for a session", () => {
    FileLock.acquire("/test/c.ts", "user1", "alice", "ses_cleanup")
    FileLock.acquire("/test/d.ts", "user1", "alice", "ses_cleanup")
    const count = FileLock.releaseAllForSession("ses_cleanup")
    expect(count).toBe(2)
  })

  it("prevents release by wrong user", () => {
    FileLock.acquire("/test/file5.ts", "user1", "alice", "ses_1")
    const released = FileLock.release("/test/file5.ts", "user2")
    expect(released).toBe(false)
    expect(FileLock.holder("/test/file5.ts")).toBeTruthy()
    FileLock.release("/test/file5.ts", "user1")
  })

  it("lists all active locks", () => {
    FileLock.acquire("/test/list1.ts", "user1", "alice", "ses_1")
    FileLock.acquire("/test/list2.ts", "user2", "bob", "ses_2")
    const all = FileLock.list()
    const paths = all.map((l) => l.filePath)
    expect(paths).toContain("/test/list1.ts")
    expect(paths).toContain("/test/list2.ts")
    FileLock.release("/test/list1.ts", "user1")
    FileLock.release("/test/list2.ts", "user2")
  })
})
