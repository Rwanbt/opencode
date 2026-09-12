/* SPDX-License-Identifier: MIT */
import { describe, it, expect } from "bun:test"
import {
  CRASH_SCENARIOS,
  assertRecoveryInvariant,
  sovereigntyChecks,
  assertPathContainment,
} from "../../../src/knowledge/hardening/recovery.js"

describe("P11 hardening — crash matrix", () => {
  it("defines 6 crash scenarios", () => {
    expect(CRASH_SCENARIOS).toHaveLength(6)
  })

  it("every scenario is WAL-idempotent (recovery invariant)", () => {
    const r = assertRecoveryInvariant()
    expect(r.ok).toBe(true)
    expect(r.failures).toEqual([])
  })

  it("covers all canonical crash points", () => {
    const points = new Set(CRASH_SCENARIOS.map((s) => s.point))
    expect(points).toContain("before-fsync")
    expect(points).toContain("after-fsync-before-rename")
    expect(points).toContain("after-rename-before-wal-fsync")
    expect(points).toContain("after-wal-fsync")
  })
})

describe("P11 hardening — sovereignty", () => {
  it("passes when all four are true", () => {
    const r = sovereigntyChecks({
      internetOff: true,
      cloudOff: true,
      derivedDbDeletable: true,
      vaultReadable: true,
    })
    expect(r.ok).toBe(true)
  })
  it("fails if the vault is not readable", () => {
    const r = sovereigntyChecks({
      internetOff: true,
      cloudOff: true,
      derivedDbDeletable: true,
      vaultReadable: false,
    })
    expect(r.ok).toBe(false)
  })
  it("fails if the derived DB is not deletable", () => {
    const r = sovereigntyChecks({
      internetOff: true,
      cloudOff: true,
      derivedDbDeletable: false,
      vaultReadable: true,
    })
    expect(r.ok).toBe(false)
  })
})

describe("P11 hardening — path containment", () => {
  it("rejects every path attack", () => {
    const r = assertPathContainment([
      { locator: "../escape" as never, rejected: true },
      { locator: "/etc/passwd" as never, rejected: true },
      { locator: "C:/Windows" as never, rejected: true },
    ])
    expect(r.ok).toBe(true)
  })
  it("flags a non-rejected attack", () => {
    const r = assertPathContainment([
      { locator: "memory/x.md" as never, rejected: false },
    ])
    expect(r.ok).toBe(false)
  })
})
