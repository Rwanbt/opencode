import { test, expect, describe } from "bun:test"
import { createFileStore } from "../file/store"
import type { CodeMirrorHandle } from "@opencode-ai/ui/code-mirror"

// FORK (round 3, PLAN-FIX-CLOSE-GUARD-SAVE): the close-guard reads the live
// CM buffer through the draft-getter that editor-panel.tsx registers on
// FileStore:
//
//   fileStore.setDraftGetter(p, () => h?.getContent() ?? "")
//   onCleanup(() => fileStore.setDraftGetter(p, undefined))
//
// This file verifies the STORE CONTRACT that wiring depends on: the getter
// closure reads fresh handle content, resolves "" for a missing handle, and
// is cleanly unregistered. It does NOT drive Solid's createEffect: the app
// unit suite runs without `--conditions=browser`, so `solid-js` resolves to
// its server build where effects are no-ops (a createEffect-based test hangs
// forever — the assertion throws inside a never-flushed microtask). The
// reactive re-run of the effect on `props.editorHandle` change is a Solid
// framework guarantee and is exercised end-to-end in the Playwright editor
// specs where the real component mounts in Chromium.

function makeFakeHandle(initial: string): CodeMirrorHandle {
  let doc = initial
  return {
    focus: () => {},
    openSearch: () => {},
    getContent: () => doc,
    setContent: (content: string) => {
      doc = content
    },
  } as CodeMirrorHandle
}

// Mirror of the getter editor-panel.tsx registers, so the contract under test
// is the exact production closure shape.
const draftGetterFor = (handle: () => CodeMirrorHandle | undefined) => () => handle()?.getContent() ?? ""

describe("FileStore draft-getter contract (close-guard live content)", () => {
  test("getter reads freshest CM content, including edits after registration", () => {
    const fileStore = createFileStore()
    const handle = makeFakeHandle("USER_LIVE_EDITS")

    fileStore.setDraftGetter("a.ts", draftGetterFor(() => handle))
    expect(fileStore.getDraftContent("a.ts")).toBe("USER_LIVE_EDITS")

    // User keeps typing — the closure reads the live doc, never a stale copy.
    handle.setContent("USER_LIVE_EDITS_v2")
    expect(fileStore.getDraftContent("a.ts")).toBe("USER_LIVE_EDITS_v2")
  })

  test("getter resolves to empty string when the handle is missing", () => {
    const fileStore = createFileStore()
    // Handle never mounts (CM not ready): getter must fall back to "" so the
    // close-guard drops to the FileStore baseline rather than writing null.
    fileStore.setDraftGetter("a.ts", draftGetterFor(() => undefined))
    expect(fileStore.getDraftContent("a.ts")).toBe("")
  })

  test("setDraftGetter(path, undefined) unregisters — the onCleanup path", () => {
    const fileStore = createFileStore()
    const handle = makeFakeHandle("A_LIVE")

    fileStore.setDraftGetter("a.ts", draftGetterFor(() => handle))
    expect(fileStore.getDraftContent("a.ts")).toBe("A_LIVE")

    // What onCleanup runs on tab switch / dispose. Without it, stale getters
    // accumulate and the close-guard reads a handle that now shows another file.
    fileStore.setDraftGetter("a.ts", undefined)
    expect(fileStore.getDraftContent("a.ts")).toBeUndefined()
  })

  test("switching tabs leaves only the current path's getter registered", () => {
    const fileStore = createFileStore()
    const handleA = makeFakeHandle("A_LIVE")
    const handleB = makeFakeHandle("B_LIVE")

    // Tab A mounts.
    fileStore.setDraftGetter("a.ts", draftGetterFor(() => handleA))
    // Switch to tab B: the effect's onCleanup unregisters A, then re-registers
    // for B. Simulate that exact ordering.
    fileStore.setDraftGetter("a.ts", undefined)
    fileStore.setDraftGetter("b.ts", draftGetterFor(() => handleB))

    expect(fileStore.getDraftContent("a.ts")).toBeUndefined()
    expect(fileStore.getDraftContent("b.ts")).toBe("B_LIVE")
  })

  test("remove(path) also drops the draft getter", () => {
    const fileStore = createFileStore()
    const handle = makeFakeHandle("A_LIVE")

    fileStore.setDraftGetter("a.ts", draftGetterFor(() => handle))
    expect(fileStore.getDraftContent("a.ts")).toBe("A_LIVE")

    fileStore.remove("a.ts")
    expect(fileStore.getDraftContent("a.ts")).toBeUndefined()
  })
})
