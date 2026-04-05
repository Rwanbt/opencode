import { createSignal, onMount } from "solid-js"
import { usePlatform } from "../../context/platform"

export interface MessageInputProps {
  onSend: (text: string) => void
  placeholder?: string
  disabled?: boolean
}

/**
 * Mobile-optimized message input with auto-growing textarea,
 * large touch targets, and haptic feedback on send.
 */
export function MobileMessageInput(props: MessageInputProps) {
  const platform = usePlatform()
  const [text, setText] = createSignal("")
  let textareaRef: HTMLTextAreaElement | undefined

  function autoResize() {
    if (!textareaRef) return
    textareaRef.style.height = "auto"
    textareaRef.style.height = Math.min(textareaRef.scrollHeight, 160) + "px"
  }

  function handleSend() {
    const value = text().trim()
    if (!value || props.disabled) return

    // Haptic feedback on mobile
    if (platform.platform === "mobile") {
      (platform as any).hapticFeedback?.("light")
    }

    props.onSend(value)
    setText("")
    if (textareaRef) {
      textareaRef.style.height = "auto"
    }
  }

  function handleKeyDown(e: KeyboardEvent) {
    // Send on Enter (without Shift)
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  return (
    <div
      class="flex items-end gap-2 px-3 py-2 border-t bg-surface"
      style={{ "padding-bottom": "max(8px, var(--safe-area-bottom, 0px))" }}
    >
      {/* Attach button placeholder */}
      <button
        class="flex-none w-10 h-10 flex items-center justify-center rounded-full text-secondary active:bg-secondary/10"
        aria-label="Attach file"
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M21.44 11.05l-9.19 9.19a6 6 0 01-8.49-8.49l9.19-9.19a4 4 0 015.66 5.66l-9.2 9.19a2 2 0 01-2.83-2.83l8.49-8.48" />
        </svg>
      </button>

      {/* Auto-growing textarea */}
      <textarea
        ref={textareaRef}
        class="flex-1 resize-none rounded-2xl border px-4 py-2.5 text-sm bg-background focus:outline-none focus:ring-1 focus:ring-primary min-h-[40px] max-h-[160px]"
        placeholder={props.placeholder ?? "Message..."}
        value={text()}
        disabled={props.disabled}
        rows={1}
        onInput={(e) => {
          setText(e.currentTarget.value)
          autoResize()
        }}
        onKeyDown={handleKeyDown}
      />

      {/* Send button */}
      <button
        class={`flex-none w-10 h-10 flex items-center justify-center rounded-full transition-colors ${
          text().trim() && !props.disabled
            ? "bg-primary text-white active:bg-primary/80"
            : "bg-secondary/20 text-secondary"
        }`}
        disabled={!text().trim() || props.disabled}
        onClick={handleSend}
        aria-label="Send message"
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
          <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z" />
        </svg>
      </button>
    </div>
  )
}
