import { createSignal, Show, type JSX } from "solid-js"

export interface NavDrawerProps {
  children: JSX.Element
  trigger?: JSX.Element
}

/**
 * Slide-in navigation drawer for mobile.
 * Opens via swipe from left edge or trigger button.
 */
export function NavDrawer(props: NavDrawerProps) {
  const [isOpen, setIsOpen] = createSignal(false)
  let touchStartX = 0
  let touchStartY = 0

  function onTouchStart(e: TouchEvent) {
    touchStartX = e.touches[0].clientX
    touchStartY = e.touches[0].clientY
  }

  function onTouchEnd(e: TouchEvent) {
    const dx = e.changedTouches[0].clientX - touchStartX
    const dy = Math.abs(e.changedTouches[0].clientY - touchStartY)
    // Open: swipe right from left edge (within 30px)
    if (!isOpen() && touchStartX < 30 && dx > 60 && dy < 50) {
      setIsOpen(true)
    }
    // Close: swipe left while open
    if (isOpen() && dx < -60 && dy < 50) {
      setIsOpen(false)
    }
  }

  return (
    <div
      class="relative h-full"
      onTouchStart={onTouchStart}
      onTouchEnd={onTouchEnd}
    >
      {/* Trigger button */}
      <Show when={props.trigger}>
        <div onClick={() => setIsOpen(true)}>{props.trigger}</div>
      </Show>

      {/* Backdrop */}
      <Show when={isOpen()}>
        <div
          class="fixed inset-0 bg-black/40 z-40 transition-opacity"
          onClick={() => setIsOpen(false)}
        />
      </Show>

      {/* Drawer panel */}
      <div
        class={`fixed top-0 left-0 h-full w-72 bg-surface z-50 shadow-xl transition-transform duration-200 ${
          isOpen() ? "translate-x-0" : "-translate-x-full"
        }`}
        style={{ "padding-top": "var(--safe-area-top, 0px)" }}
      >
        <div class="flex items-center justify-between px-4 py-3 border-b">
          <span class="font-semibold text-sm">OpenCode</span>
          <button
            class="text-secondary text-lg px-2"
            onClick={() => setIsOpen(false)}
          >
            ×
          </button>
        </div>
        <div class="overflow-auto h-full pb-20">
          {props.children}
        </div>
      </div>
    </div>
  )
}

export function useNavDrawer() {
  const [isOpen, setIsOpen] = createSignal(false)
  return {
    isOpen,
    open: () => setIsOpen(true),
    close: () => setIsOpen(false),
    toggle: () => setIsOpen((v) => !v),
  }
}
