/* SPDX-License-Identifier: MIT */

import { For, type JSX } from "solid-js"
import type { Surface } from "./design-responsive"
import { useLanguage } from "@/context/language"

// V06 — a small accessible switcher for the mobile surface. The user
// picks Assistant or Atelier; the choice is persisted in the
// workspace store and survives a resize that crosses a breakpoint
// (pickMobileSurface restores the same value next time the viewport
// drops below 768px). The buttons are full-width, large enough for a
// finger (>=44x44), and announced as a group via the role and
// aria-label.

export function DesignSurfaceSwitcher(props: {
  surface: Surface
  onChange: (surface: Surface) => void
}): JSX.Element {
  const t = useLanguage().t
  const options: ReadonlyArray<{ id: Surface; label: string }> = [
    { id: "assistant", label: t("workbench.design.surface.assistant") },
    { id: "atelier", label: t("workbench.design.surface.atelier") },
  ]
  const moveFocus = (event: KeyboardEvent, current: Surface): void => {
    const currentIndex = options.findIndex((option) => option.id === current)
    let nextIndex: number | undefined
    if (event.key === "ArrowRight" || event.key === "ArrowDown") nextIndex = (currentIndex + 1) % options.length
    if (event.key === "ArrowLeft" || event.key === "ArrowUp") nextIndex = (currentIndex - 1 + options.length) % options.length
    if (event.key === "Home") nextIndex = 0
    if (event.key === "End") nextIndex = options.length - 1
    if (nextIndex === undefined) return

    event.preventDefault()
    const next = options[nextIndex]
    props.onChange(next.id)
    queueMicrotask(() => {
      document.querySelector<HTMLButtonElement>(`[data-design-surface-tab="${next.id}"]`)?.focus()
    })
  }
  return (
    <div
      role="tablist"
      aria-label={t("workbench.design.surfaceSwitcherLabel")}
      class="flex w-full gap-2 border-b border-border-base bg-background-base p-2"
      data-design-surface-switcher
    >
      <For each={options}>
        {(option) => (
          <button
            type="button"
            role="tab"
            aria-selected={props.surface === option.id ? "true" : "false"}
            tabindex={props.surface === option.id ? 0 : -1}
            class="min-h-11 flex-1 rounded border border-border-base px-3 py-2 text-14-medium aria-selected:border-border-focus aria-selected:bg-background-stronger"
            data-design-surface-tab={option.id}
            onClick={() => props.onChange(option.id)}
            onKeyDown={(event) => moveFocus(event, option.id)}
          >
            {option.label}
          </button>
        )}
      </For>
    </div>
  )
}
