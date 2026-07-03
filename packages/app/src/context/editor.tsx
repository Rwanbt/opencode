// FORK: EditorProvider + useEditor (ADR-0005, 1b-core).
// Bridges the editor store (pure state machine, no I/O) with the real SDK
// transport and the file watcher event stream. Lives inside SDKProvider so
// the store is scoped to the current directory — it resets when the directory
// changes because the whole SDKProvider subtree remounts.
import { createContext, createEffect, onCleanup, useContext, type JSX } from "solid-js"
import { useParams } from "@solidjs/router"
import { createPathHelpers } from "./file/path"
import { useSDK } from "./sdk"
import { useFileStore } from "./file/store"
import { useLayout } from "./layout"
import { createEditorStore, type EditorStore } from "./editor/store"
import { EditorCloseGuardProvider } from "./editor/close-guard"

const EditorContext = createContext<EditorStore>()

export function EditorProvider(props: { children: JSX.Element }) {
  const sdk = useSDK()
  const path = createPathHelpers(() => sdk.directory)
  const fileStore = useFileStore()

  // FORK (ROOT-CAUSE FIX 2026-06-28): use sdk.client (directory-bound) for all
  // editor file I/O. A dedicated client was introduced in 40f49c0e5c to get
  // throwOnError:false, but `sdk.createClient({})` carries NO directory — so
  // the server resolved every write against the sidecar's process.cwd() and
  // saves landed in a phantom file outside the project (toast "Saved", disk
  // unchanged). sdk.client is now non-throwing by default AND carries the
  // current directory, so it is both correct and reactive (the memo re-creates
  // when the directory changes). Reads/writes go to the project the viewer
  // reads from. See Plan-Fix-Editor-Save-Directory-RootCause-2026-06-28.
  const store = createEditorStore({
    fileStore,
    async readRaw(filePath) {
      const res = await sdk.client.file.readRaw({ path: filePath })
      if (!res.data) return { type: "not-found" }
      return { type: "ok", content: res.data.content, stamp: res.data.stamp }
    },

    async write({ path: filePath, content, expectedHash, format }) {
      // FORK (REGRESSION FIX 2026-06-27, root-cause confirmed empirically):
      // The backend's overwrite guard refuses writes on existing files without
      // a matching expectedHash (returns 409 "expectedHash is required to
      // overwrite an existing file"). The editor store's baseline.hash can be
      // "" when the file was opened via fallbackContent or the open() raced
      // the file watcher, which sent undefined → 409 → "Saved" was silently
      // swallowed as not-found, leaving the on-disk file empty.
      //
      // Fetch the current disk stamp here so the backend's precondition can
      // validate against actual state. Cost: one extra readRaw on the cold
      // path only (the warm path keeps the existing expectedHash from caller).
      let effectiveHash = expectedHash
      if (!effectiveHash) {
        try {
          const raw = await sdk.client.file.readRaw({ path: filePath })
          if (raw.data?.stamp?.hash) effectiveHash = raw.data.stamp.hash
        } catch {
          // ignore — fall through; backend will 409 if a hash is genuinely required
        }
      }
      const res = await sdk.client.file.write({ path: filePath, content, expectedHash: effectiveHash, format })
      if (res.response?.status === 409) return { type: "conflict" }
      if (res.response?.status === 404) return { type: "not-found" }
      // FORK (REGRESSION FIX 2026-06-27): do NOT collapse 5xx and missing-body
      // responses to "not-found". The previous code mapped both to a phantom
      // not-found effect that bypassed the SaveFailed toast — the editor
      // surface then displayed "Saved" while the disk write had silently
      // failed (e.g. atomicWrite post-rename mismatch from FS caching). Return
      // an explicit error so the editor banner + toast can react.
      if (res.response && res.response.status >= 500) return { type: "error" }
      if (!res.data) return { type: "error" }
      return {
        type: "ok",
        content: res.data.content,
        stamp: res.data.stamp,
        formatted: res.data.formatted,
      }
    },
  })

  // Wire the server-side file watcher to the editor store so that agent edits
  // flowing in while the user is typing are handled correctly:
  //   • clean buffer  → reload (show agent's new content automatically)
  //   • dirty buffer  → stale  (surface a conflict banner on next save)
  //   • saving        → ignore (this is our own write echoing back)
  //   • deleted       → missing (show recovery actions)
  const stop = sdk.event.listen((e) => {
    if (e.details.type !== "file.watcher.updated") return
    const props = e.details.properties as { file?: string; event?: string } | undefined
    const rawPath = typeof props?.file === "string" ? props.file : undefined
    const kind = typeof props?.event === "string" ? props.event : undefined
    if (!rawPath || !kind) return

    const normalized = path.normalize(rawPath)
    // Ignore paths that didn't resolve to something inside the project, or
    // git internals that are never open in the editor.
    if (!normalized || normalized.startsWith(".git/")) return

    if (kind === "unlink") {
      store.onExternalDelete(normalized)
    } else {
      // "add" and "change" both count as external content updates.
      void store.onExternalChange(normalized)
    }
  })

  onCleanup(stop)

  // FORK (Phase 3.4): wrap children in EditorCloseGuardProvider so file
  // tabs gain the Save/Don't save/Cancel dialog on close. The guard reads
  // FileStore.status (set by this same store via mirror()) to decide
  // whether to pause and prompt.
  return (
    <EditorContext.Provider value={store}>
      <EditorCloseGuardProvider>{props.children}</EditorCloseGuardProvider>
    </EditorContext.Provider>
  )
}

export function useEditor(): EditorStore {
  const ctx = useContext(EditorContext)
  if (!ctx) throw new Error("useEditor() must be called within <EditorProvider>")
  return ctx
}

/**
 * Reactive glue between the layout tabs and the editor store (Phase 2.6).
 *
 * When a file tab disappears from `layout.tabs(sessionKey).all()`, drop the
 * matching entry from the editor store and (transitively, via the mirror
 * added in Phase 2.4c) from the shared FileStore. Without this, closing a
 * tab leaves a stale baseline hanging in the editor's in-memory state —
 * a later reopen of the same path would NOT re-read from disk because
 * `existing && !existing.missing` short-circuits in editor.open().
 *
 * Mounted INSIDE <EditorProvider> so it can grab `useEditor()`, but kept as
 * a separate component so it can also call `useLayout()` and `useParams()`
 * (the parent <EditorProvider> is intentionally unaware of router/layout).
 */
export function EditorTabCleanup() {
  const editor = useEditor()
  const layout = useLayout()
  const params = useParams()
  const sdk = useSDK()
  const path = createPathHelpers(() => sdk.directory)

  // sessionKey mirrors the same shape file.tsx uses (params.dir + optional
  // params.id). If the schema drifts, both contexts must drift together —
  // they index the SAME layout.sessionTabs[] entry.
  const sessionKey = () => `${params.dir}${params.id ? "/" + params.id : ""}`
  const all = layout.tabs(sessionKey).all

  let prev = new Set<string>()
  createEffect(() => {
    const next = new Set(all())
    for (const tab of prev) {
      if (next.has(tab)) continue
      const filePath = path.pathFromTab(tab)
      if (filePath) editor.close(filePath)
    }
    prev = next
  })

  return null
}
