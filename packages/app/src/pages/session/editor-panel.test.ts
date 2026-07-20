import { test, expect, describe } from "bun:test"
import { createFileStore } from "@/context/file/store"
import { createEditorStore, type DocEffect, type EditorDeps, type WriteResult } from "@/context/editor/store"
import { runSaveAction } from "@/context/editor/save-action"

// FORK (AutoExit-Edit-On-Save 2026-06-29, PLAN-EDITEUR-IDE-AUTOEXIT-EDIT-ON-SAVE):
// Behavioral tests for the new `props.setEditing(false)` calls in
// editor-panel.tsx (Fix A on handleCtrlS, Fix B on handleOverwrite).
//
// FORK (CORRECTIF F11, 2026-07-19): these helpers used to hand-copy the
// busy/conflict/missing/error/success branching from editor-panel.tsx's
// handlers — a real fix to one of the branches (F1, F3) had to land twice,
// once in the component and once here, with nothing enforcing the copy
// stayed in sync (see the old REVIEW's M4). They now call runSaveAction()
// (save-action.ts), the SAME function editor-panel.tsx's handlers call —
// only the component-specific wiring (which callback maps to which side
// effect: setEditing, onSave/onOverwrite/onRecreate, toasts) remains here.
// A regression in the shared branching now fails every test that exercises
// it, in both handleCtrlS and handleOverwrite/handleRecreate at once.

const hash = (s: string) => `h:${s.length}:${s}`

// FORK (PLAN-READONLY-VIEWER-REACTIVITY C11): waits for an in-flight save to
// release the path. Mirrors editor-panel.tsx's waitForSaveSlot, with a much
// shorter poll interval so tests don't sleep 50ms per tick.
async function waitForSaveSlot(editor: ReturnType<typeof createEditorStore>, filePath: string, maxWaitMs = 2000) {
  const start = Date.now()
  while (editor.get(filePath)?.saving) {
    if (Date.now() - start > maxWaitMs) return false
    await new Promise((resolve) => setTimeout(resolve, 2))
  }
  return true
}

async function runHandleCtrlS(
  opts: {
    filePath: string
    editor: ReturnType<typeof createEditorStore>
    content: string
    setEditingLog: (boolean | undefined)[]
    onSave: (content?: string) => Promise<void>
    toasts: Array<{ variant: string; title: string }>
  },
  retriesLeft = 2,
): Promise<{ eff: DocEffect; onSaveCalls: number }> {
  const { filePath, editor, content, setEditingLog, onSave, toasts } = opts
  let onSaveCalls = 0
  const eff = await runSaveAction({
    path: filePath,
    getContent: () => content,
    // settings.general.formatOnSave() — irrelevant here, we don't assert on it.
    attempt: (path, c) => editor.save(path, c, false),
    applyDocEffect: () => {}, // no-op when eff.type !== "set" — skipped in this fixture
    onNonSuccess: (eff) => {
      if (eff.type === "error") toasts.push({ variant: "error", title: "toast.file.saveFailed" })
    },
    onSuccess: async (finalContent, _sentContent, effect) => {
      if (effect.type !== "unchanged") {
        await onSave(finalContent)
        onSaveCalls = 1
      }
      toasts.push({ variant: "success", title: "toast.file.saved" })
      setEditingLog.push(false)
    },
    retry: { waitForSlot: (p) => waitForSaveSlot(editor, p), retriesLeft },
  })
  return { eff, onSaveCalls }
}

async function runHandleOverwrite(opts: {
  filePath: string
  editor: ReturnType<typeof createEditorStore>
  content: string
  setEditingLog: (boolean | undefined)[]
  onOverwrite: (content?: string) => Promise<void>
  toasts: Array<{ variant: string; title: string }>
}): Promise<{ eff: DocEffect; onOverwriteCalls: number }> {
  const { filePath, editor, content, setEditingLog, onOverwrite, toasts } = opts
  let onOverwriteCalls = 0
  const eff = await runSaveAction({
    path: filePath,
    getContent: () => content,
    attempt: (path, c) => editor.resolveConflict(path, c, "overwrite"),
    applyDocEffect: () => {},
    onNonSuccess: (eff) => {
      if (eff.type === "error") toasts.push({ variant: "error", title: "toast.file.saveFailed" })
    },
    onSuccess: async (finalContent) => {
      await onOverwrite(finalContent)
      setEditingLog.push(false)
      onOverwriteCalls = 1
    },
    // No `retry`: handleOverwrite does not retry on busy, unlike handleCtrlS.
  })
  return { eff, onOverwriteCalls }
}

async function runHandleRecreate(opts: {
  filePath: string
  editor: ReturnType<typeof createEditorStore>
  content: string
  onRecreate: (content?: string) => Promise<void>
  toasts: Array<{ variant: string; title: string }>
}): Promise<{ eff: DocEffect; onRecreateCalls: number }> {
  const { filePath, editor, content, onRecreate, toasts } = opts
  let onRecreateCalls = 0
  const eff = await runSaveAction({
    path: filePath,
    getContent: () => content,
    attempt: (path, c) => editor.recreate(path, c, false),
    applyDocEffect: () => {},
    onNonSuccess: (eff) => {
      if (eff.type === "error") toasts.push({ variant: "error", title: "toast.file.saveFailed" })
    },
    onSuccess: async (finalContent) => {
      await onRecreate(finalContent)
      onRecreateCalls = 1
    },
    // No `retry`, and no setEditing(false) on success — handleRecreate
    // never exits edit mode, unlike handleCtrlS/handleOverwrite.
  })
  return { eff, onRecreateCalls }
}

// Fake deps — same shape as close-guard-integration.test.ts. The `disk` map
// is mutable so we can simulate external changes between open() and save().
function fakeDeps(initial: Record<string, string> = {}): {
  deps: EditorDeps
  disk: Map<string, string>
} {
  const disk = new Map<string, string>(Object.entries(initial))
  const deps: EditorDeps = {
    async readRaw(p) {
      if (!disk.has(p)) return { type: "not-found" }
      const content = disk.get(p)!
      return { type: "ok", content, stamp: { hash: hash(content) } }
    },
    async write({ path: p, content, expectedHash }): Promise<WriteResult> {
      const exists = disk.has(p)
      if (exists && expectedHash !== undefined && hash(disk.get(p)!) !== expectedHash) {
        return { type: "conflict" }
      }
      disk.set(p, content)
      return { type: "ok", content, stamp: { hash: hash(content) }, formatted: false }
    },
  }
  return { deps, disk }
}

describe("EditorPanel.handleCtrlS — auto-exit edit mode (Fix A)", () => {
  test("C.1 success path: save OK → setEditing(false) called exactly once", async () => {
    // File exists on disk with v1. CM handle returns v2 (live edits).
    const { deps, disk } = fakeDeps({ "a.ts": "v1-baseline" })
    const fileStore = createFileStore()
    const editor = createEditorStore({ ...deps, fileStore })

    await editor.open("a.ts")
    editor.setDirty("a.ts", true)

    const setEditingLog: (boolean | undefined)[] = []
    const toasts: Array<{ variant: string; title: string }> = []
    const onSave = async () => {}

    const result = await runHandleCtrlS({
      filePath: "a.ts",
      editor,
      content: "v2-live-edits",
      setEditingLog,
      onSave,
      toasts,
    })

    // Disk has live content.
    expect(disk.get("a.ts")).toBe("v2-live-edits")
    // The Fix A line fired exactly once with false.
    expect(setEditingLog).toEqual([false])
    // onSave (fileStore refresh) was awaited BEFORE the exit — order matters.
    expect(result.onSaveCalls).toBe(1)
    // Success toast fired.
    expect(toasts).toEqual([{ variant: "success", title: "toast.file.saved" }])
    // Eff is none (success).
    expect(result.eff.type).toBe("none")
  })

  test("C.2 conflict path: save conflict → setEditing NOT called, banner stays", async () => {
    // Disk starts as v1-baseline. After open(), entry.baseline = v1, hash(v1).
    // Then disk mutates externally to v3 (hash(v3) ≠ hash(v1)). save() sends
    // expectedHash=hash(v1); write() detects mismatch → returns conflict.
    const { deps, disk } = fakeDeps({ "a.ts": "v1-baseline" })
    const fileStore = createFileStore()
    const editor = createEditorStore({ ...deps, fileStore })

    await editor.open("a.ts")
    editor.setDirty("a.ts", true)
    disk.set("a.ts", "v3-external-change") // simulate external modification

    const setEditingLog: (boolean | undefined)[] = []
    const toasts: Array<{ variant: string; title: string }> = []
    const onSave = async () => {
      throw new Error("onSave should NOT be called on conflict")
    }

    const result = await runHandleCtrlS({
      filePath: "a.ts",
      editor,
      content: "v2-live-edits",
      setEditingLog,
      onSave,
      toasts,
    })

    // Disk unchanged (write rejected with 409).
    expect(disk.get("a.ts")).toBe("v3-external-change")
    // The Fix A line did NOT fire — user must resolve the conflict manually.
    expect(setEditingLog).toEqual([])
    // No toast (conflict has its own banner via EditorBanner).
    expect(toasts).toEqual([])
    expect(result.onSaveCalls).toBe(0)
    expect(result.eff.type).toBe("conflict")
  })

  test("C.3 error path: backend error → setEditing NOT called, error toast fired", async () => {
    // Disk has v1. write() returns "error" (simulate a 500).
    const disk = new Map<string, string>([["a.ts", "v1-baseline"]])
    const deps: EditorDeps = {
      async readRaw(p) {
        return { type: "ok", content: disk.get(p)!, stamp: { hash: hash(disk.get(p)!) } }
      },
      async write(): Promise<WriteResult> {
        return { type: "error" }
      },
    }
    const fileStore = createFileStore()
    const editor = createEditorStore({ ...deps, fileStore })

    await editor.open("a.ts")
    editor.setDirty("a.ts", true)

    const setEditingLog: (boolean | undefined)[] = []
    const toasts: Array<{ variant: string; title: string }> = []
    const onSave = async () => {
      throw new Error("onSave should NOT be called on error")
    }

    const result = await runHandleCtrlS({
      filePath: "a.ts",
      editor,
      content: "v2-live-edits",
      setEditingLog,
      onSave,
      toasts,
    })

    // The Fix A line did NOT fire on error — user must retry.
    expect(setEditingLog).toEqual([])
    // Error toast fired.
    expect(toasts).toEqual([{ variant: "error", title: "toast.file.saveFailed" }])
    expect(result.onSaveCalls).toBe(0)
    expect(result.eff.type).toBe("error")
  })

  test("C.1b clean file: exits edit mode without writing or refreshing the viewer", async () => {
    let writeCalls = 0
    const { deps } = fakeDeps({ "a.ts": "v1-baseline" })
    const fileStore = createFileStore()
    const editor = createEditorStore({
      ...deps,
      fileStore,
      async write(input) {
        writeCalls += 1
        return deps.write(input)
      },
    })

    await editor.open("a.ts")
    // NOT calling setDirty — file is clean.

    const setEditingLog: (boolean | undefined)[] = []
    const toasts: Array<{ variant: string; title: string }> = []
    const onSave = async () => {}

    const result = await runHandleCtrlS({
      filePath: "a.ts",
      editor,
      content: "v1-baseline",
      setEditingLog,
      onSave,
      toasts,
    })

    expect(setEditingLog).toEqual([false])
    expect(result.eff).toEqual({ type: "unchanged", content: "v1-baseline" })
    expect(result.onSaveCalls).toBe(0)
    expect(writeCalls).toBe(0)
  })

  test("C.4 missing path: file deleted on disk → setEditing NOT called, banner recreate", async () => {
    // Disk has v1-baseline. After open(), entry exists. Then file is deleted
    // from disk → readRaw returns not-found, but our save() uses write which
    // only sees the delete as "exists=false" — no conflict. We simulate the
    // missing case differently: make write() return not-found.
    const disk = new Map<string, string>([["a.ts", "v1-baseline"]])
    const deps: EditorDeps = {
      async readRaw(p) {
        return { type: "ok", content: disk.get(p)!, stamp: { hash: hash(disk.get(p)!) } }
      },
      async write(): Promise<WriteResult> {
        return { type: "not-found" }
      },
    }
    const fileStore = createFileStore()
    const editor = createEditorStore({ ...deps, fileStore })

    await editor.open("a.ts")
    editor.setDirty("a.ts", true)

    const setEditingLog: (boolean | undefined)[] = []
    const toasts: Array<{ variant: string; title: string }> = []
    const onSave = async () => {
      throw new Error("onSave should NOT be called on missing")
    }

    const result = await runHandleCtrlS({
      filePath: "a.ts",
      editor,
      content: "v2-live-edits",
      setEditingLog,
      onSave,
      toasts,
    })

    // The Fix A line did NOT fire on missing — user must Recreate or Discard.
    expect(setEditingLog).toEqual([])
    expect(toasts).toEqual([])
    expect(result.eff.type).toBe("missing")
  })
})

describe("EditorPanel.handleOverwrite — auto-exit edit mode (Fix B)", () => {
  test("C.5 success path: overwrite OK → setEditing(false) called", async () => {
    // Conflict scenario: disk v1 at open, mutated to v3 before user clicks
    // "Overwrite disk". resolveConflict(overwrite) reads v3, updates baseline
    // to v3, then saves v2 with expectedHash=hash(v3) → write matches → OK.
    const { deps, disk } = fakeDeps({ "a.ts": "v1-baseline" })
    const fileStore = createFileStore()
    const editor = createEditorStore({ ...deps, fileStore })

    await editor.open("a.ts")
    editor.setDirty("a.ts", true)
    disk.set("a.ts", "v3-external-change") // concurrent change after open

    const setEditingLog: (boolean | undefined)[] = []
    const toasts: Array<{ variant: string; title: string }> = []
    const onOverwrite = async () => {}

    const result = await runHandleOverwrite({
      filePath: "a.ts",
      editor,
      content: "v2-live-edits",
      setEditingLog,
      onOverwrite,
      toasts,
    })

    // Disk has the user's edits (overwrite wins).
    expect(disk.get("a.ts")).toBe("v2-live-edits")
    // The Fix B line fired.
    expect(setEditingLog).toEqual([false])
    expect(result.onOverwriteCalls).toBe(1)
    expect(result.eff.type).toBe("none")
  })

  test("C.6 error path: overwrite backend error → setEditing NOT called, error toast", async () => {
    const disk = new Map<string, string>([["a.ts", "v1-baseline"]])
    const deps: EditorDeps = {
      async readRaw(p) {
        return { type: "ok", content: disk.get(p)!, stamp: { hash: hash(disk.get(p)!) } }
      },
      async write(): Promise<WriteResult> {
        return { type: "error" }
      },
    }
    const fileStore = createFileStore()
    const editor = createEditorStore({ ...deps, fileStore })

    await editor.open("a.ts")
    editor.setDirty("a.ts", true)

    const setEditingLog: (boolean | undefined)[] = []
    const toasts: Array<{ variant: string; title: string }> = []
    const onOverwrite = async () => {
      throw new Error("onOverwrite should NOT be called on error")
    }

    const result = await runHandleOverwrite({
      filePath: "a.ts",
      editor,
      content: "v2-live-edits",
      setEditingLog,
      onOverwrite,
      toasts,
    })

    // Fix B line did NOT fire on error.
    expect(setEditingLog).toEqual([])
    // Error toast fired.
    expect(toasts).toEqual([{ variant: "error", title: "toast.file.saveFailed" }])
    expect(result.onOverwriteCalls).toBe(0)
    expect(result.eff.type).toBe("error")
  })
})

// FORK (CORRECTIF F1, 2026-07-19): resolveConflict("overwrite") can resolve
// non-success in two ways besides "error" — readRaw finds the file gone
// ("missing"), or the internal write() itself hits a fresh 409 because disk
// changed again between the readRaw and the write ("conflict"). Before the
// fix, both fell through to onOverwrite + setEditing(false), seeding the
// viewer with content never persisted and discarding the CodeMirror buffer.
describe("EditorPanel.handleOverwrite — non-success outcomes preserve the buffer (F1)", () => {
  test("F1.a missing path: file gone on disk → setEditing NOT called, no seed, no buffer loss", async () => {
    const disk = new Map<string, string>() // "a.ts" never existed / already deleted
    const deps: EditorDeps = {
      async readRaw() {
        return { type: "not-found" }
      },
      async write(): Promise<WriteResult> {
        throw new Error("write should not be reached — readRaw resolves to missing first")
      },
    }
    const fileStore = createFileStore()
    const editor = createEditorStore({ ...deps, fileStore })
    // open() also hits readRaw("not-found") — entry starts in "missing".
    await editor.open("a.ts")

    const setEditingLog: (boolean | undefined)[] = []
    const toasts: Array<{ variant: string; title: string }> = []
    const onOverwrite = async () => {
      throw new Error("onOverwrite should NOT be called when the file is missing")
    }

    const result = await runHandleOverwrite({
      filePath: "a.ts",
      editor,
      content: "v2-live-edits",
      setEditingLog,
      onOverwrite,
      toasts,
    })

    expect(result.eff.type).toBe("missing")
    expect(result.onOverwriteCalls).toBe(0)
    expect(setEditingLog).toEqual([])
    expect(toasts).toEqual([])
    expect(disk.size).toBe(0)
  })

  test("F1.b conflict path: disk changes again between readRaw and write → setEditing NOT called, no seed, no buffer loss", async () => {
    // readRaw always reports the latest disk content (so resolveConflict
    // rebases baseline + clears the conflict flag), but write() itself is
    // rigged to always report a fresh 409 — simulating another writer
    // racing in between the readRaw and the write inside resolveConflict.
    const disk = new Map<string, string>([["a.ts", "v1-baseline"]])
    const deps: EditorDeps = {
      async readRaw(p) {
        return { type: "ok", content: disk.get(p)!, stamp: { hash: hash(disk.get(p)!) } }
      },
      async write(): Promise<WriteResult> {
        return { type: "conflict" }
      },
    }
    const fileStore = createFileStore()
    const editor = createEditorStore({ ...deps, fileStore })
    await editor.open("a.ts")
    editor.setDirty("a.ts", true)

    const setEditingLog: (boolean | undefined)[] = []
    const toasts: Array<{ variant: string; title: string }> = []
    const onOverwrite = async () => {
      throw new Error("onOverwrite should NOT be called on a re-raced conflict")
    }

    const result = await runHandleOverwrite({
      filePath: "a.ts",
      editor,
      content: "v2-live-edits",
      setEditingLog,
      onOverwrite,
      toasts,
    })

    expect(result.eff.type).toBe("conflict")
    expect(result.onOverwriteCalls).toBe(0)
    expect(setEditingLog).toEqual([])
    expect(toasts).toEqual([])
    // Disk untouched by the rejected write.
    expect(disk.get("a.ts")).toBe("v1-baseline")
  })
})

// FORK (CORRECTIF F3, 2026-07-19): recreate()'s catch used to return
// {type:"none"} — a silent success — asymmetric with save()'s catch
// ({type:"error"}). handleRecreate also only guarded busy/error, so a
// conflict/missing from the internal write fell through to onRecreate as if
// disk persistence had been proven. These tests pin the store.ts catch fix
// AND the handleRecreate non-success guard.
describe("EditorPanel.handleRecreate — non-success outcomes (F3)", () => {
  test("F3.a exception path: write() throws → store returns error (not none), no onRecreate, error toast", async () => {
    const deps: EditorDeps = {
      async readRaw() {
        return { type: "not-found" }
      },
      async write(): Promise<WriteResult> {
        throw new Error("simulated transport failure")
      },
    }
    const fileStore = createFileStore()
    const editor = createEditorStore({ ...deps, fileStore })
    await editor.open("a.ts")
    editor.setDirty("a.ts", true)

    const toasts: Array<{ variant: string; title: string }> = []
    const onRecreate = async () => {
      throw new Error("onRecreate should NOT be called when the write throws")
    }

    const result = await runHandleRecreate({
      filePath: "a.ts",
      editor,
      content: "v2-live-edits",
      onRecreate,
      toasts,
    })

    // Pins the store.ts fix directly: catch must return "error", never "none".
    expect(result.eff.type).toBe("error")
    expect(result.onRecreateCalls).toBe(0)
    expect(toasts).toEqual([{ variant: "error", title: "toast.file.saveFailed" }])
    // The entry must stay conservatively "missing" — markClean is never
    // reachable from this catch.
    expect(editor.get("a.ts")?.missing).toBe(true)
  })

  test("F3.b conflict path: internal write reports a fresh 409 → no onRecreate, no toast, no phantom success", async () => {
    const deps: EditorDeps = {
      async readRaw() {
        return { type: "not-found" }
      },
      async write(): Promise<WriteResult> {
        return { type: "conflict" }
      },
    }
    const fileStore = createFileStore()
    const editor = createEditorStore({ ...deps, fileStore })
    await editor.open("a.ts")
    editor.setDirty("a.ts", true)

    const toasts: Array<{ variant: string; title: string }> = []
    const onRecreate = async () => {
      throw new Error("onRecreate should NOT be called on conflict")
    }

    const result = await runHandleRecreate({
      filePath: "a.ts",
      editor,
      content: "v2-live-edits",
      onRecreate,
      toasts,
    })

    expect(result.eff.type).toBe("conflict")
    expect(result.onRecreateCalls).toBe(0)
    expect(toasts).toEqual([])
  })

  test("F3.c missing path: internal write reports not-found → no onRecreate, no toast, no phantom success", async () => {
    const deps: EditorDeps = {
      async readRaw() {
        return { type: "not-found" }
      },
      async write(): Promise<WriteResult> {
        return { type: "not-found" }
      },
    }
    const fileStore = createFileStore()
    const editor = createEditorStore({ ...deps, fileStore })
    await editor.open("a.ts")
    editor.setDirty("a.ts", true)

    const toasts: Array<{ variant: string; title: string }> = []
    const onRecreate = async () => {
      throw new Error("onRecreate should NOT be called on missing")
    }

    const result = await runHandleRecreate({
      filePath: "a.ts",
      editor,
      content: "v2-live-edits",
      onRecreate,
      toasts,
    })

    expect(result.eff.type).toBe("missing")
    expect(result.onRecreateCalls).toBe(0)
    expect(toasts).toEqual([])
  })

  test("F3.d success path: write succeeds → onRecreate called with final content", async () => {
    const disk = new Map<string, string>()
    const deps: EditorDeps = {
      async readRaw() {
        return { type: "not-found" }
      },
      async write({ path: p, content }): Promise<WriteResult> {
        disk.set(p, content)
        return { type: "ok", content, stamp: { hash: hash(content) }, formatted: false }
      },
    }
    const fileStore = createFileStore()
    const editor = createEditorStore({ ...deps, fileStore })
    await editor.open("a.ts")
    editor.setDirty("a.ts", true)

    const toasts: Array<{ variant: string; title: string }> = []
    let received: string | undefined
    const onRecreate = async (content?: string) => {
      received = content
    }

    const result = await runHandleRecreate({
      filePath: "a.ts",
      editor,
      content: "v2-recreated",
      onRecreate,
      toasts,
    })

    expect(result.eff.type).toBe("none")
    expect(result.onRecreateCalls).toBe(1)
    expect(received).toBe("v2-recreated")
    expect(disk.get("a.ts")).toBe("v2-recreated")
    expect(toasts).toEqual([])
  })
})

// FORK (PLAN-READONLY-VIEWER-REACTIVITY C11): a manual Ctrl+S can race an
// in-flight autosave (or another concurrent save). Before this fix,
// editorStore.save() returned the same `{type:"none"}` for "busy, did
// nothing" as for "saved successfully, no CM mutation needed" — handleCtrlS
// couldn't tell them apart and exited edit mode as if the save had
// succeeded, discarding whatever the user typed after the autosave snapshot
// was captured. These tests pin the fix: "busy" is distinct from "none", and
// a busy Ctrl+S retries with the freshest content instead of silently
// dropping it or lying about success.
describe("EditorPanel.handleCtrlS — busy retry on concurrent save (C11)", () => {
  test("C.7 autosave in flight + Ctrl+S races in → retries and persists the freshest keystrokes, no data loss", async () => {
    const disk = new Map<string, string>([["a.ts", "v1-baseline"]])
    let writeCalls = 0
    const deps: EditorDeps = {
      async readRaw(p) {
        const content = disk.get(p)!
        return { type: "ok", content, stamp: { hash: hash(content) } }
      },
      async write({ path: p, content }): Promise<WriteResult> {
        writeCalls++
        if (writeCalls === 1) {
          // Simulates the autosave write taking a moment, so the concurrent
          // Ctrl+S below observes `saving: true` and gets "busy".
          await new Promise((resolve) => setTimeout(resolve, 20))
        }
        disk.set(p, content)
        return { type: "ok", content, stamp: { hash: hash(content) }, formatted: false }
      },
    }
    const fileStore = createFileStore()
    const editor = createEditorStore({ ...deps, fileStore })

    await editor.open("a.ts")
    editor.setDirty("a.ts", true)

    // Autosave fires first (fire-and-forget, mirrors `void editor.save(...)`
    // in autosave.ts) with a slightly stale snapshot of the buffer.
    const autosavePromise = editor.save("a.ts", "v2-autosave-snapshot")
    expect(editor.get("a.ts")!.saving).toBe(true)

    const setEditingLog: (boolean | undefined)[] = []
    const toasts: Array<{ variant: string; title: string }> = []
    const onSave = async () => {}

    // The user hits Ctrl+S right after, with the truly latest buffer content.
    const result = await runHandleCtrlS({
      filePath: "a.ts",
      editor,
      content: "v3-latest-keystrokes",
      setEditingLog,
      onSave,
      toasts,
    })
    await autosavePromise

    // The freshest content won — no keystrokes lost behind the busy autosave.
    expect(disk.get("a.ts")).toBe("v3-latest-keystrokes")
    expect(result.eff.type).toBe("none")
    expect(result.onSaveCalls).toBe(1)
    expect(setEditingLog).toEqual([false])
    expect(toasts).toEqual([{ variant: "success", title: "toast.file.saved" }])
    expect(writeCalls).toBe(2) // autosave's write + the retried Ctrl+S write
  })

  test("C.8 save stuck busy (retries exhausted) → no false success, no setEditing, no onSave", async () => {
    const deps: EditorDeps = {
      async readRaw() {
        return { type: "ok", content: "v1-baseline", stamp: { hash: hash("v1-baseline") } }
      },
      write: () => new Promise<WriteResult>(() => {}), // never resolves — save stays in flight forever
    }
    const fileStore = createFileStore()
    const editor = createEditorStore({ ...deps, fileStore })

    await editor.open("a.ts")
    editor.setDirty("a.ts", true)
    void editor.save("a.ts", "v2-stuck") // never resolves; saving stays true forever
    expect(editor.get("a.ts")!.saving).toBe(true)

    const setEditingLog: (boolean | undefined)[] = []
    const toasts: Array<{ variant: string; title: string }> = []
    const onSave = async () => {
      throw new Error("onSave should NOT be called when the save never completed")
    }

    // retriesLeft: 0 skips the wait/retry loop and exercises the "give up"
    // branch directly, without a real multi-second timeout in the suite.
    const result = await runHandleCtrlS(
      { filePath: "a.ts", editor, content: "v3-live-edits", setEditingLog, onSave, toasts },
      0,
    )

    expect(result.eff.type).toBe("busy")
    expect(result.onSaveCalls).toBe(0)
    expect(setEditingLog).toEqual([])
    expect(toasts).toEqual([])
  })

  test("C.9 overwrite busy path: no setEditing, no false conflict-resolved state", async () => {
    let resolveWrite: (r: WriteResult) => void = () => {}
    const deps: EditorDeps = {
      async readRaw() {
        return { type: "ok", content: "v3-external-change", stamp: { hash: hash("v3-external-change") } }
      },
      write: () => new Promise<WriteResult>((resolve) => (resolveWrite = resolve)),
    }
    const fileStore = createFileStore()
    const editor = createEditorStore({ ...deps, fileStore })

    await editor.open("a.ts")
    editor.setDirty("a.ts", true)
    // Put the entry into "saving" so resolveConflict's internal save() call
    // hits the busy guard.
    const inFlight = editor.save("a.ts", "v2-in-flight")
    expect(editor.get("a.ts")!.saving).toBe(true)

    const setEditingLog: (boolean | undefined)[] = []
    const toasts: Array<{ variant: string; title: string }> = []
    const onOverwrite = async () => {
      throw new Error("onOverwrite should NOT be called on a busy no-op")
    }

    const result = await runHandleOverwrite({
      filePath: "a.ts",
      editor,
      content: "v4-overwrite-attempt",
      setEditingLog,
      onOverwrite,
      toasts,
    })

    expect(result.eff.type).toBe("busy")
    expect(result.onOverwriteCalls).toBe(0)
    expect(setEditingLog).toEqual([])
    expect(toasts).toEqual([])

    resolveWrite({ type: "ok", content: "v2-in-flight", stamp: { hash: hash("v2-in-flight") }, formatted: false })
    await inFlight
  })
})

// FORK (PLAN-READONLY-VIEWER-REACTIVITY C1): handleCtrlS/handleOverwrite now
// pass the exact final bytes to onSave/onOverwrite so file-tabs.tsx can seed
// the viewer cache directly instead of re-fetching over the SDK. These tests
// pin which content wins in each case.
describe("EditorPanel — content passed to onSave/onOverwrite (C1 seed source)", () => {
  test("C.10 unformatted save: onSave receives the exact sent content", async () => {
    const { deps } = fakeDeps({ "a.ts": "v1-baseline" })
    const fileStore = createFileStore()
    const editor = createEditorStore({ ...deps, fileStore })
    await editor.open("a.ts")
    editor.setDirty("a.ts", true)

    let received: string | undefined
    const onSave = async (content?: string) => {
      received = content
    }

    await runHandleCtrlS({
      filePath: "a.ts",
      editor,
      content: "v2-live-edits",
      setEditingLog: [],
      onSave,
      toasts: [],
    })

    expect(received).toBe("v2-live-edits")
  })

  test("C.11 formatted save: onSave receives the backend's reformatted content, not the sent one", async () => {
    const disk = new Map<string, string>([["a.ts", "v1-baseline"]])
    const deps: EditorDeps = {
      async readRaw(p) {
        return { type: "ok", content: disk.get(p)!, stamp: { hash: hash(disk.get(p)!) } }
      },
      async write({ path: p, content }): Promise<WriteResult> {
        const formattedContent = `${content}\n// formatted`
        disk.set(p, formattedContent)
        return { type: "ok", content: formattedContent, stamp: { hash: hash(formattedContent) }, formatted: true }
      },
    }
    const fileStore = createFileStore()
    const editor = createEditorStore({ ...deps, fileStore })
    await editor.open("a.ts")
    editor.setDirty("a.ts", true)

    let received: string | undefined
    const onSave = async (content?: string) => {
      received = content
    }

    const result = await runHandleCtrlS({
      filePath: "a.ts",
      editor,
      content: "v2-live-edits",
      setEditingLog: [],
      onSave,
      toasts: [],
    })

    expect(result.eff.type).toBe("set")
    expect(received).toBe("v2-live-edits\n// formatted")
    expect(received).not.toBe("v2-live-edits")
  })

  test("C.12 overwrite: onOverwrite receives the exact sent content", async () => {
    const { deps, disk } = fakeDeps({ "a.ts": "v1-baseline" })
    const fileStore = createFileStore()
    const editor = createEditorStore({ ...deps, fileStore })
    await editor.open("a.ts")
    editor.setDirty("a.ts", true)
    disk.set("a.ts", "v3-external-change")

    let received: string | undefined
    const onOverwrite = async (content?: string) => {
      received = content
    }

    await runHandleOverwrite({
      filePath: "a.ts",
      editor,
      content: "v2-live-edits",
      setEditingLog: [],
      onOverwrite,
      toasts: [],
    })

    expect(received).toBe("v2-live-edits")
  })
})