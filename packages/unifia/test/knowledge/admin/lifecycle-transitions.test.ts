/* SPDX-License-Identifier: MIT */
import { describe, it, expect } from "bun:test"
import {
  buildTransitionMatrix,
  isTransitionAllowed,
  getAllowedTransitions,
  getV1Lifecycles,
  formatTransitionMatrix,
} from "../../../src/knowledge/admin/lifecycle-transitions.js"

describe("P11.51 lifecycle transitions matrix", () => {
  it("returns the V1 lifecycle set", () => {
    const lcs = getV1Lifecycles()
    expect(lcs.length).toBe(4)
    expect(lcs).toContain("candidate")
    expect(lcs).toContain("active")
    expect(lcs).toContain("superseded")
    expect(lcs).toContain("archived")
  })

  it("builds a 4x4 matrix with true/false for every pair", () => {
    const m = buildTransitionMatrix()
    const lcs = getV1Lifecycles()
    for (const from of lcs) {
      for (const to of lcs) {
        expect(typeof m[from][to]).toBe("boolean")
      }
    }
  })

  it("allows the documented transitions", () => {
    expect(isTransitionAllowed("candidate", "active")).toBe(true)
    expect(isTransitionAllowed("active", "superseded")).toBe(true)
    expect(isTransitionAllowed("archived", "active")).toBe(true)
  })

  it("rejects forbidden transitions", () => {
    expect(isTransitionAllowed("candidate", "superseded")).toBe(false)
    expect(isTransitionAllowed("active", "candidate")).toBe(false)
    expect(isTransitionAllowed("archived", "candidate")).toBe(false)
    // ADR-KNOW-0009 restores from `archived`, never from `superseded`.
    expect(isTransitionAllowed("superseded", "active")).toBe(false)
  })

  it("getAllowedTransitions returns the right successors", () => {
    expect(getAllowedTransitions("candidate")).toEqual(["active", "archived"])
    expect(getAllowedTransitions("active")).toEqual(["superseded", "archived"])
    expect(getAllowedTransitions("superseded")).toEqual(["archived"])
    expect(getAllowedTransitions("archived")).toEqual(["active"])
  })

  it("formats the matrix as ASCII", () => {
    const m = buildTransitionMatrix()
    const s = formatTransitionMatrix(m)
    expect(s).toContain("candidate")
    expect(s).toContain("active")
    expect(s).toContain("superseded")
    expect(s).toContain("archived")
    expect(s).toContain("OK")
  })
})
