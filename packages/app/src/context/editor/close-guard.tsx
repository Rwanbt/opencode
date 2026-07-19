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

import { createContext, createEffect, createSignal, useContext, type JSX } from "solid-js"
import { useParams } from "@solidjs/router"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { showToast } from "@opencode-ai/ui/toast"
import { useEditor } from "../editor"
import { useFileStore } from "../file/store"
import { useLanguage } from "../language"
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
  const language = useLanguage()
  const layout = useLayout()
  const sdk = useSDK()
  const dialog = useDialog()
  const params = useParams()
  const pathHelpers = createPathHelpers(() => sdk.directory)

  const sessionKey = () => `${params.dir}${params.id ? "/" + params.id : ""}`

  const [pending, setPending] = createSignal<Pending | null>(null)
  const [saving, setSaving] = createSignal(false)

  // FORK (PLAN-READONLY-VIEWER-REACTIVITY C11): editor.save() can return
  // {type:"busy"} when an autosave (or another concurrent save) is already
  // in flight for this path — nothing was attempted. Without this retry,
  // "Save and close" would fall through the conflict/missing/error check
  // below and close the tab as if the save had succeeded, silently
  // discarding the dirty buffer. Wait for the in-flight save to clear, then
  // retry with the freshest live content, same pattern as
  // editor-panel.tsx's handleCtrlS.
  const waitForSaveSlot = async (path: string, maxWaitMs = 5000) => {
    const start = Date.now()
    while (editor.get(path)?.saving) {
      if (Date.now() - start > maxWaitMs) return false
      await new Promise((resolve) => setTimeout(resolve, 50))
    }
    return true
  }

  const saveWithRetry = async (path: string, retriesLeft = 2) => {
    const live = fileStore.getDraftContent(path) ?? fileStore.get(path)?.content ?? ""
    const eff = await editor.save(path, live)
    if (eff.type !== "busy") return eff
    if (retriesLeft <= 0) return eff
    const free = await waitForSaveSlot(path)
    if (!free) return eff
    return saveWithRetry(path, retriesLeft - 1)
  }

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

  // WHY dialog.show(): DialogDirtyClose renders the custom <Dialog>
  // component (Kobalte.Content / Kobalte.Title / ...) which requires a
  // <Kobalte> root ancestor to provide DialogContext. That root only
  // exists inside the DialogProvider's <Show when={active}> branch, so
  // the dialog MUST be opened via dialog.show() rather than mounted
  // directly in this provider's JSX (which sits at boot and would
  // throw "useDialogContext must be used within a Dialog component"
  // on the first render).
  createEffect(() => {
    const p = pending()
    if (!p) return
    dialog.show(
      () => (
        <DialogDirtyClose
          path={p.path}
          saving={saving()}
          onCancel={() => {
            setSaving(false)
            setPending(null)
            dialog.close()
            p.resolve("cancelled")
          }}
          onDiscard={() => {
            setSaving(false)
            layout.tabs(sessionKey()).close(p.tab)
            setPending(null)
            dialog.close()
            p.resolve("closed")
          }}
          onSave={async () => {
            setSaving(true)
            // FORK (round 3, PLAN-FIX-CLOSE-GUARD-SAVE) — Fix A: prefer the
            // live CM content (registered as a getter in editor-panel.tsx) over
            // `FileStore.content` which is only the last-known baseline. The
            // previous implementation sent the baseline back to the backend,
            // producing a silent no-op write when expectedHash matched disk.
            // Fallback order: live CM → baseline (covers editor not yet
            // mounted, or tab close-guard fired before the getter effect ran).
            // FORK (C11): saveWithRetry re-reads the live content and retries
            // if a concurrent save (e.g. autosave) was already in flight —
            // see waitForSaveSlot/saveWithRetry above.
            const eff = await saveWithRetry(p.path)
            setSaving(false)
            // FORK (round 3, EC1) — Fix B: never close the tab if save failed.
            // A 409 (external edit), 404 (file deleted), or 500 (backend error)
            // must keep the tab open so the user can resolve via the existing
            // conflict/missing banner or retry. The previous implementation
            // closed the tab unconditionally, silently dropping the user's
            // edits in those cases. FORK (C11): "busy" (retries exhausted —
            // a save never released the path) must be treated the same way,
            // otherwise the tab closes as if saved while nothing was written.
            if (eff.type === "conflict" || eff.type === "missing" || eff.type === "error" || eff.type === "busy") {
              if (eff.type === "error") {
                showToast({ variant: "error", title: language.t("toast.file.saveFailed") })
              } else if (eff.type === "busy") {
                // FORK (CORRECTIF F10, 2026-07-19): unlike conflict/missing,
                // a busy give-up has no persistent EditorBanner — without a
                // toast, the dialog just closes with no feedback at all.
                // No "warning" ToastVariant exists (only default/success/
                // error/loading) — "default" is the correct non-error tone.
                showToast({ variant: "default", title: language.t("toast.file.saveBusy") })
              }
              // Banner conflict/missing is already shown by EditorBanner via
              // the reactive editorEntry. Order matters: setPending(null)
              // BEFORE dialog.close() so the dialog.onClose callback sees
              // pending === null and does not double-resolve the promise.
              setPending(null)
              dialog.close()
              p.resolve("cancelled")
              return
            }
            layout.tabs(sessionKey()).close(p.tab)
            setPending(null)
            dialog.close()
            p.resolve("closed")
          }}
        />
      ),
      () => {
        // Dialog closed via Escape / overlay click / programmatic close.
        // Cancel any still-pending close so callers don't hang on a
        // promise that will never resolve.
        const cur = pending()
        if (!cur) return
        setSaving(false)
        setPending(null)
        cur.resolve("cancelled")
      },
    )
  })

  return (
    <Ctx.Provider value={api}>
      {props.children}
    </Ctx.Provider>
  )
}

export function useEditorCloseGuard(): EditorCloseGuard {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error("useEditorCloseGuard() must be called within <EditorCloseGuardProvider>")
  return ctx
}