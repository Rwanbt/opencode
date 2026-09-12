/* SPDX-License-Identifier: MIT */

import { describe, expect, test } from "bun:test"
import type { DesignComment } from "@unifia/workbench-shell"
import { partitionAttachedComments, toggleAttachedCommentId } from "@/pages/workbench/thread-comment-attach"

function comment(overrides: Partial<DesignComment> = {}): DesignComment {
  return {
    id: "c-1",
    artifactId: "a-1",
    elementId: "el-1",
    note: "note",
    status: "open",
    createdAt: "2026-08-21T10:00:00.000Z",
    ...overrides,
  }
}

describe("partitionAttachedComments", () => {
  test("an empty attachedIds set puts every comment in saved", () => {
    const comments = [comment({ id: "c-1" }), comment({ id: "c-2" })]
    const { attached, saved } = partitionAttachedComments(comments, new Set())
    expect(attached).toEqual([])
    expect(saved).toEqual(comments)
  })

  test("a comment whose id is in attachedIds goes to attached", () => {
    const c1 = comment({ id: "c-1" })
    const c2 = comment({ id: "c-2" })
    const { attached, saved } = partitionAttachedComments([c1, c2], new Set(["c-1"]))
    expect(attached).toEqual([c1])
    expect(saved).toEqual([c2])
  })

  test("order within each group is preserved from the input", () => {
    const c1 = comment({ id: "c-1" })
    const c2 = comment({ id: "c-2" })
    const c3 = comment({ id: "c-3" })
    const { attached, saved } = partitionAttachedComments([c1, c2, c3], new Set(["c-1", "c-3"]))
    expect(attached.map((c) => c.id)).toEqual(["c-1", "c-3"])
    expect(saved.map((c) => c.id)).toEqual(["c-2"])
  })

  test("attached comments can span different statuses and artifacts", () => {
    const c1 = comment({ id: "c-1", artifactId: "a-1", status: "sent" })
    const c2 = comment({ id: "c-2", artifactId: "a-2", status: "resolved" })
    const { attached } = partitionAttachedComments([c1, c2], new Set(["c-1", "c-2"]))
    expect(attached).toEqual([c1, c2])
  })

  test("an empty comment list produces two empty groups", () => {
    const { attached, saved } = partitionAttachedComments([], new Set(["missing"]))
    expect(attached).toEqual([])
    expect(saved).toEqual([])
  })
})

describe("toggleAttachedCommentId", () => {
  test("adds an id that isn't in the set", () => {
    const next = toggleAttachedCommentId(new Set(), "c-1")
    expect(next.has("c-1")).toBe(true)
  })

  test("removes an id that is already in the set", () => {
    const next = toggleAttachedCommentId(new Set(["c-1"]), "c-1")
    expect(next.has("c-1")).toBe(false)
  })

  test("does not disturb other ids already in the set", () => {
    const next = toggleAttachedCommentId(new Set(["c-1", "c-2"]), "c-1")
    expect(next.has("c-1")).toBe(false)
    expect(next.has("c-2")).toBe(true)
  })

  test("never mutates the input set", () => {
    const original = new Set(["c-1"])
    toggleAttachedCommentId(original, "c-2")
    expect(original.has("c-2")).toBe(false)
    expect(original.size).toBe(1)
  })

  test("always returns a new Set instance", () => {
    const original = new Set(["c-1"])
    const next = toggleAttachedCommentId(original, "c-1")
    expect(next).not.toBe(original)
  })
})
