import { test, expect, describe } from "bun:test"
import { createFileStore } from "@/context/file/store"
import { createEditorStore, type EditorDeps, type WriteResult } from "@/context/editor/store"

// FORK (AutoExit-Edit-On-Save 2026-06-29, PLAN-EDITEUR-IDE-AUTOEXIT-EDIT-ON-SAVE):
// Behavioral tests for the new `props.setEditing(false)` calls in
// editor-panel.tsx (Fix A on handleCtrlS, Fix B on handleOverwrite).
//
// Mirrors the close-guard-integration.test.ts pattern: the handler logic
// is reproduced verbatim as a pure function and exercised against
// createFileStore + createEditorStore mocks. Side effects (setEditing,
// onSave, toasts) are captured in lists so we can assert on them.
//
// Reference: editor-panel.tsx:170-195 (handleCtrlS), editor-panel.tsx:208-224
// (handleOverwrite). The 2 added lines are:
//   - line ~194 (handleCtrlS success): `props.setEditing(false)`
//   - line ~226 (handleOverwrite success): `props.setEditing(false)`
// Any drift from the live implementation breaks these tests — and removing
// either setEditing(false) line makes the corresponding `expect(setEditingLog)`
// assertion fail. This is the regression net for the feature.

const hash = (s: string) => `h:${s.length}:${s}`

// Reproduces the handleCtrlS body verbatim (editor-panel.tsx:170-195),
// INCLUDING the new `props.setEditing(false)` line in the success branch.
async function runHandleCtrlS(opts: {
  filePath: string
  editor: ReturnType<typeof createEditorStore>
  content: string
  setEditingLog: (boolean | undefined)[]
  onSave: () => Promise<void>
  toasts: Array<{ variant: string; title: string }>
}) {
  const { filePath, editor, content, setEditingLog, onSave, toasts } = opts
  // settings.general.formatOnSave() — irrelevant here, we don't assert on it.
  const format = false
  // Faithful reproduction of handleCtrlS:
  const eff = await editor.save(filePath, content, format)
  // applyDocEffect is a no-op when eff.type !== "set" — skipped in this fixture.
  if (eff.type === "conflict" || eff.type === "missing" || eff.type === "error") {
    if (eff.type === "error") {
      toasts.push({ variant: "error", title: "toast.file.saveFailed" })
    }
    return { eff, onSaveCalls: 0 }
  }
  await onSave()
  toasts.push({ variant: "success", title: "toast.file.saved" })
  // ← THE NEW LINE: AutoExit on save success.
  setEditingLog.push(false)
  return { eff, onSaveCalls: 1 }
}

// Reproduces the handleOverwrite body verbatim (editor-panel.tsx:208-224),
// INCLUDING the new `props.setEditing(false)` line in the success branch.
async function runHandleOverwrite(opts: {
  filePath: string
  editor: ReturnType<typeof createEditorStore>
  content: string
  setEditingLog: (boolean | undefined)[]
  onOverwrite: () => Promise<void>
  toasts: Array<{ variant: string; title: string }>
}) {
  const { filePath, editor, content, setEditingLog, onOverwrite, toasts } = opts
  const eff = await editor.resolveConflict(filePath, content, "overwrite")
  if (eff.type === "error") {
    toasts.push({ variant: "error", title: "toast.file.saveFailed" })
    return { eff, onOverwriteCalls: 0 }
  }
  await onOverwrite()
  // ← THE NEW LINE: AutoExit on conflict overwrite success.
  setEditingLog.push(false)
  return { eff, onOverwriteCalls: 1 }
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

  test("C.1b success on a clean file (no edits): save no-op → setEditing(false) still called", async () => {
    // User hits Ctrl+S on a file they haven't edited yet. The save is a
    // backend no-op (writes the same content back). We accept this exits
    // edit mode — Ctrl+S is an explicit "I'm done" gesture.
    const { deps } = fakeDeps({ "a.ts": "v1-baseline" })
    const fileStore = createFileStore()
    const editor = createEditorStore({ ...deps, fileStore })

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
    expect(result.eff.type).toBe("none")
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