/* SPDX-License-Identifier: MIT */
import { describe, it, expect } from "bun:test"
import {
  planRecovery,
  simulateRecovery,
  RECOVERY_STEPS_V1,
  type InMemoryFs,
} from "../../../src/knowledge/hardening/disaster-recovery.js"
import type { KnowledgeLocator } from "@unifia/contracts/knowledge"

function fsWithClassAAndB(): InMemoryFs {
  return {
    read(locator: KnowledgeLocator): string | null {
      if (locator === "memory/any.md") return "# hello"
      if (locator === "memory/any.md.unifia.json") return "{}"
      return null
    },
    exists(locator: KnowledgeLocator): boolean {
      return (
        locator === "memory/any.md" || locator === "memory/any.md.unifia.json"
      )
    },
  }
}

describe("P11.4 disaster recovery — plan", () => {
  it("lists 5 canonical recovery steps (append-only)", () => {
    expect(RECOVERY_STEPS_V1).toHaveLength(5)
  })

  it("detects no missing layer when everything is present", () => {
    const plan = planRecovery({
      classAReadable: true,
      classBReachable: true,
      classCPresent: true,
      classDPresent: true,
      unifiaBinaryPresent: true,
      networkAvailable: true,
    })
    expect(plan.missing).toEqual([])
    expect(plan.requiresNetwork).toBe(false)
  })

  it("detects missing class-c and class-d", () => {
    const plan = planRecovery({
      classAReadable: true,
      classBReachable: true,
      classCPresent: false,
      classDPresent: false,
      unifiaBinaryPresent: true,
      networkAvailable: true,
    })
    expect(plan.missing).toContain("class-c")
    expect(plan.missing).toContain("class-d")
  })

  it("stops immediately if class A is unreadable", () => {
    const plan = planRecovery({
      classAReadable: false,
      classBReachable: true,
      classCPresent: true,
      classDPresent: true,
      unifiaBinaryPresent: true,
      networkAvailable: true,
    })
    expect(plan.steps).toHaveLength(1)
    expect(plan.steps[0].kind).toBe("stop-and-ask-operator")
  })

  it("never requires network in V1", () => {
    const plan = planRecovery({
      classAReadable: true,
      classBReachable: true,
      classCPresent: false,
      classDPresent: false,
      unifiaBinaryPresent: true,
      networkAvailable: false,
    })
    expect(plan.requiresNetwork).toBe(false)
  })

  it("asks for the unifia binary if class c or d must be rebuilt and it is missing", () => {
    const plan = planRecovery({
      classAReadable: true,
      classBReachable: true,
      classCPresent: false,
      classDPresent: true,
      unifiaBinaryPresent: false,
      networkAvailable: true,
    })
    const stop = plan.steps.find((s) => s.kind === "stop-and-ask-operator")
    expect(stop).toBeDefined()
    expect(plan.requiresUnifiaBinary).toBe(true)
  })
})

describe("P11.4 disaster recovery — simulate", () => {
  it("returns ok=true on a clean environment", () => {
    const plan = planRecovery({
      classAReadable: true,
      classBReachable: true,
      classCPresent: true,
      classDPresent: true,
      unifiaBinaryPresent: true,
      networkAvailable: true,
    })
    const r = simulateRecovery(plan, fsWithClassAAndB())
    expect(r.ok).toBe(true)
    expect(r.classAStillReadable).toBe(true)
    expect(r.classBStillReachable).toBe(true)
    expect(r.failures).toEqual([])
  })

  it("returns ok=true when only class D must be rebuilt", () => {
    const plan = planRecovery({
      classAReadable: true,
      classBReachable: true,
      classCPresent: true,
      classDPresent: false,
      unifiaBinaryPresent: true,
      networkAvailable: true,
    })
    const r = simulateRecovery(plan, fsWithClassAAndB())
    expect(r.ok).toBe(true)
    expect(r.stepsExecuted).toBeGreaterThan(0)
  })

  it("stops at the operator ask when class A is unreadable", () => {
    const plan = planRecovery({
      classAReadable: false,
      classBReachable: true,
      classCPresent: true,
      classDPresent: true,
      unifiaBinaryPresent: true,
      networkAvailable: true,
    })
    const r = simulateRecovery(plan, fsWithClassAAndB())
    expect(r.stepsExecuted).toBe(1)
  })
})
