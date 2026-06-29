import { createStore, produce } from "solid-js/store"
import type { FileStore } from "../file/store"

/**
 * Editor store (ADR-0005, 1b-core). State machine for editable file tabs.
 *
 * SINGLE SOURCE OF TRUTH: CodeMirror owns the live document. This store holds
 * only metadata per file — never the live buffer string. Actions that change
 * the document return the content for the caller (the CM component) to apply via
 * a transaction. `save` receives the current content from CM.
 *
 * Keyed by `path` (NOT by tab): two tabs of the same file share one entry, so a
 * single baseline/dirty/conflict state — no divergence.
 *
 * Watcher protocol (anti data-loss): an external disk change to an open file
 * must never clobber a dirty buffer.
 *
 *        external change (watcher)            save() -> 409
 *   clean ─────────────────────────► reload   any ───────────► conflict
 *   dirty ─────────────────────────► stale            disk gone
 *   saving ────────────────────────► ignore   any ───────────► missing
 *   (our own write echoes back as a watcher event while saving — ignored)
 */

export interface Stamp {
  hash: string
  mtime?: number
  size?: number
}

export interface EditorEntry {
  /** Last known on-disk content + hash; the dirty/conflict baseline. */
  baseline: { content: string; hash: string }
  /** CM doc differs from baseline (reported by the component). */
  dirty: boolean
  /** Disk changed under a dirty buffer; surfaces as a conflict on save. */
  stale: boolean
  /** A save is in flight. */
  saving: boolean
  /** Last save was rejected (409) — the file changed on disk. */
  conflict: boolean
  /** The file no longer exists on disk (deleted/renamed externally). */
  missing: boolean
}

export type ReadRawResult = { type: "ok"; content: string; stamp: Stamp } | { type: "not-found" }

export type WriteResult =
  | { type: "ok"; content: string; stamp: Stamp; formatted: boolean }
  | { type: "conflict" }
  | { type: "not-found" }
  | { type: "error" }

export interface EditorDeps {
  readRaw: (path: string) => Promise<ReadRawResult>
  write: (input: {
    path: string
    content: string
    expectedHash?: string
    format?: boolean
  }) => Promise<WriteResult>
  // Optional FileStore mirror (PLAN-EDITEUR-IDE-DEFINITIF Phase 2, R1).
  // When provided, every state transition here also updates the shared
  // FileStore so viewer and editor cannot drift on the same canonical path.
  // Undefined ⇒ no-op (used by store.test.ts which has no provider tree).
  fileStore?: FileStore
}

/** What the caller (CM component) should do with the document after an action. */
export type DocEffect =
  | { type: "set"; content: string } // replace the CM doc with this content
  | { type: "none" } // leave the CM doc untouched
  | { type: "conflict" } // save blocked by 409 — show the conflict banner
  | { type: "missing" } // file gone on disk — show the delete-on-disk actions
  | { type: "error" } // FORK (REGRESSION FIX 2026-06-27): backend write failed
                       // (e.g. atomicWrite post-rename mismatch) — surface a
                       // SaveFailed toast instead of the phantom "Saved".

function freshEntry(content: string, hash: string): EditorEntry {
  return { baseline: { content, hash }, dirty: false, stale: false, saving: false, conflict: false, missing: false }
}

export function createEditorStore(deps: EditorDeps) {
  const [state, setState] = createStore<{ entries: Record<string, EditorEntry> }>({ entries: {} })

  // WHY: the editor store is the authoritative source for the dirty/saving/
  // conflict/missing state machine, but the FileStore is the single source of
  // truth for raw content + stamp + status that BOTH the viewer (read-mode)
  // and the editor (edit-mode via CM) need to agree on. Without this mirror,
  // a successful save updates the editor's baseline while the viewer keeps
  // showing stale bytes until the next close+reopen (the bug Phase 2 fixes).
  // Each branch must call this with the FINAL state so a 409 from write()
  // does NOT silently re-clear conflict on a stale save.
  const mirror = (
    path: string,
    action: (fs: FileStore) => void,
  ) => {
    if (!deps.fileStore) return
    action(deps.fileStore)
  }

  const get = (path: string): EditorEntry | undefined => state.entries[path]

  const set = (path: string, patch: Partial<EditorEntry>) =>
    setState(
      "entries",
      path,
      produce((entry) => {
        if (entry) Object.assign(entry, patch)
      }),
    )

  /**
   * Load baseline for a file. Returns the content to seed the CM doc.
   * When fallbackContent is provided (e.g. from the read-mode view), the editor
   * opens even if readRaw fails — avoids a false "file deleted" banner.
   *
   * WHY always re-read disk (was: short-circuit if existing && !missing):
   *   the previous implementation returned `existing.baseline.content`
   *   without ever calling readRaw, so a baseline that drifted from disk
   *   (e.g. close-guard's save flow fed back the pre-modification
   *   baseline through FileStore, or the editor entry outlived a tab
   *   close+reopen cycle) made the next edit-mode open show stale bytes
   *   while the disk already held the fresh ones. EditorTabCleanup calls
   *   `editor.close()` on tab removal, so the cost of an extra readRaw
   *   is paid only on entry into edit mode — acceptable.
   */
  async function open(path: string, fallbackContent?: string): Promise<DocEffect> {
    try {
      const res = await deps.readRaw(path)
      if (res.type === "not-found") {
        if (fallbackContent !== undefined) {
          setState("entries", path, freshEntry(fallbackContent, ""))
          mirror(path, (fs) => fs.markClean(path, fallbackContent, { hash: "" }))
          return { type: "set", content: fallbackContent }
        }
        setState("entries", path, { ...freshEntry("", ""), missing: true })
        mirror(path, (fs) => fs.markMissing(path))
        return { type: "missing" }
      }
      setState("entries", path, freshEntry(res.content, res.stamp.hash))
      mirror(path, (fs) => fs.markClean(path, res.content, res.stamp))
      return { type: "set", content: res.content }
    } catch {
      if (fallbackContent !== undefined) {
        setState("entries", path, freshEntry(fallbackContent, ""))
        mirror(path, (fs) => fs.markClean(path, fallbackContent, { hash: "" }))
        return { type: "set", content: fallbackContent }
      }
      setState("entries", path, { ...freshEntry("", ""), missing: true })
      mirror(path, (fs) => fs.markMissing(path))
      return { type: "missing" }
    }
  }

  /** CM reports whether its doc differs from the baseline. */
  function setDirty(path: string, dirty: boolean) {
    const entry = state.entries[path]
    if (!entry) return
    set(path, { dirty })
    if (dirty) {
      // WHY no draft here: CM owns the live buffer. FileStore.draft stays
      // undefined — edit-mode reads CM directly. Status="dirty" alone is
      // enough to gate save concurrency and the conflict banner.
      mirror(path, (fs) => fs.markDirty(path))
      return
    }
    // Returning to clean = restoring baseline (e.g. after discard()).
    mirror(path, (fs) => fs.markClean(path, entry.baseline.content, { hash: entry.baseline.hash }))
  }

  /** Save the current CM content with the hash precondition. */
  async function save(path: string, content: string, format?: boolean): Promise<DocEffect> {
    const entry = state.entries[path]
    if (!entry || entry.saving) return { type: "none" }
    set(path, { saving: true })
    mirror(path, (fs) => fs.markSaving(path))
    try {
      const res = await deps.write({ path, content, expectedHash: entry.baseline.hash || undefined, format })
      if (res.type === "conflict") {
        set(path, { saving: false, conflict: true })
        mirror(path, (fs) => fs.markConflict(path))
        return { type: "conflict" }
      }
      if (res.type === "not-found") {
        set(path, { saving: false, missing: true })
        mirror(path, (fs) => fs.markMissing(path))
        return { type: "missing" }
      }
      if (res.type === "error") {
        // FORK (REGRESSION FIX 2026-06-27): surface backend write failures
        // (e.g. atomicWrite post-rename mismatch on Windows + AV/OneDrive)
        // instead of leaving the editor in "saving=false" + FileStore in a
        // stale state. The UI banner + SaveFailed toast now react to this.
        set(path, { saving: false })
        return { type: "error" }
      }
      set(path, {
        baseline: { content: res.content, hash: res.stamp.hash },
        dirty: false,
        stale: false,
        conflict: false,
        missing: false,
        saving: false,
      })
      mirror(path, (fs) => fs.markClean(path, res.content, res.stamp))
      return res.formatted ? { type: "set", content: res.content } : { type: "none" }
    } catch {
      set(path, { saving: false })
      return { type: "error" }
    }
  }

  /** Throw away local edits; reset CM to the baseline. */
  function discard(path: string): DocEffect {
    const entry = state.entries[path]
    if (!entry) return { type: "none" }
    set(path, { dirty: false, stale: false, conflict: false })
    mirror(path, (fs) => fs.markClean(path, entry.baseline.content, { hash: entry.baseline.hash }))
    return { type: "set", content: entry.baseline.content }
  }

  /** Re-read from disk; replace baseline + CM doc. Discards local edits. */
  async function reload(path: string): Promise<DocEffect> {
    try {
      const res = await deps.readRaw(path)
      if (res.type === "not-found") {
        set(path, { missing: true })
        mirror(path, (fs) => fs.markMissing(path))
        return { type: "missing" }
      }
      setState("entries", path, freshEntry(res.content, res.stamp.hash))
      mirror(path, (fs) => fs.markClean(path, res.content, res.stamp))
      return { type: "set", content: res.content }
    } catch {
      set(path, { missing: true })
      mirror(path, (fs) => fs.markMissing(path))
      return { type: "missing" }
    }
  }

  // FORK (Phase 3.5, PLAN-EDITEUR-IDE-DEFINITIF): public alias for
  // `reload()` exposed to the command palette as "Revert File". Same
  // semantics — discard local edits, fetch disk bytes, reseed the
  // baseline and the FileStore. Renamed so the command palette title
  // matches user vocabulary (VS Code convention: "Revert File" reads
  // better than "Reload"). Idempotent.
  const revert = reload

  /** Resolve a 409 conflict: keep disk (reload) or force mine (overwrite). */
  async function resolveConflict(path: string, content: string, action: "reload" | "overwrite"): Promise<DocEffect> {
    if (action === "reload") return reload(path)
    try {
      const disk = await deps.readRaw(path)
      if (disk.type === "not-found") {
        set(path, { missing: true, conflict: false })
        mirror(path, (fs) => fs.markMissing(path))
        return { type: "missing" }
      }
      set(path, { baseline: { content: disk.content, hash: disk.stamp.hash }, conflict: false })
      return save(path, content)
    } catch {
      set(path, { missing: true, conflict: false })
      mirror(path, (fs) => fs.markMissing(path))
      return { type: "missing" }
    }
  }

  /**
   * External disk change for an open file (watcher). NEVER touches a dirty doc.
   * Returns the doc effect for the caller (reload only when clean).
   */
  async function onExternalChange(path: string): Promise<DocEffect> {
    const entry = state.entries[path]
    if (!entry) return { type: "none" }
    if (entry.saving) return { type: "none" } // our own write echoing back
    if (entry.dirty) {
      set(path, { stale: true }) // surfaces as a conflict on the next save
      mirror(path, (fs) => fs.markConflict(path))
      return { type: "none" }
    }
    return reload(path) // clean: safe to refresh
  }

  /** External delete/rename of an open file. Keep the buffer; offer recovery. */
  function onExternalDelete(path: string): DocEffect {
    if (!state.entries[path]) return { type: "none" }
    set(path, { missing: true })
    mirror(path, (fs) => fs.markMissing(path))
    return { type: "missing" }
  }

  function close(path: string) {
    setState(
      "entries",
      produce((entries) => {
        delete entries[path]
      }),
    )
    mirror(path, (fs) => fs.remove(path))
  }

  /**
   * Save WITHOUT a hash precondition — for recreating a file that was deleted on
   * disk while the buffer was dirty. Sends no `expectedHash` so the backend
   * creates/overwrites unconditionally (no 409 possible). The conflict flag is
   * cleared on success.
   */
  async function recreate(path: string, content: string, format?: boolean): Promise<DocEffect> {
    const entry = state.entries[path]
    if (!entry || entry.saving) return { type: "none" }
    set(path, { saving: true })
    mirror(path, (fs) => fs.markSaving(path))
    try {
      const res = await deps.write({ path, content, format })
      if (res.type === "conflict") {
        set(path, { saving: false, conflict: true })
        mirror(path, (fs) => fs.markConflict(path))
        return { type: "conflict" }
      }
      if (res.type === "not-found") {
        set(path, { saving: false, missing: true })
        mirror(path, (fs) => fs.markMissing(path))
        return { type: "missing" }
      }
      if (res.type === "error") {
        // See save() above.
        set(path, { saving: false })
        return { type: "error" }
      }
      set(path, {
        baseline: { content: res.content, hash: res.stamp.hash },
        dirty: false,
        stale: false,
        conflict: false,
        missing: false,
        saving: false,
      })
      mirror(path, (fs) => fs.markClean(path, res.content, res.stamp))
      return res.formatted ? { type: "set", content: res.content } : { type: "none" }
    } catch {
      set(path, { saving: false })
      return { type: "none" }
    }
  }

  return {
    state,
    get,
    open,
    setDirty,
    save,
    discard,
    reload,
    revert,
    resolveConflict,
    recreate,
    onExternalChange,
    onExternalDelete,
    close,
  }
}

export type EditorStore = ReturnType<typeof createEditorStore>
