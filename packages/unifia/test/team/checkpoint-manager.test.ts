import { describe, expect, it } from "bun:test"
import { createHash } from "node:crypto"
import {
  CheckpointCorruptError,
  CheckpointIncompatibleError,
  CheckpointManager,
  CheckpointStaleError,
  type CheckpointSnapshot,
  type CheckpointStorage,
} from "../../src/team/checkpoint-manager"

const SHA = "a".repeat(64)

function snapshot(overrides: Partial<CheckpointSnapshot> = {}): CheckpointSnapshot {
  return {
    runId: "run-1",
    branch: "c-D04/20260726-solo",
    baseSha: "base-sha",
    teamHead: "team-head",
    dirtyPaths: ["z.ts", "a.ts"],
    worktrees: [{ path: "D:/wt/z", branch: "z", headSha: "z-head", dirty: true }, { path: "D:/wt/a", branch: "a", headSha: "a-head", dirty: false }],
    locks: [{ leaseId: "lease-2", workerId: "worker", fencingToken: 2, status: "RELEASED" }, { leaseId: "lease-1", workerId: "worker", fencingToken: 1, status: "CLAIMED" }],
    databaseSha256: SHA,
    budget: { inputTokens: 10, outputTokens: 20, costCents: 3 },
    health: { testStatus: "PASS", typecheckStatus: "PASS", debtStatus: "EMPTY" },
    ...overrides,
  }
}

class MemoryStorage implements CheckpointStorage {
  value = ""
  writes = 0

  read(): string {
    if (!this.value) throw new Error("missing checkpoint")
    return this.value
  }

  writeAtomic(_path: string, contents: string): void {
    this.writes++
    this.value = contents
  }
}

describe("CheckpointManager", () => {
  it("creates a deterministic versioned payload and writes it atomically", () => {
    const manager = new CheckpointManager({ now: () => "2026-07-26T19:20:00.000Z", id: () => "checkpoint-1" })
    const storage = new MemoryStorage()
    const document = manager.save("checkpoint.json", snapshot(), storage)

    expect(storage.writes).toBe(1)
    expect(document.payload.schemaVersion).toBe("1.0.0")
    expect(document.payload.checkpointId).toBe("checkpoint-1")
    expect(document.payload.dirtyPaths).toEqual(["a.ts", "z.ts"])
    expect(document.payload.worktrees[0]?.path).toBe("D:/wt/a")
    expect(document.payload.locks[0]?.leaseId).toBe("lease-1")
    expect(storage.value).toBe(manager.serialize(document))
  })

  it("restores a valid checkpoint and rejects stale branch state", () => {
    const manager = new CheckpointManager({ id: () => "checkpoint-1" })
    const storage = new MemoryStorage()
    const saved = manager.save("checkpoint.json", snapshot(), storage)

    expect(manager.restore("checkpoint.json", storage, { branch: snapshot().branch, teamHead: "team-head" })).toEqual(saved)
    expect(() => manager.restore("checkpoint.json", storage, { branch: "main" })).toThrow(CheckpointStaleError)
  })

  it("detects tampering before restore", () => {
    const manager = new CheckpointManager({ id: () => "checkpoint-1" })
    const storage = new MemoryStorage()
    manager.save("checkpoint.json", snapshot(), storage)
    storage.value = storage.value.replace("team-head", "tampered-head")

    expect(() => manager.restore("checkpoint.json", storage)).toThrow(CheckpointCorruptError)
    storage.value = JSON.stringify({ payload: { schemaVersion: "1.0.0" }, digest: "c".repeat(64) })
    expect(() => manager.restore("checkpoint.json", storage)).toThrow(CheckpointCorruptError)
  })

  it("rejects malformed JSON and incompatible schema versions", () => {
    const manager = new CheckpointManager()
    const storage = new MemoryStorage()
    storage.value = "not-json"
    expect(() => manager.restore("checkpoint.json", storage)).toThrow(CheckpointCorruptError)

    const payload = manager.create(snapshot()).payload
    storage.value = JSON.stringify({ payload: { ...payload, schemaVersion: "2.0.0" }, digest: "b".repeat(64) })
    expect(() => manager.restore("checkpoint.json", storage)).toThrow(CheckpointIncompatibleError)
  })

  it("rejects a forged digest and oversized serialized state", () => {
    const manager = new CheckpointManager()
    const storage = new MemoryStorage()
    const document = manager.create(snapshot())
    expect(() => manager.serialize({ ...document, digest: "b".repeat(64) })).toThrow(CheckpointCorruptError)
    expect(() => new CheckpointManager({ maxBytes: 10 }).serialize(document)).toThrow(RangeError)
    expect(() => new CheckpointManager({ id: () => "" }).create(snapshot())).toThrow(TypeError)
  })

  it("replays equal snapshots to the same digest regardless of input ordering", () => {
    const manager = new CheckpointManager({ id: () => "checkpoint-1", now: () => "2026-07-26T19:20:00.000Z" })
    const first = manager.create(snapshot())
    const second = manager.create(snapshot({ dirtyPaths: ["a.ts", "z.ts"], worktrees: [...snapshot().worktrees].reverse(), locks: [...snapshot().locks].reverse() }))

    expect(first.digest).toBe(second.digest)
    expect(createHash("sha256").update(manager.serialize(first)).digest("hex")).toHaveLength(64)
  })
})
