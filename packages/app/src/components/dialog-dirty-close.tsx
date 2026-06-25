// FORK (Phase 3.4, PLAN-EDITEUR-IDE-DEFINITIF): confirmation dialog when
// the user attempts to close a tab whose file is in `status: "dirty"`.
//
// Three actions:
//   • Save        — caller invokes editor.save + closes; if save fails (409
//                   conflict or 404 missing), the tab stays open and the
//                   editor's existing banner surfaces the issue.
//   • Don't save  — closes the tab, dropping the in-memory draft. Disk is
//                   not touched; the next open() reads the unchanged bytes.
//   • Cancel      — closes the dialog, leaves the tab open.
//
// The dialog is a pure renderer: the controller (close-guard.tsx) owns the
// signal, the action promises, and the integration with FileStore + layout.

import { Button } from "@opencode-ai/ui/button"
import { Dialog } from "@opencode-ai/ui/dialog"
import { getFilename } from "@opencode-ai/util/path"
import { useLanguage } from "@/context/language"

export function DialogDirtyClose(props: {
  /** Canonical path of the dirty file. */
  path: string | undefined
  /** When true the dialog is visible. */
  open: boolean
  /** Disable the Save button while a save is in flight. */
  saving: boolean
  onSave: () => void
  onDiscard: () => void
  onCancel: () => void
}) {
  const language = useLanguage()
  return (
    <Dialog
      title={language.t("dialog.dirtyClose.title")}
      description={
        props.path
          ? language.t("dialog.dirtyClose.description", { name: getFilename(props.path) })
          : undefined
      }
    >
      <div class="flex justify-end gap-2 p-6 pt-0">
        <Button type="button" variant="ghost" onClick={props.onCancel} disabled={props.saving}>
          {language.t("dialog.dirtyClose.cancel")}
        </Button>
        <Button type="button" variant="ghost" onClick={props.onDiscard} disabled={props.saving}>
          {language.t("dialog.dirtyClose.discard")}
        </Button>
        <Button type="button" variant="primary" onClick={props.onSave} disabled={props.saving}>
          {props.saving ? language.t("toast.file.saving") : language.t("dialog.dirtyClose.save")}
        </Button>
      </div>
    </Dialog>
  )
}