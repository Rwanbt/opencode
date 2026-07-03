// Single source of truth for file content (PLAN-EDITEUR-IDE-DEFINITIF Phase 2, R1).
//
// WHY: viewer (`context/file.tsx`) and editor (`context/editor/store.ts`) each
// held their own copy of the file content with no reactive link. They drifted:
// the viewer was trim()-ed (file/index.ts:633), the editor was not, so saving
// then closing then reopening showed stale bytes in read-mode while edit-mode
// showed fresh bytes. This store holds, per canonical path, the raw disk
// content + its stamp + an optional live CM draft. Read-mode renders `content`,
// edit-mode renders `draft ?? content`. The two views CANNOT diverge by
// construction.
//
// Phase 2.1 = foundation only. Consumers (`context/file.tsx`, the editor
// store, `file-tabs.tsx`) are migrated in 2.4–2.6. No call site of this store
// exists yet — wire-up comes later.
//
// FORK (round 3, 2026-06-28, PLAN-FIX-CLOSE-GUARD-SAVE): draft getter pattern.
// CM owns the live buffer; mirroring the full content into `FileDoc.draft` on
// every keystroke is a perf killer on large files (1MB+) and duplicates state.
// Instead, consumers that need the live CM content (close-guard, autosave
// scheduling) register a zero-arg getter at mount time. `getDraftContent(p)`
// calls the getter on demand at save time, so it always reads the freshest
// bytes without any per-keystroke copy. Cleanup is mandatory at unmount
// (via `setDraftGetter(p, undefined)`) and on `remove(p)`.

import { createStore, produce } from "solid-js/store"
import { createSimpleContext } from "@opencode-ai/ui/context"
import type { Stamp } from "../editor/store"

export type FileStatus = "clean" | "dirty" | "saving" | "conflict" | "missing"

/** Git VCS payload, populated only for tracked files that have a diff vs HEAD. */
export interface FileVcs {
  /** diff-match-patch shape (lazy). */
  patch?: unknown
  /** Pre-formatted patch (text). */
  diff?: string
}

export interface FileDoc {
  /** Raw disk content (NEVER trimmed). The disk's truth as of the last load/save/reload. */
  content: string
  /** Hash + mtime + size of the disk content above. */
  stamp: Stamp
  /** State machine: clean → dirty (CM diverges) → saving → clean | conflict | missing. */
  status: FileStatus
  /**
   * Live CM buffer. `undefined` ⇒ clean ⇒ edit-mode renders `content`.
   * Defined ⇒ edit-mode renders `draft`, read-mode still renders `content`.
   */
  draft?: string
  /** Optional git payload — absent for non-VCS files or files with no diff. */
  vcs?: FileVcs
}

export function createFileStore() {
  const [state, setState] = createStore<{ docs: Record<string, FileDoc> }>({ docs: {} })

  // FORK (round 3): live-CM getter registry. See header comment.
  // Each entry maps a canonical path to a closure returning the current CM
  // buffer. The closure is set on mount and cleared on unmount/remove so a
  // stale ref cannot leak into a later save.
  const draftGetters = new Map<string, () => string | undefined>()

  const get = (path: string): FileDoc | undefined => state.docs[path]

  const set = (path: string, patch: Partial<FileDoc>) =>
    setState(
      "docs",
      path,
      produce((doc) => {
        if (doc) Object.assign(doc, patch)
      }),
    )

  const upsert = (path: string, doc: FileDoc) => {
    setState("docs", path, doc)
  }

  const remove = (path: string) => {
    draftGetters.delete(path)
    setState(
      "docs",
      produce((docs) => {
        delete docs[path]
      }),
    )
  }

  // WHY a dedicated `markClean` rather than letting callers compose `set(...)`:
  // enforces that transitioning to clean always clears the draft. A dirty draft
  // left over with status:"clean" would let edit-mode render stale bytes after
  // a successful save/reload. Centralizing the invariant here is cheaper than
  // auditing every caller.
  //
  // WHY an upsert fallback when the doc is absent: every entry point that
  // introduces a file into the store (viewer load, editor open, editor
  // resolveConflict-overwrite) goes through markClean. Requiring each caller
  // to first upsert would scatter the seed-shape across the codebase and
  // duplicate it in every branch.
  const markClean = (path: string, content: string, stamp: Stamp, vcs?: FileVcs) => {
    if (!state.docs[path]) {
      upsert(path, { content, stamp, status: "clean", vcs })
      return
    }
    setState(
      "docs",
      path,
      produce((doc) => {
        doc.content = content
        doc.stamp = stamp
        doc.status = "clean"
        doc.draft = undefined
        if (vcs) doc.vcs = vcs
        else delete doc.vcs
      }),
    )
  }

  const markDirty = (path: string, draft?: string) =>
    setState(
      "docs",
      path,
      produce((doc) => {
        if (!doc) return
        doc.draft = draft
        doc.status = "dirty"
      }),
    )

  const markSaving = (path: string) =>
    setState(
      "docs",
      path,
      produce((doc) => {
        if (!doc) return
        doc.status = "saving"
      }),
    )

  const markConflict = (path: string) =>
    setState(
      "docs",
      path,
      produce((doc) => {
        if (!doc) return
        doc.status = "conflict"
      }),
    )

  const markMissing = (path: string) =>
    setState(
      "docs",
      path,
      produce((doc) => {
        if (!doc) return
        doc.status = "missing"
      }),
    )

  // FORK (round 3): live-CM getter registry API. See header comment.
  // `undefined` getter → unregister. No setter when there's no live CM mounted
  // (e.g. viewer-only or right after EditorTabCleanup).
  const setDraftGetter = (
    path: string,
    getter: (() => string | undefined) | undefined,
  ) => {
    if (getter === undefined) draftGetters.delete(path)
    else draftGetters.set(path, getter)
  }

  const getDraftContent = (path: string): string | undefined => {
    const g = draftGetters.get(path)
    return g ? g() : undefined
  }

  return {
    state,
    get,
    set,
    upsert,
    remove,
    markClean,
    markDirty,
    markSaving,
    markConflict,
    markMissing,
    setDraftGetter,
    getDraftContent,
  }
}

export type FileStore = ReturnType<typeof createFileStore>

// WHY: `createFileStore` is a pure factory (tested without context in
// store.test.ts) but consumers grab it via Solid's context to avoid prop
// drilling. This wraps the factory in `createSimpleContext` — the same
// pattern used by `useFile` (context/file.tsx) and `useLayout`.
//
// No I/O, no SDK client, no watcher wiring here. The store starts empty;
// callers populate entries (2.4b wires context/file.tsx, 2.4c wires
// context/editor.tsx). No watcher yet — that lands in 2.4d.
//
// The Provider is exposed via `FileStoreProvider`; the read hook is `useFileStore`.
export const { use: useFileStore, provider: FileStoreProvider } = createSimpleContext({
  name: "FileStore",
  init: createFileStore,
})