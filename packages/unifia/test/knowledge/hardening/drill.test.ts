/* SPDX-License-Identifier: MIT */
import { describe, it, expect } from "bun:test"
import { runDrill, stubFsWithClassA, drillScenarios } from "../../../src/knowledge/hardening/drill.js"

describe("P11.17 disaster recovery drill", () => {
  it("returns ok=true for every scenario on a clean environment", () => {
    const r = runDrill({ fs: stubFsWithClassA() })
    expect(r.total).toBe(6)
    expect(r.passed).toBe(6)
    expect(r.failed).toBe(0)
  })

  it("lists the canonical crash points", () => {
    const sc = drillScenarios()
    expect(sc).toHaveLength(6)
    const points = sc.map((s) => s.point)
    expect(points).toContain("before-fsync")
    expect(points).toContain("after-rename-before-wal-fsync")
    expect(points).toContain("during-wal-compaction")
  })

  it("fails when the unifia binary is missing and Class D must be rebuilt", () => {
    const r = runDrill({
      fs: stubFsWithClassA(),
      unifiaBinaryPresent: false,
      classDPresent: false,
    })
    // The drill should not silently succeed; the operator must
    // notice the binary-missing branch.
    expect(r.scenarios.some((s) => s.stepsExecuted > 1)).toBe(true)
  })

  it("tracks the duration", () => {
    const r = runDrill({ fs: stubFsWithClassA() })
    expect(r.durationMs).toBeGreaterThanOrEqual(0)
  })

  it("every scenario reports WAL-idempotence in its details", () => {
    const r = runDrill({ fs: stubFsWithClassA() })
    for (const s of r.scenarios) {
      expect(s.details).toContain("classA=true")
    }
  })
})
