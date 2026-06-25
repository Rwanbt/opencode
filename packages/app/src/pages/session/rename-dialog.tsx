// Rename dialog extracted from file-tabs.tsx (PLAN-EDITEUR-IDE-DEFINITIF Phase 2.5).
//
// WHY extracted: the dialog is a self-contained UI panel triggered by F2. It
// owns no global state of its own — the rename state, input, loading flag,
// and handlers live in file-tabs.tsx (the LSP callbacks reach `prepareRename`
// via closure), so this component is purely controlled.
//
// i18n: Phase 4.2 — all literal labels (previously hardcoded FR) resolve
// through language.t() with keys in en.ts/fr.ts. Behavior preserved 1:1.

import { Show } from "solid-js"
import { useLanguage } from "@/context/language"

export interface RenameState {
  word: string
  line: number
  character: number
}

export interface RenameDialogProps {
  state: () => RenameState | null
  input: () => string
  loading: () => boolean
  onInput: (value: string) => void
  onConfirm: () => void
  onCancel: () => void
}

export function RenameDialog(props: RenameDialogProps) {
  const language = useLanguage()
  return (
    <Show when={props.state()}>
      <div class="border-t border-border-weak-base bg-background-stronger px-3 py-2 flex items-center gap-2 shrink-0">
        <span class="text-11-regular text-text-weaker shrink-0">{language.t("rename.dialog.prompt")}</span>
        <input
          class="flex-1 bg-surface-base border border-border-weak-base rounded px-2 py-1 text-12-regular text-text-base outline-none focus:border-accent-primary"
          value={props.input()}
          onInput={(e) => props.onInput(e.currentTarget.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") props.onConfirm()
            if (e.key === "Escape") props.onCancel()
          }}
          ref={(el) => {
            setTimeout(() => {
              el.focus()
              el.select()
            }, 0)
          }}
          disabled={props.loading()}
          placeholder={language.t("rename.dialog.placeholder")}
        />
        <button
          type="button"
          disabled={props.loading() || !props.input().trim()}
          onClick={() => props.onConfirm()}
          class="text-10-regular px-2 py-1 rounded bg-accent-primary text-white disabled:opacity-40 shrink-0"
        >
          {props.loading() ? "…" : language.t("rename.dialog.confirm")}
        </button>
        <button
          type="button"
          onClick={() => props.onCancel()}
          class="text-10-regular text-text-weaker hover:text-text-base px-1 shrink-0"
          aria-label={language.t("common.cancel")}
        >
          ✕
        </button>
      </div>
    </Show>
  )
}