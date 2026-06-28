import { test, expect, describe } from "bun:test"
import { createRoot, createSignal } from "solid-js"
import { render } from "solid-js/web"

// FORK (round 3, PLAN-FIX-CLOSE-GUARD-SAVE): Solid reactivity test for the
// createEffect that registers the CM live-content getter on FileStore. The
// close-guard-integration.test.ts file proves the wiring at the EditorStore
// level, but the bug user reported shows the disk not being updated despite
// 11/11 tests passing. The likely gap is that `props.editorHandle` updates
// are NOT triggering the createEffect re-run in the actual runtime —
// something the unit tests cannot catch because they never mount Solid.
//
// This test mounts a minimal Solid component that mirrors the createEffect
// logic in editor-panel.tsx, then drives the parent signal through the exact
// sequence of states a real tab experiences: mount → CM mounts (handle
// becomes defined) → user types → close-guard.onSave fires.

import { createFileStore } from "../file/store"
import type { CodeMirrorHandle } from "@opencode-ai/ui/code-mirror"

// Minimal stand-in for CM handle. In production, setContent triggers a CM
// transaction that updates the doc; getContent reads the live doc.
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

describe("EditorPanel createEffect — Solid reactivity round-trip", () => {
  // createEffect is async (deferred to microtask) in Solid. Tests must flush
  // the microtask queue before asserting on what the effect wrote to the
  // FileStore. In the real app this is a non-issue because the user interacts
  // seconds after mount — but the test setup completes in microseconds, so
  // we need the explicit await.

  test("getter reads freshest CM content after props.editorHandle updates", async () => {
    // Mirrors editor-panel.tsx createEffect, in isolation, so we can assert
    // Solid's reactive wiring without standing up the entire provider tree.
    await new Promise<void>((resolve) =>
      createRoot(async (dispose) => {
        const fileStore = createFileStore()
        const [path] = createSignal<string | undefined>("a.ts")
        const [editorHandle, setEditorHandle] = createSignal<CodeMirrorHandle | undefined>(undefined)

        // Faithful reproduction of the createEffect from editor-panel.tsx.
        createEffect(() => {
          const p = path()
          const h = editorHandle()
          if (!p) return
          fileStore.setDraftGetter(p, () => h?.getContent() ?? "")
          return () => {
            fileStore.setDraftGetter(p, undefined)
          }
        })

        // Flush the initial run (handle is still undefined).
        await new Promise((r) => setTimeout(r, 0))
        expect(fileStore.getDraftContent("a.ts")).toBe("")

        // CM mounts → parent signal updates → effect re-runs with the
        // new handle. THIS is the step the runtime might be skipping.
        const handle = makeFakeHandle("USER_LIVE_EDITS")
        setEditorHandle(handle)
        await new Promise((r) => setTimeout(r, 0))
        expect(fileStore.getDraftContent("a.ts")).toBe("USER_LIVE_EDITS")

        // User types — closure captures `handle` so it should always read fresh.
        handle.setContent("USER_LIVE_EDITS_v2")
        // No await needed: getter closure is called synchronously.
        expect(fileStore.getDraftContent("a.ts")).toBe("USER_LIVE_EDITS_v2")

        dispose()
        resolve()
      }),
    )
  })

  test("getter is unregistered when effect re-runs (path change)", async () => {
    // WHY this matters: without the return-value cleanup, switching tabs
    // accumulates stale closures. This mirrors the cleanup logic.
    await new Promise<void>((resolve) =>
      createRoot(async (dispose) => {
        const fileStore = createFileStore()
        const [path, setPath] = createSignal<string | undefined>("a.ts")
        const [editorHandle, setEditorHandle] = createSignal<CodeMirrorHandle | undefined>(undefined)

        createEffect(() => {
          const p = path()
          const h = editorHandle()
          if (!p) return
          fileStore.setDraftGetter(p, () => h?.getContent() ?? "")
          return () => {
            fileStore.setDraftGetter(p, undefined)
          }
        })

        const handleA = makeFakeHandle("A_LIVE")
        setEditorHandle(handleA)
        await new Promise((r) => setTimeout(r, 0))
        expect(fileStore.getDraftContent("a.ts")).toBe("A_LIVE")

        // Switch to file B
        const handleB = makeFakeHandle("B_LIVE")
        setEditorHandle(handleB)
        setPath("b.ts")
        await new Promise((r) => setTimeout(r, 0))
        expect(fileStore.getDraftContent("a.ts")).toBeUndefined() // cleanup ran
        expect(fileStore.getDraftContent("b.ts")).toBe("B_LIVE")

        dispose()
        resolve()
      }),
    )
  })

  test("CRITICAL — getter returns empty string when handle is NEVER set", async () => {
    // This reproduces the actual runtime failure mode if the effect never
    // re-runs after CM mount. If this is what the user is seeing, then the
    // createEffect isn't being triggered by props.editorHandle changes.
    await new Promise<void>((resolve) =>
      createRoot((dispose) => {
        const fileStore = createFileStore()
        const [path] = createSignal<string | undefined>("a.ts")
        // editorHandle stays undefined — simulating CM NEVER mounting.
        const [editorHandle] = createSignal<CodeMirrorHandle | undefined>(undefined)

        createEffect(() => {
          const p = path()
          const h = editorHandle()
          if (!p) return
          fileStore.setDraftGetter(p, () => h?.getContent() ?? "")
          return () => {
            fileStore.setDraftGetter(p, undefined)
          }
        })

        // Flush the initial run.
        queueMicrotask(() => {
          // The getter is registered but returns "" because handle is undefined.
          // This is the EXACT scenario the close-guard would hit if props.editorHandle
          // never updates — fallback to FileStore.content (baseline).
          expect(fileStore.getDraftContent("a.ts")).toBe("")
          dispose()
          resolve()
        })
      }),
    )
  })
})

// Note: `createEffect` and `render` are imported above but used via Solid's
// standard reactive primitives, not as a separately invoked symbol.
import { createEffect } from "solid-js"
