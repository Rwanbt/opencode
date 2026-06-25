// FORK: EditorProvider + useEditor (ADR-0005, 1b-core).
// Bridges the editor store (pure state machine, no I/O) with the real SDK
// transport and the file watcher event stream. Lives inside SDKProvider so
// the store is scoped to the current directory — it resets when the directory
// changes because the whole SDKProvider subtree remounts.
import { createContext, onCleanup, useContext, type JSX } from "solid-js"
import { createPathHelpers } from "./file/path"
import { useSDK } from "./sdk"
import { useFileStore } from "./file/store"
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
