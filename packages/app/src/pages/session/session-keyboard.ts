/**
 * Factory for keyboard event handling in the session page.
 * Extracted from session.tsx to keep that file under the 1500-LOC budget.
 */
import { shouldFocusTerminalOnKeyDown, focusTerminalById } from "@/pages/session/helpers"
import type { useDialog } from "@opencode-ai/ui/context/dialog"
import type { useTerminal } from "@/context/terminal"

interface KeyboardHandlerDeps {
  dialog: ReturnType<typeof useDialog>
  view: () => { terminal: { opened: () => boolean } }
  terminal: ReturnType<typeof useTerminal>
  composer: { blocked: () => boolean }
  getInputRef: () => HTMLDivElement | undefined
  markScrollGesture: () => void
}

export function createKeyboardHandler(deps: KeyboardHandlerDeps) {
  const { dialog, view, terminal, composer, getInputRef, markScrollGesture } = deps

  const isEditableTarget = (target: EventTarget | null | undefined) => {
    if (!(target instanceof HTMLElement)) return false
    return /^(INPUT|TEXTAREA|SELECT|BUTTON)$/.test(target.tagName) || target.isContentEditable
  }

  const deepActiveElement = () => {
    let current: Element | null = document.activeElement
    while (current instanceof HTMLElement && current.shadowRoot?.activeElement) {
      current = current.shadowRoot.activeElement
    }
    return current instanceof HTMLElement ? current : undefined
  }

  const handleKeyDown = (event: KeyboardEvent) => {
    const path = event.composedPath()
    const target = path.find((item): item is HTMLElement => item instanceof HTMLElement)
    const activeElement = deepActiveElement()

    const protectedTarget = path.some(
      (item) => item instanceof HTMLElement && item.closest("[data-prevent-autofocus]") !== null,
    )
    if (protectedTarget || isEditableTarget(target)) return

    if (activeElement) {
      const isProtected = activeElement.closest("[data-prevent-autofocus]")
      const isInput = isEditableTarget(activeElement)
      if (isProtected || isInput) return
    }
    if (dialog.active) return

    const inputRef = getInputRef()
    if (activeElement === inputRef) {
      if (event.key === "Escape") inputRef?.blur()
      return
    }

    // Prefer the open terminal over the composer when it can take focus
    if (view().terminal.opened()) {
      const id = terminal.active()
      if (id && shouldFocusTerminalOnKeyDown(event) && focusTerminalById(id)) return
    }

    // Only treat explicit scroll keys as potential "user scroll" gestures.
    if (event.key === "PageUp" || event.key === "PageDown" || event.key === "Home" || event.key === "End") {
      markScrollGesture()
      return
    }

    if (event.key.length === 1 && event.key !== "Unidentified" && !(event.ctrlKey || event.metaKey)) {
      if (composer.blocked()) return
      inputRef?.focus()
    }
  }

  return { handleKeyDown, isEditableTarget, deepActiveElement }
}
