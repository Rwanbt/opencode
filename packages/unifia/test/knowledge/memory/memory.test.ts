/* SPDX-License-Identifier: MIT */
import { describe, it, expect } from "bun:test"
import {
  isTransitionAllowed,
  intentForTransition,
  transitionResult,
} from "../../../src/knowledge/memory/lifecycle.js"
import { decidePromotion } from "../../../src/knowledge/memory/promotion.js"
import { Inbox } from "../../../src/knowledge/memory/inbox.js"

const VALID_UUID = "0190d2c0-7b00-7000-8000-000000000001"

describe("lifecycle transitions", () => {
  it("allows candidate -> active", () => {
    expect(isTransitionAllowed("candidate", "active")).toBe(true)
  })
  it("allows active -> superseded", () => {
    expect(isTransitionAllowed("active", "superseded")).toBe(true)
  })
  it("allows active -> archived", () => {
    expect(isTransitionAllowed("active", "archived")).toBe(true)
  })
  it("allows archived -> active (restore)", () => {
    expect(isTransitionAllowed("archived", "active")).toBe(true)
  })
  it("forbids candidate -> superseded", () => {
    expect(isTransitionAllowed("candidate", "superseded")).toBe(false)
  })
  it("forbids archived -> candidate", () => {
    expect(isTransitionAllowed("archived", "candidate")).toBe(false)
  })
  it("forbids active -> candidate", () => {
    expect(isTransitionAllowed("active", "candidate")).toBe(false)
  })
})

describe("intentForTransition", () => {
  it("produces a promote intent for candidate -> active", () => {
    const r = intentForTransition("candidate", "active", VALID_UUID, "0".repeat(64), "ok", "test")
    expect(r.allowed).toBe(true)
    if (r.allowed) expect(r.intent.kind).toBe("promote")
  })
  it("produces an archive intent for active -> archived", () => {
    const r = intentForTransition("active", "archived", VALID_UUID, "0".repeat(64), "ok", "test")
    expect(r.allowed).toBe(true)
    if (r.allowed) expect(r.intent.kind).toBe("archive")
  })
  it("refuses an illegal transition", () => {
    const r = intentForTransition("candidate", "superseded", VALID_UUID, "0".repeat(64), "ok", "test")
    expect(r.allowed).toBe(false)
  })
})

describe("transitionResult", () => {
  it("records the new lifecycle and auditId", () => {
    const r = transitionResult("audit-1", "active")
    expect(r.applied).toBe(true)
    expect(r.newLifecycle).toBe("active")
    expect(r.auditId).toBe("audit-1")
  })
})

describe("decidePromotion", () => {
  it("auto-promotes a constraint", () => {
    const r = decidePromotion("constraint", "candidate", false, false)
    expect(r.autoActive).toBe(true)
  })
  it("auto-promotes a preference", () => {
    const r = decidePromotion("preference", "candidate", false, false)
    expect(r.autoActive).toBe(true)
  })
  it("auto-promotes a failure", () => {
    const r = decidePromotion("failure", "candidate", false, false)
    expect(r.autoActive).toBe(true)
  })
  it("does not auto-promote a semantic (low confidence)", () => {
    const r = decidePromotion("semantic", "candidate", false, false)
    expect(r.autoActive).toBe(false)
  })
  it("auto-promotes from an accepted ADR", () => {
    const r = decidePromotion("semantic", "candidate", false, true)
    expect(r.autoActive).toBe(true)
  })
  it("does nothing if already active", () => {
    const r = decidePromotion("constraint", "active", false, false)
    expect(r.autoActive).toBe(false)
  })
})

describe("Inbox", () => {
  it("starts empty", () => {
    const i = new Inbox()
    expect(i.count()).toBe(0)
    expect(i.all()).toEqual([])
  })

  it("pushes, queries by reason, and filters by confidence", () => {
    const i = new Inbox()
    i.push({ id: VALID_UUID, locator: "a.md", reason: "contradiction", detectedAt: "2026-08-29T00:00:00Z", confidence: 0.9 })
    i.push({ id: "0190d2c0-7b00-7000-8000-000000000002", locator: "b.md", reason: "low_confidence", detectedAt: "2026-08-29T00:00:00Z", confidence: 0.4 })
    expect(i.count()).toBe(2)
    expect(i.byReason("contradiction")).toHaveLength(1)
    expect(i.lowConfidence()).toHaveLength(1)
  })

  it("removes by id and clears", () => {
    const i = new Inbox()
    i.push({ id: VALID_UUID, locator: "a.md", reason: "merge_proposal", detectedAt: "2026-08-29T00:00:00Z", confidence: 0.8 })
    i.remove(VALID_UUID)
    expect(i.count()).toBe(0)
    i.clear()
  })
})
