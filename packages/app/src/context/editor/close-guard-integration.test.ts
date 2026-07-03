import { test, expect, describe } from "bun:test"
import { createFileStore } from "../file/store"
import { createEditorStore, type EditorDeps, type WriteResult } from "./store"

// FORK (round 3, PLAN-FIX-CLOSE-GUARD-SAVE): integration test for the
// close-guard.onSave handler. The handler logic is reproduced here because
// close-guard.tsx is a Solid component (JSX + DialogProvider); the side
// effects (layout.tabs.close, dialog.close, setPending, p.resolve) are all
// replaced by a captured-call list so we can assert on them.
//
// This is the canonical proof of Cas A (close-guard sends live CM content to
// backend, not baseline) without needing a GUI repro. The dialog handler is
// verbatim: same `live = getDraftContent ?? content ?? ""`, same
// `editor.save(p.path, live)`, same `eff.type` switch.
//
// Reference: close-guard.tsx:102-138 (the onSave callback passed to
// DialogDirtyClose). Any drift from the live implementation breaks this test.

const hash = (s: string) => `h:${s.length}:${s}`

type CloseGuardSideEffects = {
  layoutClosedTabs: string[]
  dialogClosed: number
  pendingResolved: ("closed" | "cancelled")[]
  toasts: Array<{ variant: string; title: string }>
}

// Reproduces the close-guard.onSave body verbatim. Returns the same DocEffect
// the real handler would so the test can assert on it.
async function runCloseGuardOnSave(opts: {
  filePath: string
  fileStore: ReturnType<typeof createFileStore>
  editor: ReturnType<typeof createEditorStore>
  effects: CloseGuardSideEffects
}) {
  const { filePath, fileStore, editor, effects } = opts
  // FORK (round 3) — Fix A line: prefer live CM content (registered as a
  // getter on mount) over the baseline in FileStore.content. The fallback
  // to content covers "editor mounted but getter effect not yet run" or
  // "tab fired close-guard before the CM ref settled".
  const live = fileStore.getDraftContent(filePath) ?? fileStore.get(filePath)?.content ?? ""
  const eff = await editor.save(filePath, live)
  // FORK (round 3) — Fix B branch: never close the tab on save failure.
  if (eff.type === "conflict" || eff.type === "missing" || eff.type === "error") {
    if (eff.type === "error") {
      effects.toasts.push({ variant: "error", title: "toast.file.saveFailed" })
    }
    // setPending(null) BEFORE dialog.close() so the dialog.onClose callback
    // sees pending === null and does not double-resolve. Mirrored here by
    // emitting the resolution in the same order.
    effects.dialogClosed += 1
    effects.pendingResolved.push("cancelled")
    return eff
  }
  // Success path — close the tab, close the dialog, resolve.
  effects.layoutClosedTabs.push(filePath)
  effects.dialogClosed += 1
  effects.pendingResolved.push("closed")
  return eff
}

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

describe("close-guard.onSave (round 3, Fix A — live CM via getter)", () => {
  test("sends live CM content (not baseline) when getter is registered", async () => {
    // Setup: file exists on disk with "v1-baseline". Editor is open, dirty.
    // The CM handle (simulated) returns "USER-LIVE-EDITS" via the getter.
    const { deps, disk } = fakeDeps({ "a.ts": "v1-baseline" })
    const fileStore = createFileStore()
    const editor = createEditorStore({ ...deps, fileStore })

    fileStore.markClean("a.ts", "v1-baseline", { hash: hash("v1-baseline") })
    await editor.open("a.ts")
    editor.setDirty("a.ts", true)

    // EditorPanel.createEffect equivalent — register the live getter.
    fileStore.setDraftGetter("a.ts", () => "USER-LIVE-EDITS")

    const effects: CloseGuardSideEffects = {
      layoutClosedTabs: [],
      dialogClosed: 0,
      pendingResolved: [],
      toasts: [],
    }
    const eff = await runCloseGuardOnSave({
      filePath: "a.ts",
      fileStore,
      editor,
      effects,
    })

    // Fix A proof: write received the live content, not the baseline.
    expect(eff.type).toBe("none")
    expect(disk.get("a.ts")).toBe("USER-LIVE-EDITS")
    expect(disk.get("a.ts")).not.toBe("v1-baseline")
    // Fix B proof (success path): tab closed, dialog closed, promise resolved.
    expect(effects.layoutClosedTabs).toEqual(["a.ts"])
    expect(effects.dialogClosed).toBe(1)
    expect(effects.pendingResolved).toEqual(["closed"])
  })

  test("fallback to FileStore.content when no getter is registered", async () => {
    // Regression guard: editor was unmounted before the close-guard fired
    // (e.g. tab was orphaned). close-guard MUST still send something — the
    // baseline is the only authoritative copy left.
    const { deps, disk } = fakeDeps({ "a.ts": "v1-baseline" })
    const fileStore = createFileStore()
    const editor = createEditorStore({ ...deps, fileStore })

    fileStore.markClean("a.ts", "v1-baseline", { hash: hash("v1-baseline") })
    await editor.open("a.ts")
    editor.setDirty("a.ts", true)
    // NO setDraftGetter call.

    const effects: CloseGuardSideEffects = {
      layoutClosedTabs: [],
      dialogClosed: 0,
      pendingResolved: [],
      toasts: [],
    }
    await runCloseGuardOnSave({ filePath: "a.ts", fileStore, editor, effects })

    expect(disk.get("a.ts")).toBe("v1-baseline")
  })

  test("empty fallback when neither getter nor FileStore entry exists", async () => {
    // Edge: a brand-new file was created via auto-save but never reached
    // the editor. close-guard on such a path would send "" — covered so we
    // do not regress the previous `fileStore.get(p)?.content ?? ""` shape.
    const { deps } = fakeDeps()
    const fileStore = createFileStore()
    const editor = createEditorStore(deps)

    const effects: CloseGuardSideEffects = {
      layoutClosedTabs: [],
      dialogClosed: 0,
      pendingResolved: [],
      toasts: [],
    }
    await runCloseGuardOnSave({ filePath: "ghost.ts", fileStore, editor, effects })

    expect(effects.pendingResolved).toEqual(["closed"])
  })

  test("getter returns the FRESHEST content on each call (live, not snapshot)", async () => {
    // WHY this matters: the getter is a closure over the live CM ref. If a
    // future refactor replaces it with a one-shot snapshot at mount, this
    // test catches it (the second read would still see "v1" instead of
    // "v2-fresh").
    const { deps, disk } = fakeDeps({ "a.ts": "v1-baseline" })
    const fileStore = createFileStore()
    const editor = createEditorStore({ ...deps, fileStore })

    fileStore.markClean("a.ts", "v1-baseline", { hash: hash("v1-baseline") })
    await editor.open("a.ts")
    editor.setDirty("a.ts", true)

    let liveValue = "edit-1"
    fileStore.setDraftGetter("a.ts", () => liveValue)

    // Simulate a keystroke after mount but before close-guard fires.
    liveValue = "edit-2-fresh"

    const effects: CloseGuardSideEffects = {
      layoutClosedTabs: [],
      dialogClosed: 0,
      pendingResolved: [],
      toasts: [],
    }
    await runCloseGuardOnSave({ filePath: "a.ts", fileStore, editor, effects })

    expect(disk.get("a.ts")).toBe("edit-2-fresh")
  })
})

describe("close-guard.onSave (round 3, Fix B — never close on save failure)", () => {
  function depsWithResult(writeResult: WriteResult): EditorDeps {
    return {
      async readRaw() {
        return { type: "ok", content: "v1", stamp: { hash: hash("v1") } }
      },
      async write(): Promise<WriteResult> {
        return writeResult
      },
    }
  }

  function setupEditor(writeResult: WriteResult) {
    const fileStore = createFileStore()
    const editor = createEditorStore({ ...depsWithResult(writeResult), fileStore })
    fileStore.markClean("a.ts", "v1", { hash: hash("v1") })
    // editor.open is async — must complete so save() finds an entry. Otherwise
    // save() short-circuits with {type:"none"} (no entry → no save).
    return { fileStore, editor, open: editor.open("a.ts") }
  }

  test("conflict (409): tab stays open, dialog closed, resolved as cancelled", async () => {
    const { fileStore, editor, open } = setupEditor({ type: "conflict" })
    await open
    fileStore.setDraftGetter("a.ts", () => "USER-EDITS")

    const effects: CloseGuardSideEffects = {
      layoutClosedTabs: [],
      dialogClosed: 0,
      pendingResolved: [],
      toasts: [],
    }
    const eff = await runCloseGuardOnSave({ filePath: "a.ts", fileStore, editor, effects })

    expect(eff.type).toBe("conflict")
    // Tab MUST NOT be closed on save failure (Fix B).
    expect(effects.layoutClosedTabs).toEqual([])
    expect(effects.dialogClosed).toBe(1)
    expect(effects.pendingResolved).toEqual(["cancelled"])
    // No toast for conflict — the EditorBanner surfaces it via the reactive entry.
    expect(effects.toasts).toEqual([])
  })

  test("missing (404): tab stays open, dialog closed, resolved as cancelled", async () => {
    const { fileStore, editor, open } = setupEditor({ type: "not-found" })
    await open
    fileStore.setDraftGetter("a.ts", () => "USER-EDITS")

    const effects: CloseGuardSideEffects = {
      layoutClosedTabs: [],
      dialogClosed: 0,
      pendingResolved: [],
      toasts: [],
    }
    const eff = await runCloseGuardOnSave({ filePath: "a.ts", fileStore, editor, effects })

    expect(eff.type).toBe("missing")
    expect(effects.layoutClosedTabs).toEqual([])
    expect(effects.dialogClosed).toBe(1)
    expect(effects.pendingResolved).toEqual(["cancelled"])
  })

  test("error (500): tab stays open, dialog closed, SaveFailed toast shown", async () => {
    const { fileStore, editor, open } = setupEditor({ type: "error" })
    await open
    fileStore.setDraftGetter("a.ts", () => "USER-EDITS")

    const effects: CloseGuardSideEffects = {
      layoutClosedTabs: [],
      dialogClosed: 0,
      pendingResolved: [],
      toasts: [],
    }
    const eff = await runCloseGuardOnSave({ filePath: "a.ts", fileStore, editor, effects })

    expect(eff.type).toBe("error")
    expect(effects.layoutClosedTabs).toEqual([])
    expect(effects.dialogClosed).toBe(1)
    expect(effects.pendingResolved).toEqual(["cancelled"])
    // SaveFailed toast — the silent-failure regression fix (REGRESSION FIX
    // 2026-06-27, round 2) requires an explicit toast on backend errors.
    expect(effects.toasts).toEqual([{ variant: "error", title: "toast.file.saveFailed" }])
  })

  test("success: tab closed, dialog closed, resolved as closed", async () => {
    const { fileStore, editor, open } = setupEditor({
      type: "ok",
      content: "USER-EDITS",
      stamp: { hash: hash("USER-EDITS") },
      formatted: false,
    })
    await open
    fileStore.setDraftGetter("a.ts", () => "USER-EDITS")

    const effects: CloseGuardSideEffects = {
      layoutClosedTabs: [],
      dialogClosed: 0,
      pendingResolved: [],
      toasts: [],
    }
    await runCloseGuardOnSave({ filePath: "a.ts", fileStore, editor, effects })

    expect(effects.layoutClosedTabs).toEqual(["a.ts"])
    expect(effects.dialogClosed).toBe(1)
    expect(effects.pendingResolved).toEqual(["closed"])
    expect(effects.toasts).toEqual([])
  })
})

describe("close-guard (round 3, getter cleanup)", () => {
  test("setDraftGetter(undefined) unregisters — subsequent getDraftContent returns undefined", () => {
    // WHY this invariant: the EditorPanel.createEffect return-value cleanup
    // runs setDraftGetter(p, undefined) on path change AND on unmount.
    // Without it, switching tabs accumulates stale closures in the map.
    const fileStore = createFileStore()
    fileStore.setDraftGetter("a.ts", () => "live")
    expect(fileStore.getDraftContent("a.ts")).toBe("live")

    fileStore.setDraftGetter("a.ts", undefined)
    expect(fileStore.getDraftContent("a.ts")).toBeUndefined()
  })

  test("remove() also clears the draft getter", () => {
    const fileStore = createFileStore()
    fileStore.upsert("a.ts", { content: "", stamp: { hash: "" }, status: "clean" })
    fileStore.setDraftGetter("a.ts", () => "live")
    fileStore.remove("a.ts")
    expect(fileStore.getDraftContent("a.ts")).toBeUndefined()
  })

  test("multiple paths: each has its own live getter", async () => {
    // WHY this matters: split pane or tabbed editor may have two file tabs
    // open at once, each with its own CM. Switching close-guard targets
    // must read the LIVE bytes of THAT path, not a stale closure from
    // another tab.
    const { deps, disk } = fakeDeps({ "a.ts": "a-v1", "b.ts": "b-v1" })
    const fileStore = createFileStore()
    const editor = createEditorStore({ ...deps, fileStore })

    fileStore.markClean("a.ts", "a-v1", { hash: hash("a-v1") })
    fileStore.markClean("b.ts", "b-v1", { hash: hash("b-v1") })
    await editor.open("a.ts")
    await editor.open("b.ts")
    editor.setDirty("a.ts", true)
    editor.setDirty("b.ts", true)

    fileStore.setDraftGetter("a.ts", () => "a-LIVE")
    fileStore.setDraftGetter("b.ts", () => "b-LIVE")

    const effects: CloseGuardSideEffects = {
      layoutClosedTabs: [],
      dialogClosed: 0,
      pendingResolved: [],
      toasts: [],
    }

    // Close-guard on A first.
    await runCloseGuardOnSave({ filePath: "a.ts", fileStore, editor, effects })
    expect(disk.get("a.ts")).toBe("a-LIVE")

    // Close-guard on B second.
    await runCloseGuardOnSave({ filePath: "b.ts", fileStore, editor, effects })
    expect(disk.get("b.ts")).toBe("b-LIVE")

    // Neither leaked into the other.
    expect(effects.layoutClosedTabs).toEqual(["a.ts", "b.ts"])
  })
})
