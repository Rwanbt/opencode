/* SPDX-License-Identifier: MIT */

import { describe, expect, test } from "bun:test"
import {
  addPendingSend,
  buildThreadRenderItems,
  extractMessageText,
  findRegenerateTarget,
  markPendingSendFailed,
  markPendingSendRetrying,
  removePendingSend,
  selectNextStepSuggestions,
  type NextStepSuggestion,
  type PendingSend,
  type ThreadMessage,
} from "@/pages/workbench/workbench-thread-shared"

describe("extractMessageText", () => {
  test("returns an empty string when the parts map is undefined", () => {
    expect(extractMessageText(undefined)).toBe("")
  })

  test("returns an empty string when no part is a text part", () => {
    expect(extractMessageText([{ type: "tool" }, { type: "snapshot" }])).toBe("")
  })

  test("concatenates text parts with a newline and trims the result", () => {
    const text = extractMessageText([
      { type: "text", text: "Bonjour" },
      { type: "text", text: "Comment ça va ?" },
    ])
    expect(text).toBe("Bonjour\nComment ça va ?")
  })

  test("ignores tool and snapshot parts interspersed with text parts", () => {
    const text = extractMessageText([
      { type: "text", text: "Étape 1" },
      { type: "tool", text: "{…}" },
      { type: "text", text: "Étape 2" },
    ])
    expect(text).toBe("Étape 1\nÉtape 2")
  })

  test("ignores text parts whose text is empty or missing", () => {
    const text = extractMessageText([
      { type: "text" },
      { type: "text", text: "" },
      { type: "text", text: "Gardée" },
    ])
    expect(text).toBe("Gardée")
  })
})

describe("selectNextStepSuggestions", () => {
  test("returns the work-mode list when mode is work", () => {
    const suggestions = selectNextStepSuggestions("work")
    expect(suggestions.length).toBeGreaterThan(0)
    for (const suggestion of suggestions) assertWellFormed(suggestion)
    // Each mode must surface at least one prompt that mentions the surface name.
    expect(suggestions.some((s) => s.prompt.toLowerCase().includes("espace de travail"))).toBe(true)
  })

  test("returns the design-mode list when mode is design", () => {
    const suggestions = selectNextStepSuggestions("design")
    expect(suggestions.length).toBeGreaterThan(0)
    for (const suggestion of suggestions) assertWellFormed(suggestion)
  })

  test("returns the automate-mode list when mode is automate", () => {
    const suggestions = selectNextStepSuggestions("automate")
    expect(suggestions.length).toBeGreaterThan(0)
    for (const suggestion of suggestions) assertWellFormed(suggestion)
  })

  test("every suggestion carries a unique id across the three mode lists", () => {
    const all: NextStepSuggestion[] = [
      ...selectNextStepSuggestions("work"),
      ...selectNextStepSuggestions("design"),
      ...selectNextStepSuggestions("automate"),
    ]
    const ids = all.map((s) => s.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  test("every suggestion prompt is non-empty and ends without trailing whitespace", () => {
    for (const mode of ["work", "design", "automate"] as const) {
      for (const suggestion of selectNextStepSuggestions(mode)) {
        expect(suggestion.prompt.length).toBeGreaterThan(0)
        expect(suggestion.prompt).toBe(suggestion.prompt.trim())
      }
    }
  })
})

describe("findRegenerateTarget", () => {
  const thread: ThreadMessage[] = [
    { id: "u1", role: "user", text: "Première question" },
    { id: "a1", role: "assistant", text: "Première réponse" },
    { id: "u2", role: "user", text: "Deuxième question" },
    { id: "a2", role: "assistant", text: "Deuxième réponse" },
  ]

  test("resolves the immediately preceding user message", () => {
    expect(findRegenerateTarget(thread, "a2")).toEqual({ userMessageId: "u2", userText: "Deuxième question" })
  })

  test("resolves correctly for an earlier assistant message too", () => {
    expect(findRegenerateTarget(thread, "a1")).toEqual({ userMessageId: "u1", userText: "Première question" })
  })

  test("returns undefined for an unknown message id", () => {
    expect(findRegenerateTarget(thread, "missing")).toBeUndefined()
  })

  test("returns undefined when the target id is a user message, not an assistant one", () => {
    expect(findRegenerateTarget(thread, "u2")).toBeUndefined()
  })

  test("returns undefined when the assistant message is first (no preceding user message)", () => {
    const orphan: ThreadMessage[] = [{ id: "a0", role: "assistant", text: "Bonjour" }]
    expect(findRegenerateTarget(orphan, "a0")).toBeUndefined()
  })

  test("skips over an intervening assistant message to find the nearest user message", () => {
    const malformed: ThreadMessage[] = [
      { id: "u1", role: "user", text: "Question" },
      { id: "a1", role: "assistant", text: "Réponse 1" },
      { id: "a2", role: "assistant", text: "Réponse 2" },
    ]
    expect(findRegenerateTarget(malformed, "a2")).toEqual({ userMessageId: "u1", userText: "Question" })
  })
})

describe("pending send lifecycle (10.2 retry-per-message)", () => {
  test("addPendingSend appends a new entry in the sending state", () => {
    const list = addPendingSend([], "p1", "Bonjour")
    expect(list).toEqual([{ id: "p1", text: "Bonjour", status: "sending" }])
  })

  test("addPendingSend does not disturb existing entries", () => {
    const start: PendingSend[] = [{ id: "p1", text: "Premier", status: "sending" }]
    const next = addPendingSend(start, "p2", "Second")
    expect(next).toEqual([
      { id: "p1", text: "Premier", status: "sending" },
      { id: "p2", text: "Second", status: "sending" },
    ])
  })

  test("markPendingSendFailed flips only the targeted entry", () => {
    const start: PendingSend[] = [
      { id: "p1", text: "Un", status: "sending" },
      { id: "p2", text: "Deux", status: "sending" },
    ]
    const next = markPendingSendFailed(start, "p1")
    expect(next).toEqual([
      { id: "p1", text: "Un", status: "failed" },
      { id: "p2", text: "Deux", status: "sending" },
    ])
  })

  test("two concurrent failures produce two independent failed entries", () => {
    const start: PendingSend[] = [
      { id: "p1", text: "Un", status: "sending" },
      { id: "p2", text: "Deux", status: "sending" },
    ]
    const next = markPendingSendFailed(markPendingSendFailed(start, "p1"), "p2")
    expect(next.every((p) => p.status === "failed")).toBe(true)
    expect(next.map((p) => p.id)).toEqual(["p1", "p2"])
  })

  test("markPendingSendFailed on an unknown id returns the list unchanged (same reference)", () => {
    const start: PendingSend[] = [{ id: "p1", text: "Un", status: "sending" }]
    expect(markPendingSendFailed(start, "missing")).toBe(start)
  })

  test("markPendingSendRetrying moves a failed entry back to sending", () => {
    const start: PendingSend[] = [{ id: "p1", text: "Un", status: "failed" }]
    expect(markPendingSendRetrying(start, "p1")).toEqual([{ id: "p1", text: "Un", status: "sending" }])
  })

  test("markPendingSendRetrying on an unknown id returns the list unchanged (same reference)", () => {
    const start: PendingSend[] = [{ id: "p1", text: "Un", status: "failed" }]
    expect(markPendingSendRetrying(start, "missing")).toBe(start)
  })

  test("removePendingSend drops the entry once the send succeeds", () => {
    const start: PendingSend[] = [
      { id: "p1", text: "Un", status: "sending" },
      { id: "p2", text: "Deux", status: "failed" },
    ]
    expect(removePendingSend(start, "p1")).toEqual([{ id: "p2", text: "Deux", status: "failed" }])
  })

  test("removePendingSend on an unknown id returns the list unchanged (same reference)", () => {
    const start: PendingSend[] = [{ id: "p1", text: "Un", status: "sending" }]
    expect(removePendingSend(start, "missing")).toBe(start)
  })
})

/**
 * Smoke-checks the shape of a `ThreadMessage`. The fields are mapped from
 * `sync.data.message[sessionId]` + `sync.data.part[messageId]` in
 * `WorkbenchThread`; the helper exists so the test surfaces a regression
 * in the contract without making `WorkbenchThread` itself runnable in a
 * unit test (it depends on the full app context tree).
 */
describe("ThreadMessage shape (contract)", () => {
  test("the fields the thread relies on are id, role and text", () => {
    const sample: ThreadMessage = {
      id: "msg-1",
      role: "assistant",
      text: "Bonjour",
    }
    expect(Object.keys(sample).sort()).toEqual(["id", "role", "text"])
  })
})

function pendingSend(overrides: Partial<PendingSend> = {}): PendingSend {
  return { id: "p-1", text: "sending", status: "sending", ...overrides }
}

describe("buildThreadRenderItems (10.6 — virtualized list flattening)", () => {
  test("empty messages and no pending sends produce an empty list (no next-step entry)", () => {
    expect(buildThreadRenderItems([], [])).toEqual([])
  })

  test("messages come first, in order", () => {
    const m1: ThreadMessage = { id: "m-1", role: "user", text: "a" }
    const m2: ThreadMessage = { id: "m-2", role: "assistant", text: "b" }
    const items = buildThreadRenderItems([m1, m2], [])
    expect(items[0]).toEqual({ kind: "message", message: m1 })
    expect(items[1]).toEqual({ kind: "message", message: m2 })
  })

  test("pending sends come after every message", () => {
    const m1: ThreadMessage = { id: "m-1", role: "user", text: "a" }
    const p1 = pendingSend({ id: "p-1" })
    const items = buildThreadRenderItems([m1], [p1])
    expect(items).toEqual([
      { kind: "message", message: m1 },
      { kind: "pending", pending: p1 },
      { kind: "next-step" },
    ])
  })

  test("a trailing next-step entry is appended when there is at least one real message", () => {
    const items = buildThreadRenderItems([{ id: "m-1", role: "user", text: "a" }], [])
    expect(items.at(-1)).toEqual({ kind: "next-step" })
  })

  test("no next-step entry when there are only pending sends and no synced messages yet", () => {
    const items = buildThreadRenderItems([], [pendingSend()])
    expect(items.some((i) => i.kind === "next-step")).toBe(false)
  })

  test("the next-step entry appears exactly once, after messages AND pending sends", () => {
    const items = buildThreadRenderItems(
      [
        { id: "m-1", role: "user", text: "a" },
        { id: "m-2", role: "assistant", text: "b" },
      ],
      [pendingSend({ id: "p-1" })],
    )
    expect(items).toHaveLength(4)
    expect(items[2]).toEqual({ kind: "pending", pending: pendingSend({ id: "p-1" }) })
    expect(items[3]).toEqual({ kind: "next-step" })
  })

  test("two independently-failed pending sends both appear, each with its own status", () => {
    const p1 = pendingSend({ id: "p-1", status: "failed" })
    const p2 = pendingSend({ id: "p-2", status: "failed" })
    const items = buildThreadRenderItems([{ id: "m-1", role: "user", text: "a" }], [p1, p2])
    const pendingItems = items.filter((i) => i.kind === "pending")
    expect(pendingItems).toEqual([
      { kind: "pending", pending: p1 },
      { kind: "pending", pending: p2 },
    ])
  })
})

function assertWellFormed(suggestion: NextStepSuggestion): void {
  expect(typeof suggestion.id).toBe("string")
  expect(suggestion.id.length).toBeGreaterThan(0)
  expect(typeof suggestion.label).toBe("string")
  expect(suggestion.label.length).toBeGreaterThan(0)
  expect(typeof suggestion.prompt).toBe("string")
  expect(suggestion.prompt.length).toBeGreaterThan(0)
}
