/**
 * Factory for the PromptInput keyboard event handler.
 *
 * Extracted from prompt-input.tsx to keep that file under the 1500-LOC
 * governance budget. All state is accessed via the deps object rather than
 * direct closure over component locals.
 */
import type { ContentPart, Prompt } from "@/context/prompt"
import { getCursorPosition } from "./editor-dom"
import { canNavigateHistoryAtCursor } from "./history"

export interface PromptKeyDownDeps {
  /** Returns the contenteditable editor element. */
  getEditorRef: () => HTMLDivElement
  /** Current mode (normal | shell). */
  getMode: () => "normal" | "shell"
  /** Set the current mode. */
  setMode: (v: "normal" | "shell") => void
  /** Current popover state (at | slash | null). */
  getPopover: () => "at" | "slash" | null
  /** Current history navigation index (−1 = not navigating). */
  getHistoryIndex: () => number
  /** Trigger the file-picker (Ctrl+U / Cmd+U). */
  pick: () => void
  /** Close the active at/@-mention or slash popover. */
  closePopover: () => void
  /** Whether a session is currently running. */
  working: () => boolean
  /** Abort the running session. */
  abort: () => void
  /** Returns true if Escape should blur the editor (macOS desktop). */
  escBlur: () => boolean
  /** Returns the current caret state. */
  getCaretState: () => { collapsed: boolean; cursorPosition: number; textLength: number }
  /** Append a content part to the prompt. */
  addPart: (part: ContentPart) => void
  /** Returns the current prompt parts. */
  getCurrentPrompt: () => Prompt
  /** Returns the image attachment parts (for send-guard). */
  imageAttachments: () => unknown[]
  /** Number of context items with a comment. */
  commentCount: () => number
  /** True if an IME composition is in progress. */
  isImeComposing: (event: KeyboardEvent) => boolean
  /** Select the currently highlighted item in the active popover. */
  selectPopoverActive: () => void
  /** Forward keyboard events to the @-mention filtered list. */
  atOnKeyDown: (event: KeyboardEvent) => void
  /** Forward keyboard events to the slash-command filtered list. */
  slashOnKeyDown: (event: KeyboardEvent) => void
  /** Navigate prompt history up/down; returns true if navigation occurred. */
  navigateHistory: (direction: "up" | "down") => boolean
  /** Submit the current prompt. */
  handleSubmit: (event: KeyboardEvent) => void
}

/**
 * Returns the `onKeyDown` handler for the PromptInput editor.
 *
 * Called once during component setup; the returned function is stable for the
 * lifetime of the component.
 */
export function createKeyDownHandler(deps: PromptKeyDownDeps) {
  return (event: KeyboardEvent) => {
    if ((event.metaKey || event.ctrlKey) && !event.altKey && !event.shiftKey && event.key.toLowerCase() === "u") {
      event.preventDefault()
      if (deps.getMode() !== "normal") return
      deps.pick()
      return
    }

    if (event.key === "Backspace") {
      const selection = window.getSelection()
      if (selection && selection.isCollapsed) {
        const node = selection.anchorNode
        const offset = selection.anchorOffset
        if (node && node.nodeType === Node.TEXT_NODE) {
          const text = node.textContent ?? ""
          if (/^​+$/.test(text) && offset > 0) {
            const range = document.createRange()
            range.setStart(node, 0)
            range.collapse(true)
            selection.removeAllRanges()
            selection.addRange(range)
          }
        }
      }
    }

    if (event.key === "!" && deps.getMode() === "normal") {
      const cursorPosition = getCursorPosition(deps.getEditorRef())
      if (cursorPosition === 0) {
        deps.setMode("shell")
        deps.closePopover()
        event.preventDefault()
        return
      }
    }

    if (event.key === "Escape") {
      if (deps.getPopover()) {
        deps.closePopover()
        event.preventDefault()
        event.stopPropagation()
        return
      }

      if (deps.getMode() === "shell") {
        deps.setMode("normal")
        event.preventDefault()
        event.stopPropagation()
        return
      }

      if (deps.working()) {
        deps.abort()
        event.preventDefault()
        event.stopPropagation()
        return
      }

      if (deps.escBlur()) {
        deps.getEditorRef().blur()
        event.preventDefault()
        event.stopPropagation()
        return
      }
    }

    if (deps.getMode() === "shell") {
      const { collapsed, cursorPosition, textLength } = deps.getCaretState()
      if (event.key === "Backspace" && collapsed && cursorPosition === 0 && textLength === 0) {
        deps.setMode("normal")
        event.preventDefault()
        return
      }
    }

    // Handle Shift+Enter BEFORE IME check - Shift+Enter is never used for IME input
    // and should always insert a newline regardless of composition state
    if (event.key === "Enter" && event.shiftKey) {
      deps.addPart({ type: "text", content: "\n", start: 0, end: 0 })
      event.preventDefault()
      return
    }

    if (event.key === "Enter" && deps.isImeComposing(event)) {
      return
    }

    const ctrl = event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey

    if (deps.getPopover()) {
      if (event.key === "Tab") {
        deps.selectPopoverActive()
        event.preventDefault()
        return
      }
      const nav = event.key === "ArrowUp" || event.key === "ArrowDown" || event.key === "Enter"
      const ctrlNav = ctrl && (event.key === "n" || event.key === "p")
      if (nav || ctrlNav) {
        if (deps.getPopover() === "at") {
          deps.atOnKeyDown(event)
          event.preventDefault()
          return
        }
        if (deps.getPopover() === "slash") {
          deps.slashOnKeyDown(event)
        }
        event.preventDefault()
        return
      }
    }

    if (ctrl && event.code === "KeyG") {
      if (deps.getPopover()) {
        deps.closePopover()
        event.preventDefault()
        return
      }
      if (deps.working()) {
        deps.abort()
        event.preventDefault()
      }
      return
    }

    if (event.key === "ArrowUp" || event.key === "ArrowDown") {
      if (event.altKey || event.ctrlKey || event.metaKey) return
      const { collapsed } = deps.getCaretState()
      if (!collapsed) return

      const cursorPosition = getCursorPosition(deps.getEditorRef())
      const textContent = deps
        .getCurrentPrompt()
        .map((part) => ("content" in part ? part.content : ""))
        .join("")
      const direction = event.key === "ArrowUp" ? "up" : "down"
      if (!canNavigateHistoryAtCursor(direction, textContent, cursorPosition, deps.getHistoryIndex() >= 0)) return
      if (deps.navigateHistory(direction)) {
        event.preventDefault()
      }
      return
    }

    // Note: Shift+Enter is handled earlier, before IME check
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault()
      if (event.repeat) return
      if (
        deps.working() &&
        deps
          .getCurrentPrompt()
          .map((part) => ("content" in part ? part.content : ""))
          .join("")
          .trim().length === 0 &&
        deps.imageAttachments().length === 0 &&
        deps.commentCount() === 0
      ) {
        return
      }
      deps.handleSubmit(event)
    }
  }
}
