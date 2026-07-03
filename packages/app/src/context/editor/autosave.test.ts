// FORK (Phase 3.2, PLAN-EDITEUR-IDE-DEFINITIF): autosave factory tests.
//
// Drives time deterministically via an injected manual clock — no wall-clock
// waits, no flake. Asserts:
//   • debounce window: 3 keystrokes within 1s → 1 save (not 3)
//   • status-gating: schedule is a no-op when status !== "dirty"
//   • status-gating at fire: a status flip between schedule and tick cancels
//   • conflict / missing / saving block the fire even if schedule happened
//   • cancel() between schedule and tick → no save
//   • cancelAll() wipes every pending timer
//   • enabled=false → no timer is armed (early return)

import { test, expect, describe } from "bun:test"
import { createAutosave, type AutosaveClock } from "./autosave"

type Status = "clean" | "dirty" | "saving" | "conflict" | "missing"
interface FakeDoc {
  status: Status
}

function fakeFs(initial: Record<string, FakeDoc> = {}) {
  const docs = new Map(Object.entries(initial))
  return {
    get: (p: string) => docs.get(p),
    set: (p: string, d: FakeDoc) => {
      docs.set(p, d)
    },
  }
}

interface FakeEditor {
  saves: Array<{ path: string; content: string }>
  save: (path: string, content: string) => Promise<unknown>
}

function fakeEditor(): FakeEditor {
  const editor: FakeEditor = {
    saves: [],
    async save(path, content) {
      editor.saves.push({ path, content })
      return { type: "none" }
    },
  }
  return editor
}

interface ManualClock extends AutosaveClock {
  pending: Map<unknown, () => void>
  tick: (ms: number) => void
}

function manualClock(): ManualClock {
  const pending = new Map<unknown, () => void>()
  let next = 1
  return {
    pending,
    setTimeout(fn, _ms) {
      const id = next++
      pending.set(id, fn)
      return id
    },
    clearTimeout(id) {
      pending.delete(id)
    },
    tick(_ms) {
      const fns = [...pending.values()]
      pending.clear()
      for (const fn of fns) fn()
    },
  }
}

describe("createAutosave — debounce + status gating", () => {
  test("3 keystrokes within 1s → exactly 1 save with the latest content", () => {
    const fs = fakeFs({ "a.ts": { status: "dirty" } })
    const editor = fakeEditor()
    const live: Record<string, string> = { "a.ts": "v1" }
    const clock = manualClock()
    const a = createAutosave({
      fileStore: fs,
      editor,
      contentFor: (p) => live[p] ?? "",
      enabled: () => true,
      delay: 1000,
      clock,
    })

    a.schedule("a.ts")
    live["a.ts"] = "v2"
    a.schedule("a.ts")
    live["a.ts"] = "v3"
    a.schedule("a.ts")

    expect(a.isPending("a.ts")).toBe(true)
    expect(editor.saves).toEqual([])
    expect(clock.pending.size).toBe(1) // schedule reset the timer each time

    clock.tick(1000)
    expect(editor.saves).toEqual([{ path: "a.ts", content: "v3" }])
    expect(a.isPending("a.ts")).toBe(false)
  })

  test("schedule is a no-op when status !== dirty", () => {
    const fs = fakeFs({ "a.ts": { status: "clean" } })
    const editor = fakeEditor()
    const clock = manualClock()
    const a = createAutosave({
      fileStore: fs,
      editor,
      contentFor: () => "x",
      enabled: () => true,
      clock,
    })
    a.schedule("a.ts")
    expect(a.isPending("a.ts")).toBe(false)
    clock.tick(1000)
    expect(editor.saves).toEqual([])
  })

  test("enabled=false → no timer armed", () => {
    const fs = fakeFs({ "a.ts": { status: "dirty" } })
    const editor = fakeEditor()
    const clock = manualClock()
    const a = createAutosave({
      fileStore: fs,
      editor,
      contentFor: () => "x",
      enabled: () => false,
      clock,
    })
    a.schedule("a.ts")
    expect(a.isPending("a.ts")).toBe(false)
    clock.tick(1000)
    expect(editor.saves).toEqual([])
  })

  test("status flips to saving between schedule and tick → save skipped", () => {
    const fs = fakeFs({ "a.ts": { status: "dirty" } })
    const editor = fakeEditor()
    const clock = manualClock()
    const a = createAutosave({
      fileStore: fs,
      editor,
      contentFor: () => "v",
      enabled: () => true,
      clock,
    })
    a.schedule("a.ts")
    fs.set("a.ts", { status: "saving" }) // user hit Ctrl+S mid-debounce
    clock.tick(1000)
    expect(editor.saves).toEqual([])
  })

  test("status flips to conflict between schedule and tick → save skipped", () => {
    const fs = fakeFs({ "a.ts": { status: "dirty" } })
    const editor = fakeEditor()
    const clock = manualClock()
    const a = createAutosave({
      fileStore: fs,
      editor,
      contentFor: () => "v",
      enabled: () => true,
      clock,
    })
    a.schedule("a.ts")
    fs.set("a.ts", { status: "conflict" })
    clock.tick(1000)
    expect(editor.saves).toEqual([])
  })

  test("status flips to missing between schedule and tick → save skipped", () => {
    const fs = fakeFs({ "a.ts": { status: "dirty" } })
    const editor = fakeEditor()
    const clock = manualClock()
    const a = createAutosave({
      fileStore: fs,
      editor,
      contentFor: () => "v",
      enabled: () => true,
      clock,
    })
    a.schedule("a.ts")
    fs.set("a.ts", { status: "missing" })
    clock.tick(1000)
    expect(editor.saves).toEqual([])
  })

  test("cancel between schedule and tick → no save", () => {
    const fs = fakeFs({ "a.ts": { status: "dirty" } })
    const editor = fakeEditor()
    const clock = manualClock()
    const a = createAutosave({
      fileStore: fs,
      editor,
      contentFor: () => "v",
      enabled: () => true,
      clock,
    })
    a.schedule("a.ts")
    a.cancel("a.ts")
    clock.tick(1000)
    expect(editor.saves).toEqual([])
    expect(a.isPending("a.ts")).toBe(false)
  })

  test("cancelAll wipes every pending timer", () => {
    const fs = fakeFs({
      "a.ts": { status: "dirty" },
      "b.ts": { status: "dirty" },
    })
    const editor = fakeEditor()
    const clock = manualClock()
    const a = createAutosave({
      fileStore: fs,
      editor,
      contentFor: () => "v",
      enabled: () => true,
      clock,
    })
    a.schedule("a.ts")
    a.schedule("b.ts")
    expect(a.isPending("a.ts")).toBe(true)
    expect(a.isPending("b.ts")).toBe(true)
    a.cancelAll()
    expect(a.isPending("a.ts")).toBe(false)
    expect(a.isPending("b.ts")).toBe(false)
    clock.tick(1000)
    expect(editor.saves).toEqual([])
  })

  test("schedule for unknown path (no FileStore doc) → no save", () => {
    const fs = fakeFs({})
    const editor = fakeEditor()
    const clock = manualClock()
    const a = createAutosave({
      fileStore: fs,
      editor,
      contentFor: () => "v",
      enabled: () => true,
      clock,
    })
    a.schedule("a.ts")
    clock.tick(1000)
    expect(editor.saves).toEqual([])
  })

  test("schedule twice in a row resets to a single timer (debounce semantics)", () => {
    const fs = fakeFs({ "a.ts": { status: "dirty" } })
    const editor = fakeEditor()
    const clock = manualClock()
    const a = createAutosave({
      fileStore: fs,
      editor,
      contentFor: () => "v",
      enabled: () => true,
      clock,
    })
    a.schedule("a.ts")
    a.schedule("a.ts")
    expect(clock.pending.size).toBe(1) // first schedule was cancelled by the second
    clock.tick(1000)
    expect(editor.saves).toEqual([{ path: "a.ts", content: "v" }])
  })
})