import { test, expect, describe, mock } from "bun:test"

// Mock all the context providers so we can mount EditorPanel in isolation.
mock.module("@/context/editor", () => ({
  useEditor: () => ({
    state: { entries: {} },
    get: () => undefined,
    open: async () => ({ type: "none" }),
    setDirty: () => {},
    save: async (_path: string, content: string) => {
      // For the test, capture what save receives.
      ;(globalThis as any).__lastSaveContent = content
      return { type: "ok", content, stamp: { hash: "test-hash" }, formatted: false }
    },
    close: () => {},
  }),
}))

mock.module("@/context/file/store", () => {
  // Import the real module to get the actual createFileStore + setDraftGetter.
  // Bun mock.module needs a static export object, so we re-export the real one.
  const real = require("../file/store")
  return real
})

mock.module("@/context/language", () => ({
  useLanguage: () => ({
    t: (key: string) => key,
    locale: () => "en",
  }),
}))

mock.module("@/context/settings", () => ({
  useSettings: () => ({
    general: {
      autoSave: () => false,
      formatOnSave: () => false,
    },
  }),
}))

mock.module("@/context/editor/autosave", () => ({
  createAutosave: () => ({
    schedule: () => {},
    cancel: () => {},
    cancelAll: () => {},
  }),
}))

// CodeMirror is lazy — mock it with a component that exposes a controllable
// handle so we can simulate CM mount.
mock.module("@opencode-ai/ui/code-mirror", () => {
  return {
    CodeMirrorEditor: (props: any) => {
      // Solid doesn't let us expose a ref easily here. Skip for now.
      return null
    },
  }
})

import { createRoot, createSignal, Show, createEffect } from "solid-js"
import { render } from "solid-js/web"
import { createFileStore } from "../file/store"

// Simulate exactly what editor-panel.tsx does for the createEffect.
describe("EditorPanel reactivity — actual flow simulation", () => {
  test("createEffect re-runs on editorHandle change with the new handle", async () => {
    await new Promise<void>((resolve) => {
      createRoot((dispose) => {
        const fileStore = createFileStore()
        const [path] = createSignal<string | undefined>("a.ts")
        const [editorHandle, setEditorHandle] = createSignal<any>(undefined)

        createEffect(() => {
          const p = path()
          const h = editorHandle()
          if (!p) return
          fileStore.setDraftGetter(p, () => h?.getContent() ?? "")
          return () => {
            fileStore.setDraftGetter(p, undefined)
          }
        })

        // Microtask flush
        queueMicrotask(() => {
          // Step 1: initial run, h=undefined
          expect(fileStore.getDraftContent("a.ts")).toBe("")

          // Step 2: CM mounts → editorHandle updates
          const fakeHandle = {
            getContent: () => "CM_LIVE_CONTENT",
            setContent: (_: string) => {},
            focus: () => {},
            openSearch: () => {},
          }
          setEditorHandle(fakeHandle)

          // Microtask flush again — effect should re-run with new handle
          queueMicrotask(() => {
            const live = fileStore.getDraftContent("a.ts")
            console.log("[test] after setEditorHandle, getDraftContent returned:", live)
            expect(live).toBe("CM_LIVE_CONTENT")
            dispose()
            resolve()
          })
        })
      })
    })
  })
})
