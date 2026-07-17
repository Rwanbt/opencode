// FORK: Stretch Phase 6 — Keyboard hints bar for tablet + hardware keyboard.
// Visible only when a fine pointer (mouse/keyboard) is detected on a touch device.
// Shows context-aware shortcuts for the active panel.
import { createMediaQuery } from "@solid-primitives/media"
import { createMemo, For, Show } from "solid-js"
import { useLayout } from "@/context/layout"
import { useLanguage } from "@/context/language"
import { useSessionLayout } from "@/pages/session/session-layout"

type Hint = { key: string; labelKey: string }

// Shortcuts that are always relevant in the editor/file panel.
const EDITOR_HINTS: Hint[] = [
  { key: "Ctrl+S", labelKey: "keyboard.save" },
  { key: "Ctrl+Z", labelKey: "keyboard.undo" },
  { key: "Ctrl+F", labelKey: "keyboard.find" },
  { key: "Ctrl+\\", labelKey: "keyboard.split" },
  { key: "Ctrl+.", labelKey: "keyboard.actions" },
  { key: "F12", labelKey: "keyboard.definition" },
]

// Shortcuts relevant when focus is in the chat input.
const CHAT_HINTS: Hint[] = [
  { key: "Ctrl+↵", labelKey: "keyboard.send" },
  { key: "Esc", labelKey: "keyboard.cancel" },
  { key: "↑/↓", labelKey: "keyboard.history" },
  { key: "Ctrl+K", labelKey: "keyboard.newSession" },
]

// Shortcuts relevant in the terminal.
const TERMINAL_HINTS: Hint[] = [
  { key: "Ctrl+C", labelKey: "keyboard.interrupt" },
  { key: "Ctrl+L", labelKey: "keyboard.clear" },
  { key: "Ctrl+D", labelKey: "keyboard.eof" },
  { key: "Ctrl+T", labelKey: "keyboard.newTerminal" },
]

export function KeyboardHintsBar() {
  // Show only on touch devices that also have a fine pointer (tablet + physical keyboard/mouse).
  const isTouchDevice = createMediaQuery("(any-pointer: coarse)")
  const hasFinePointer = createMediaQuery("(any-pointer: fine)")
  const showBar = createMemo(() => isTouchDevice() && hasFinePointer())

  const layout = useLayout()
  const language = useLanguage()
  const { view } = useSessionLayout()

  // Terminal open → terminal hints; side panel (file tree/review) open → editor hints; else chat.
  const hints = createMemo<Hint[]>(() => {
    const v = view()
    if (v.terminal.opened()) return TERMINAL_HINTS
    if (layout.fileTree.opened() || v.reviewPanel.opened()) return EDITOR_HINTS
    return CHAT_HINTS
  })

  return (
    <Show when={showBar()}>
      <div
        role="toolbar"
        aria-label={language.t("common.keyboardShortcuts")}
        class="flex items-center gap-0 px-3 border-t border-border-weak-base bg-background-stronger overflow-x-auto scrollbar-none shrink-0"
        style={{ height: "28px" }}
      >
        <For each={hints()}>
          {(hint, i) => (
            <>
              <Show when={i() > 0}>
                <span class="text-border-weak-base mx-2 select-none">·</span>
              </Show>
              <div class="flex items-center gap-1.5 shrink-0">
                <kbd class="text-9-regular font-mono bg-surface-base border border-border-weak-base rounded px-1 py-0.5 text-text-weak leading-none select-none">
                  {hint.key}
                </kbd>
                <span class="text-10-regular text-text-weaker select-none">{language.t(hint.labelKey as Parameters<typeof language.t>[0])}</span>
              </div>
            </>
          )}
        </For>
      </div>
    </Show>
  )
}
