// File tab keybindings extracted from file-tabs.tsx (PLAN-EDITEUR-IDE-DEFINITIF Phase 2.5).
//
// WHY extracted: the two keymap handlers (Ctrl+F for find-in-file, Ctrl+\ for
// split-pane toggle) are unrelated to the rest of FileTabContent. Pulling them
// out keeps the orchestrator focused on composition.
//
// `installFileKeybindings` registers the listeners as side-effects; it returns
// nothing (effects are torn down with the parent component scope).

import { createEffect } from "solid-js"
import { makeEventListener } from "@solid-primitives/event-listener"
import type { FileSearchHandle } from "@opencode-ai/ui/file"

export interface FileKeybindingsDeps {
  /** Tab id — used to gate the listener to the active tab (unless override). */
  tab: string
  /** When true, listen even if the tab isn't the active one (split-pane right panel). */
  override?: boolean
  /** True when the user is in edit mode — Ctrl+F is handled by CM in that case. */
  editing: () => boolean
  /** True when this is the active tab (false if split-pane is in override mode and active elsewhere). */
  isActiveTab: () => boolean
  /** Path of the file currently rendered (used for split-open). */
  path: () => string | undefined
  /** Search handle registration (set by ViewerPanel via `search.register`). */
  find: () => FileSearchHandle | null
  /** Session layout view handle (provides editorSplit). */
  view: () => { editorSplit: { tab: () => string | undefined; open: (tab: string) => void; close: () => void } }
}

export function installFileKeybindings(deps: FileKeybindingsDeps): void {
  // Ctrl+F (or Cmd+F): focus the in-file search box when not in edit mode
  // (CM's own searchKeymap handles Ctrl+F while editing — let it through).
  createEffect(() => {
    if (typeof window === "undefined") return

    const onKeyDown = (event: KeyboardEvent) => {
      if (!deps.override && !deps.isActiveTab()) return
      if (!(event.metaKey || event.ctrlKey) || event.altKey || event.shiftKey) return
      if (event.key.toLowerCase() !== "f") return
      if (deps.editing()) return
      event.preventDefault()
      event.stopPropagation()
      deps.find()?.focus()
    }

    makeEventListener(window, "keydown", onKeyDown, { capture: true })
  })

  // Ctrl+\ (or Cmd+\): toggle the split pane for the active tab (Stretch Phase 6).
  createEffect(() => {
    if (typeof window === "undefined") return
    const onSplitKey = (event: KeyboardEvent) => {
      if (!deps.override && !deps.isActiveTab()) return
      if (!(event.ctrlKey || event.metaKey) || event.key !== "\\") return
      event.preventDefault()
      event.stopPropagation()
      const splitView = deps.view().editorSplit
      if (splitView.tab()) {
        splitView.close()
      } else {
        const p = deps.path()
        if (p) splitView.open(deps.tab)
      }
    }
    makeEventListener(window, "keydown", onSplitKey, { capture: true })
  })
}