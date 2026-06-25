// FORK (Phase 3.4, PLAN-EDITEUR-IDE-DEFINITIF): dirty-close guard.
//
// Sits between the file tab UI (SortableTab / tab.close keybind) and
// layout.tabs().close(). When a tab close is requested for a file that
// FileStore reports as `status: "dirty"`, the guard pauses the close and
// shows a 3-button dialog (Save / Don't save / Cancel). Otherwise it
// forwards the close immediately.
//
// Controller + host in one provider: the dialog is rendered around the
// children, sharing scope with the API so the dialog handlers can resolve
// the close() promise without a module-level map.
//
// System tabs ("context", "review") bypass the guard — no FileStore entry
// to consult, no draft to lose.

import { createContext, createSignal, useContext, type JSX } from "solid-js"
import { useParams } from "@solidjs/router"
import { useEditor } from "../editor"
import { useFileStore } from "../file/store"
import { useLayout } from "../layout"
import { useSDK } from "../sdk"
import { createPathHelpers } from "../file/path"
import { shouldGuardDirtyClose, type DirtyCloseResult } from "./close-guard-helpers"
import { DialogDirtyClose } from "@/components/dialog-dirty-close"

export type { DirtyCloseResult } from "./close-guard-helpers"

export interface EditorCloseGuard {
  close: (tab: string) => Promise<DirtyCloseResult>
}

interface Pending {
  tab: string
  path: string
  resolve: (r: DirtyCloseResult) => void
}

const Ctx = createContext<EditorCloseGuard>()

export function EditorCloseGuardProvider(props: { children: JSX.Element }): JSX.Element {
  const editor = useEditor()
  const fileStore = useFileStore()
  const layout = useLayout()
  const sdk = useSDK()
  const params = useParams()
  const pathHelpers = createPathHelpers(() => sdk.directory)

  const sessionKey = () => `${params.dir}${params.id ? "/" + params.id : ""}`

  const [pending, setPending] = createSignal<Pending | null>(null)
  const [saving, setSaving] = createSignal(false)

  const api: EditorCloseGuard = {
    close(tab: string): Promise<DirtyCloseResult> {
      const filePath = tab === "context" || tab === "review" ? undefined : pathHelpers.pathFromTab(tab)
      const status = filePath ? fileStore.get(filePath)?.status : undefined
      if (!shouldGuardDirtyClose(tab, filePath, status)) {
        layout.tabs(sessionKey()).close(tab)
        return Promise.resolve("closed")
      }
      // Dirty — pause and show dialog.
      return new Promise<DirtyCloseResult>((resolve) => {
        setPending({ tab, path: filePath!, resolve })
      })
    },
  }

  return (
    <Ctx.Provider value={api}>
      {props.children}
      <DialogDirtyClose
        path={pending()?.path}
        open={pending() !== null}
        saving={saving()}
        onCancel={() => {
          const cur = pending()
          if (!cur) return
          setPending(null)
          setSaving(false)
          cur.resolve("cancelled")
        }}
        onDiscard={() => {
          const cur = pending()
          if (!cur) return
          setPending(null)
          setSaving(false)
          layout.tabs(sessionKey()).close(cur.tab)
          cur.resolve("closed")
        }}
        onSave={async () => {
          const cur = pending()
          if (!cur) return
          setSaving(true)
          // WHY content source: CM owns the live buffer in the editor
          // panel; FileStore.content is the last-known baseline. The CM
          // handle isn't reachable from this provider (Phase 4 can plumb
          // a ref through). Passing baseline is acceptable for now — the
          // server returns the canonical post-save content and the editor
          // reconciles via `set` effect.
          await editor.save(cur.path, fileStore.get(cur.path)?.content ?? "")
          setSaving(false)
          setPending(null)
          layout.tabs(sessionKey()).close(cur.tab)
          cur.resolve("closed")
        }}
      />
    </Ctx.Provider>
  )
}

export function useEditorCloseGuard(): EditorCloseGuard {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error("useEditorCloseGuard() must be called within <EditorCloseGuardProvider>")
  return ctx
}