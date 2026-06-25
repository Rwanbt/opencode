// Code actions panel extracted from file-tabs.tsx (PLAN-EDITEUR-IDE-DEFINITIF Phase 2.5).
//
// WHY extracted: the panel triggered by Ctrl+. is a self-contained UI fed by
// `codeActions` + `codeActionsLoading`. The fetch + apply logic stays in
// file-tabs.tsx (it needs the SDK URL + editor handle + showToast); this
// component only renders the list and exposes selection events.
//
// Translation note: hardcoded French labels preserved verbatim for behavior
// parity. i18n migration tracked in PLAN-EDITEUR-IDE-DEFINITIF §2 (R-code&conv).

import { For, Show } from "solid-js"
import type { LspCodeAction } from "@opencode-ai/ui/code-mirror-lsp"

export interface CodeActionPos {
  line: number
  character: number
  endLine: number
  endCharacter: number
}

export interface CodeActionsPanelProps {
  actions: () => LspCodeAction[]
  loading: () => boolean
  onSelect: (action: LspCodeAction) => void
  onClose: () => void
}

export function CodeActionsPanel(props: CodeActionsPanelProps) {
  return (
    <Show when={props.loading() || props.actions().length > 0}>
      <div class="border-t border-border-weak-base bg-background-stronger shrink-0">
        <div class="flex items-center gap-2 px-3 py-1 sticky top-0 bg-background-stronger border-b border-border-weak-base">
          <span class="text-11-regular text-text-weaker flex-1">
            Actions ({props.loading() ? "…" : props.actions().length})
          </span>
          <button
            type="button"
            onClick={() => props.onClose()}
            class="text-10-regular text-text-weaker hover:text-text-base px-1"
          >
            ✕
          </button>
        </div>
        <div class="max-h-48 overflow-y-auto">
          <Show when={props.loading()}>
            <p class="text-11-regular text-text-weaker px-3 py-2">Chargement…</p>
          </Show>
          <For each={props.actions()}>
            {(action) => (
              <button
                type="button"
                onClick={() => props.onSelect(action)}
                class="w-full text-left px-3 py-1.5 flex items-center gap-2 hover:bg-surface-hover"
              >
                <Show when={action.isPreferred}>
                  <span class="text-accent-primary text-10-regular shrink-0">✦</span>
                </Show>
                <span class="text-12-regular text-text-base flex-1 truncate">{action.title}</span>
                <Show when={action.kind}>
                  <span class="text-10-regular text-text-weakest shrink-0">{action.kind}</span>
                </Show>
              </button>
            )}
          </For>
        </div>
      </div>
    </Show>
  )
}