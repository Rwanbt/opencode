/* SPDX-License-Identifier: MIT */
import { describe, it, expect } from "bun:test"
import {
  validateEntry,
  planReplay,
  WalValidationError,
  type WalEntry,
} from "../../src/knowledge/wal/wal.js"
import {
  upsertEntry,
  reachabilityReport,
  ClassBValidationError,
} from "../../src/knowledge/classb/classb.js"
import { ControlStore, ControlValidationError } from "../../src/knowledge/control/control-store.js"
import {
  callBounded,
  isAtomicWriteSupported,
  ATOMIC_WRITE_MATRIX,
  checkFtsAvailability,
  isCapabilityAllowed,
  runPrepushScan,
} from "../../src/knowledge/spike/p0.js"

const VALID_HASH = "0".repeat(64)

describe("P2.3 TS WAL adapter", () => {
  it("accepts a valid create entry", () => {
    validateEntry({
      kind: "create",
      locator: "a.md",
      previousHash: null,
      newHash: VALID_HASH,
      source: "test",
      reason: "r",
    })
  })

  it("rejects create with previousHash", () => {
    expect(() => validateEntry({
      kind: "create", locator: "a.md", previousHash: VALID_HASH, newHash: VALID_HASH, source: "s", reason: "r",
    })).toThrow(WalValidationError)
  })

  it("rejects delete with newHash", () => {
    expect(() => validateEntry({
      kind: "delete", locator: "a.md", previousHash: VALID_HASH, newHash: VALID_HASH, source: "s", reason: "r",
    })).toThrow(WalValidationError)
  })

  it("rejects empty locator/source/reason", () => {
    expect(() => validateEntry({ kind: "create", locator: "", previousHash: null, newHash: VALID_HASH, source: "s", reason: "r" })).toThrow(WalValidationError)
    expect(() => validateEntry({ kind: "create", locator: "x", previousHash: null, newHash: VALID_HASH, source: "", reason: "r" })).toThrow(WalValidationError)
    expect(() => validateEntry({ kind: "create", locator: "x", previousHash: null, newHash: VALID_HASH, source: "s", reason: "" })).toThrow(WalValidationError)
  })

  it("planReplay deduplicates by auditId", () => {
    const e = (overrides: Partial<WalEntry>): WalEntry => ({
      seq: 0,
      kind: "update",
      locator: "a.md",
      previousHash: null,
      newHash: null,
      auditId: "a1",
      source: "s",
      reason: "r",
      timestamp: "t",
      ...overrides,
    })
    const r = planReplay([
      e({ auditId: "a1", seq: 0 }),
      e({ auditId: "a1", seq: 1 }),
      e({ auditId: "a2", seq: 2 }),
    ])
    expect(r.toApply).toHaveLength(2)
    expect(r.toSkip).toHaveLength(1)
  })
})

describe("P2.4 TS ClassB adapter", () => {
  it("upsertEntry rejects empty alias/locator", () => {
    expect(() => upsertEntry(new Map(), "", "x", undefined, 0)).toThrow(ClassBValidationError)
    expect(() => upsertEntry(new Map(), "a", "", undefined, 0)).toThrow(ClassBValidationError)
  })
  it("upsertEntry increments revision", () => {
    const r1 = upsertEntry(new Map(), "a", "x.md", undefined, 0)
    expect(r1.revision).toBe(1)
    const r2 = upsertEntry(r1.next, "a", "x.md", undefined, r1.revision)
    expect(r2.revision).toBe(2)
  })
  it("reachabilityReport finds orphans", () => {
    const b = new Map<string, { alias: string; locator: string; revision: number }>([
      ["a", { alias: "a", locator: "alive.md", revision: 1 }],
      ["b", { alias: "b", locator: "orphan.md", revision: 1 }],
    ])
    const r = reachabilityReport(new Set(["alive.md"]), b)
    expect(r.orphans).toEqual(["orphan.md"])
    expect(r.missingFromB).toEqual([])
  })
})

describe("P2.5 TS ControlStore", () => {
  it("rejects empty deviceId", () => {
    expect(() => new ControlStore("")).toThrow(ControlValidationError)
  })
  it("policy grant upsert + revoke", () => {
    const s = new ControlStore("d1")
    s.upsertPolicyGrant({ id: "g1", subject: "u", action: "read", grantedAt: "t", revoked: false })
    expect(s.getPolicyGrant("g1")?.revoked).toBe(false)
    s.revokePolicyGrant("g1")
    expect(s.getPolicyGrant("g1")?.revoked).toBe(true)
  })
  it("egress grant one-shot", () => {
    const s = new ControlStore("d1")
    s.upsertEgressGrant({ id: "e1", contentHash: "h", destination: "anthropic", grantedAt: "t", consumed: false })
    expect(s.consumeEgressGrant("e1")).toBe(true)
    expect(s.consumeEgressGrant("e1")).toBe(false)
  })
  it("control log append", () => {
    const s = new ControlStore("d1")
    s.appendEvent({ id: "1", kind: "x", timestamp: "t", payload: "{}" })
    expect(s.controlLog()).toHaveLength(1)
  })
})

describe("P0 spikes", () => {
  it("callBounded returns value on success", async () => {
    const r = await callBounded({ maxBytes: 1024, deadlineMs: 100, signal: { aborted: false } }, async () => "ok")
    expect(r.value).toBe("ok")
  })
  it("callBounded returns oversize=true when payload > maxBytes", async () => {
    const r = await callBounded({ maxBytes: 4, deadlineMs: 100, signal: { aborted: false } }, async () => ({ big: "x".repeat(100) }))
    expect(r.oversize).toBe(true)
  })
  it("callBounded returns timedOut=true when slow", async () => {
    const r = await callBounded({ maxBytes: 1024, deadlineMs: 10, signal: { aborted: false } }, () => new Promise<string>((res) => setTimeout(() => res("ok"), 100)))
    expect(r.timedOut).toBe(true)
  })
  it("callBounded returns cancelled=true when signal is aborted", async () => {
    const r = await callBounded({ maxBytes: 1024, deadlineMs: 100, signal: { aborted: true } }, async () => "ok")
    expect(r.cancelled).toBe(true)
  })
  it("ATOMIC_WRITE_MATRIX lists 5 surfaces", () => {
    expect(ATOMIC_WRITE_MATRIX).toHaveLength(5)
  })
  it("isAtomicWriteSupported returns true for app_private", () => {
    expect(isAtomicWriteSupported("app_private")).toBe(true)
    expect(isAtomicWriteSupported("removable")).toBe(false)
  })
  it("checkFtsAvailability is conservative in V1", () => {
    expect(checkFtsAvailability().fts5).toBe(false)
  })
  it("sandbox blocks network.outbound and subprocess.spawn", () => {
    expect(isCapabilityAllowed("network.outbound")).toBe(false)
    expect(isCapabilityAllowed("subprocess.spawn")).toBe(false)
    expect(isCapabilityAllowed("filesystem.read")).toBe(true)
  })
  it("runPrepushScan detects a secret in the range", () => {
    const r = runPrepushScan({
      touchedLocators: ["a.md"],
      contents: [{ locator: "a.md", commit: "c1", content: "AKIAIOSFODNN7EXAMPLE" }],
    })
    expect(r.ok).toBe(false)
    expect(r.hits).toBeGreaterThan(0)
  })
  it("runPrepushScan ignores non-touched locators", () => {
    const r = runPrepushScan({
      touchedLocators: ["b.md"],
      contents: [{ locator: "a.md", commit: "c1", content: "AKIAIOSFODNN7EXAMPLE" }],
    })
    expect(r.ok).toBe(true)
  })
})
