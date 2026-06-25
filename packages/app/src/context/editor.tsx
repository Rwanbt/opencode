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

const EditorContext = createContext<EditorStore>()

export function EditorProvider(props: { children: JSX.Element }) {
  const sdk = useSDK()
  const path = createPathHelpers(() => sdk.directory)
  const fileStore = useFileStore()

  // WHY: the global client uses throwOnError:true, so on any non-2xx the SDK
  // throws the parsed body BEFORE returning res — making res.response.status
  // unreachable and collapsing every error (409 conflict included) to
  // "not-found". A non-throwing client returns {data, response} where
  // response is the real Response on HTTP errors (undefined on network drop).
  const api = sdk.createClient({ throwOnError: false })

  const store = createEditorStore({
    fileStore,
    async readRaw(filePath) {
      const res = await api.file.readRaw({ path: filePath })
      if (!res.data) return { type: "not-found" }
      return { type: "ok", content: res.data.content, stamp: res.data.stamp }
    },

    async write({ path: filePath, content, expectedHash, format }) {
      const res = await api.file.write({ path: filePath, content, expectedHash, format })
      if (res.response?.status === 409) return { type: "conflict" }
      if (res.response?.status === 404) return { type: "not-found" }
      if (!res.data) return { type: "not-found" }
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

  return <EditorContext.Provider value={store}>{props.children}</EditorContext.Provider>
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
