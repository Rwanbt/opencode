/* SPDX-License-Identifier: MIT */
import { describe, it, expect, beforeEach } from "bun:test"
import { LifecycleAuditLog } from "../../../src/knowledge/memory/audit.js"
import type { KnowledgeId } from "@unifia/contracts/knowledge"

let log: LifecycleAuditLog
beforeEach(() => {
  log = new LifecycleAuditLog()
})

const ID_A = "0190d2c0-7b00-7000-8000-000000000001" as KnowledgeId

describe("P4.4 lifecycle audit log", () => {
  it("appends entries with a monotonically increasing seq", () => {
    const e1 = log.append({ id: ID_A, from: "candidate", to: "active", auditId: "a1", reason: "promoted", source: "user" })
    const e2 = log.append({ id: ID_A, from: "active", to: "superseded", auditId: "a2", reason: "newer version", source: "agent" })
    expect(e1.seq).toBe(1)
    expect(e2.seq).toBe(2)
  })

  it("refuses to log a no-op transition", () => {
    expect(() =>
      log.append({ id: ID_A, from: "active", to: "active", auditId: "a1", reason: "x", source: "user" }),
    ).toThrow(/no-op/)
  })

  it("refuses an empty auditId", () => {
    expect(() =>
      log.append({ id: ID_A, from: "candidate", to: "active", auditId: "", reason: "x", source: "user" }),
    ).toThrow()
  })

  it("all() returns entries ordered by seq", () => {
    log.append({ id: ID_A, from: "candidate", to: "active", auditId: "a1", reason: "r", source: "user" })
    log.append({ id: ID_A, from: "active", to: "archived", auditId: "a2", reason: "r", source: "user" })
    const all = log.all()
    expect(all).toHaveLength(2)
    expect(all[0]?.seq).toBe(1)
    expect(all[1]?.seq).toBe(2)
  })

  it("byId filters by target id", () => {
    const ID_B = "0190d2c0-7b00-7000-8000-000000000002" as KnowledgeId
    log.append({ id: ID_A, from: "candidate", to: "active", auditId: "a1", reason: "r", source: "user" })
    log.append({ id: ID_B, from: "candidate", to: "active", auditId: "a2", reason: "r", source: "user" })
    expect(log.byId(ID_A)).toHaveLength(1)
    expect(log.byId(ID_B)).toHaveLength(1)
  })

  it("bySource filters by source", () => {
    log.append({ id: ID_A, from: "candidate", to: "active", auditId: "a1", reason: "r", source: "user" })
    log.append({ id: ID_A, from: "active", to: "archived", auditId: "a2", reason: "r", source: "agent" })
    expect(log.bySource("user")).toHaveLength(1)
    expect(log.bySource("agent")).toHaveLength(1)
  })

  it("byTransition filters by destination state", () => {
    log.append({ id: ID_A, from: "candidate", to: "active", auditId: "a1", reason: "r", source: "user" })
    log.append({ id: ID_A, from: "active", to: "archived", auditId: "a2", reason: "r", source: "user" })
    expect(log.byTransition("active")).toHaveLength(1)
    expect(log.byTransition("archived")).toHaveLength(1)
    expect(log.byTransition("superseded")).toHaveLength(0)
  })

  it("byTimeRange filters by ISO 8601 range", () => {
    log.append({ id: ID_A, from: "candidate", to: "active", auditId: "a1", reason: "r", source: "user", timestamp: "2026-01-01T00:00:00Z" })
    log.append({ id: ID_A, from: "active", to: "archived", auditId: "a2", reason: "r", source: "user", timestamp: "2026-06-01T00:00:00Z" })
    log.append({ id: ID_A, from: "archived", to: "active", auditId: "a3", reason: "r", source: "user", timestamp: "2026-12-01T00:00:00Z" })
    expect(log.byTimeRange("2026-05-01T00:00:00Z", "2026-12-31T23:59:59Z")).toHaveLength(2)
  })

  it("size() returns the entry count", () => {
    expect(log.size()).toBe(0)
    log.append({ id: ID_A, from: "candidate", to: "active", auditId: "a1", reason: "r", source: "user" })
    expect(log.size()).toBe(1)
  })

  it("reset() clears the log", () => {
    log.append({ id: ID_A, from: "candidate", to: "active", auditId: "a1", reason: "r", source: "user" })
    log.reset()
    expect(log.size()).toBe(0)
  })
})
