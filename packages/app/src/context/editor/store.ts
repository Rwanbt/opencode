import { createStore, produce } from "solid-js/store"

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

export interface EditorDeps {
  readRaw: (path: string) => Promise<ReadRawResult>
  write: (input: {
    path: string
    content: string
    expectedHash?: string
    format?: boolean
  }) => Promise<WriteResult>
}

/** What the caller (CM component) should do with the document after an action. */
export type DocEffect =
  | { type: "set"; content: string } // replace the CM doc with this content
  | { type: "none" } // leave the CM doc untouched
  | { type: "conflict" } // save blocked by 409 — show the conflict banner
  | { type: "missing" } // file gone on disk — show the delete-on-disk actions

function freshEntry(content: string, hash: string): EditorEntry {
  return { baseline: { content, hash }, dirty: false, stale: false, saving: false, conflict: false, missing: false }
}

export function createEditorStore(deps: EditorDeps) {
  const [state, setState] = createStore<{ entries: Record<string, EditorEntry> }>({ entries: {} })

  const get = (path: string): EditorEntry | undefined => state.entries[path]

  const set = (path: string, patch: Partial<EditorEntry>) =>
    setState(
      "entries",
      path,
      produce((entry) => {
        if (entry) Object.assign(entry, patch)
      }),
    )

  /** Load baseline for a file. Returns the content to seed the CM doc. */
  async function open(path: string): Promise<DocEffect> {
    const existing = state.entries[path]
    if (existing && !existing.missing) return { type: "set", content: existing.baseline.content }
    const res = await deps.readRaw(path)
    if (res.type === "not-found") {
      setState("entries", path, { ...freshEntry("", ""), missing: true })
      return { type: "missing" }
    }
    setState("entries", path, freshEntry(res.content, res.stamp.hash))
    return { type: "set", content: res.content }
  }

  /** CM reports whether its doc differs from the baseline. */
  function setDirty(path: string, dirty: boolean) {
    if (!state.entries[path]) return
    set(path, { dirty })
  }

  /** Save the current CM content with the hash precondition. */
  async function save(path: string, content: string, format?: boolean): Promise<DocEffect> {
    const entry = state.entries[path]
    if (!entry || entry.saving) return { type: "none" }
    set(path, { saving: true })
    const res = await deps.write({ path, content, expectedHash: entry.baseline.hash || undefined, format })
    if (res.type === "conflict") {
      set(path, { saving: false, conflict: true })
      return { type: "conflict" }
    }
    if (res.type === "not-found") {
      set(path, { saving: false, missing: true })
      return { type: "missing" }
    }
    set(path, {
      baseline: { content: res.content, hash: res.stamp.hash },
      dirty: false,
      stale: false,
      conflict: false,
      missing: false,
      saving: false,
    })
    // Reconcile the buffer only when the formatter changed the content on disk.
    return res.formatted ? { type: "set", content: res.content } : { type: "none" }
  }

  /** Throw away local edits; reset CM to the baseline. */
  function discard(path: string): DocEffect {
    const entry = state.entries[path]
    if (!entry) return { type: "none" }
    set(path, { dirty: false, stale: false, conflict: false })
    return { type: "set", content: entry.baseline.content }
  }

  /** Re-read from disk; replace baseline + CM doc. Discards local edits. */
  async function reload(path: string): Promise<DocEffect> {
    const res = await deps.readRaw(path)
    if (res.type === "not-found") {
      set(path, { missing: true })
      return { type: "missing" }
    }
    setState("entries", path, freshEntry(res.content, res.stamp.hash))
    return { type: "set", content: res.content }
  }

  /** Resolve a 409 conflict: keep disk (reload) or force mine (overwrite). */
  async function resolveConflict(path: string, content: string, action: "reload" | "overwrite"): Promise<DocEffect> {
    if (action === "reload") return reload(path)
    // overwrite: re-read to get the CURRENT disk hash, then force the write.
    const disk = await deps.readRaw(path)
    if (disk.type === "not-found") {
      set(path, { missing: true, conflict: false })
      return { type: "missing" }
    }
    set(path, { baseline: { content: disk.content, hash: disk.stamp.hash }, conflict: false })
    return save(path, content)
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
      return { type: "none" }
    }
    return reload(path) // clean: safe to refresh
  }

  /** External delete/rename of an open file. Keep the buffer; offer recovery. */
  function onExternalDelete(path: string): DocEffect {
    if (!state.entries[path]) return { type: "none" }
    set(path, { missing: true })
    return { type: "missing" }
  }

  function close(path: string) {
    setState(
      "entries",
      produce((entries) => {
        delete entries[path]
      }),
    )
  }

  return {
    state,
    get,
    open,
    setDirty,
    save,
    discard,
    reload,
    resolveConflict,
    onExternalChange,
    onExternalDelete,
    close,
  }
}

export type EditorStore = ReturnType<typeof createEditorStore>
