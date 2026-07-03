// FORK: ADR-0005 Phase 6 — Command Palette overlay.
// Opened via mod+shift+p (DEFAULT_PALETTE_KEYBIND). Uses Portal + direct signal from
// command context to avoid circular dep (this file imports command.tsx, never the reverse).
import {
  createEffect,
  createMemo,
  createSignal,
  For,
  on,
  onCleanup,
  onMount,
  Show,
  type Component,
} from "solid-js"
import { Portal } from "solid-js/web"
import { Icon } from "@opencode-ai/ui/icon"
import { useCommand, formatKeybind } from "@/context/command"

// ─── Mount point (always rendered, conditionally visible) ───────────────────

export const CommandPaletteMount: Component = () => {
  const command = useCommand()
  return (
    <Show when={command.paletteOpen()}>
      <CommandPaletteOverlay />
    </Show>
  )
}

// ─── Overlay ────────────────────────────────────────────────────────────────

const CommandPaletteOverlay: Component = () => {
  const command = useCommand()
  const [query, setQuery] = createSignal("")
  const [activeIndex, setActiveIndex] = createSignal(0)

  let inputRef!: HTMLInputElement
  let listRef!: HTMLDivElement

  // Suspend all other keybinds while palette is visible
  onMount(() => {
    command.keybinds(false)
    inputRef?.focus()
  })
  onCleanup(() => command.keybinds(true))

  const allOptions = createMemo(() =>
    command.options.filter((opt) => !opt.id.startsWith("suggested.") && !opt.disabled),
  )

  const filtered = createMemo(() => {
    const q = query().toLowerCase().trim()
    if (!q) return allOptions()
    return allOptions().filter(
      (opt) =>
        opt.title.toLowerCase().includes(q) ||
        opt.description?.toLowerCase().includes(q) ||
        opt.category?.toLowerCase().includes(q),
    )
  })

  // Reset selection when filter changes
  createEffect(on(filtered, () => setActiveIndex(0)))

  // Scroll active item into view
  createEffect(() => {
    const idx = activeIndex()
    const item = listRef?.children[idx] as HTMLElement | undefined
    item?.scrollIntoView({ block: "nearest" })
  })

  const close = () => command.closePalette()

  const select = (idx: number) => {
    const opt = filtered()[idx]
    if (!opt) return
    close()
    opt.onSelect?.("palette")
  }

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault()
      close()
    } else if (e.key === "ArrowDown") {
      e.preventDefault()
      setActiveIndex((i) => Math.min(i + 1, filtered().length - 1))
    } else if (e.key === "ArrowUp") {
      e.preventDefault()
      setActiveIndex((i) => Math.max(i - 1, 0))
    } else if (e.key === "Enter") {
      e.preventDefault()
      select(activeIndex())
    } else if (e.key === "Tab") {
      e.preventDefault()
      if (e.shiftKey) {
        setActiveIndex((i) => Math.max(i - 1, 0))
      } else {
        setActiveIndex((i) => Math.min(i + 1, filtered().length - 1))
      }
    }
  }

  return (
    <Portal>
      {/* Backdrop. NO aria-hidden here: this wrapper CONTAINS the palette
          panel (role=dialog + focused input) — aria-hidden on an ancestor
          removes the whole palette from the accessibility tree (screen
          readers and getByRole can't see it, and hiding a focused element
          violates aria-hidden semantics). */}
      <div
        class="fixed inset-0 z-50 bg-black/50 flex items-start justify-center pt-[8vh]"
        onClick={close}
      >
        {/* Panel — stop propagation so backdrop click doesn't close when clicking inside */}
        <div
          class="w-[560px] max-w-[calc(100vw-2rem)] max-h-[65vh] rounded-xl shadow-2xl border border-border-base bg-bg-base flex flex-col overflow-hidden"
          onClick={(e) => e.stopPropagation()}
          role="dialog"
          aria-modal="true"
          aria-label="Command palette"
        >
          {/* Search row */}
          <div class="flex items-center gap-3 px-4 py-3 border-b border-border-weak-base">
            <Icon name="magnifying-glass" class="w-4 h-4 text-text-weaker shrink-0" />
            <input
              ref={inputRef!}
              type="text"
              class="flex-1 bg-transparent text-14-regular text-text-base outline-none placeholder:text-text-weaker"
              placeholder="Rechercher une commande…"
              value={query()}
              onInput={(e) => setQuery(e.currentTarget.value)}
              onKeyDown={handleKeyDown}
              aria-autocomplete="list"
              aria-label="Rechercher une commande"
              autocomplete="off"
              spellcheck={false}
            />
            <kbd class="shrink-0 text-11-regular text-text-weaker bg-surface-base px-1.5 py-0.5 rounded border border-border-weak-base">
              Esc
            </kbd>
          </div>

          {/* Command list */}
          <div ref={listRef!} class="overflow-y-auto flex-1 min-h-0 py-1" role="listbox">
            <Show
              when={filtered().length > 0}
              fallback={
                <div class="text-13-regular text-text-weaker text-center py-10">
                  Aucune commande trouvée
                </div>
              }
            >
              <For each={filtered()}>
                {(opt, i) => (
                  <button
                    type="button"
                    class="w-full flex items-center justify-between px-4 py-2.5 text-left gap-3 transition-colors"
                    classList={{
                      "bg-surface-strong": i() === activeIndex(),
                      "hover:bg-surface-base": i() !== activeIndex(),
                    }}
                    onClick={() => select(i())}
                    onMouseEnter={() => setActiveIndex(i())}
                    role="option"
                    aria-selected={i() === activeIndex()}
                  >
                    <div class="flex flex-col gap-0.5 flex-1 min-w-0">
                      <Show when={opt.category}>
                        <span class="text-10-regular text-text-weaker uppercase tracking-wider truncate">
                          {opt.category}
                        </span>
                      </Show>
                      <span class="text-13-medium text-text-base truncate">{opt.title}</span>
                      <Show when={opt.description}>
                        <span class="text-11-regular text-text-weaker truncate">{opt.description}</span>
                      </Show>
                    </div>
                    <Show when={opt.keybind}>
                      <kbd class="text-11-regular text-text-weaker bg-surface-base px-1.5 py-0.5 rounded border border-border-weak-base shrink-0 font-mono whitespace-nowrap">
                        {formatKeybind(opt.keybind!)}
                      </kbd>
                    </Show>
                  </button>
                )}
              </For>
            </Show>
          </div>

          {/* Footer hints */}
          <div class="flex items-center gap-4 px-4 py-2 border-t border-border-weak-base text-11-regular text-text-weaker select-none">
            <span>↑↓ naviguer</span>
            <span>⏎ sélectionner</span>
            <span>Esc fermer</span>
          </div>
        </div>
      </div>
    </Portal>
  )
}
