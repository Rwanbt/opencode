// SPDX-License-Identifier: MIT
// A2-01 shell responsive adapter (Wave 0.5).
// WHY thin adapter next to tokens/viewport: tokens own the pure contract
// (classify/side/layouts, 1200/900/600 + landscape h<=560&w<=980).
// This module owns reactive wiring (window size -> viewport) only.
// Panel open state stays in context/layout (sidebar/fileTree/review,
// persistes layout.v6): no second panel store.
// Legacy 768/1024 (use-mobile-layout, design-responsive) documented in
// shell/v110-viewport (A2-03); shell reads only classify.
// Registry GAP-02: SHELL_MODES = code/work/design/automate (4). Browser,
// memory, settings, user are destinations, not modes: rail renders
// mode.modes (already automate-gated) + settings/user below, never 10.
// Automate GAP-03: single gate isAutomateAccessible on workflow.run via
// context/mode visibleModes. Browser GAP-01: shell only, no fake browser:
// DesignBrowserTab drives a real Tauri WebView (invoke), shell adds none.
// Inspector: shell owns frame (A2-02), modes own content; FileTree stays
// the single instance inside the inspector (session-side-panel).
import { createMemo, createSignal, onCleanup, onMount, type Accessor } from "solid-js"
import { classify, cohabit, exclusive, layouts, side, type Layout, type Viewport } from "@/tokens/viewport"
import { visible, type Panel } from "@/tokens/panels"
export type { Layout, Viewport }
type Size = { width: number; height: number }
function read(): Size {
  if (typeof window === "undefined") return { width: 1440, height: 900 }
  return { width: window.innerWidth, height: window.innerHeight }
}
// Reactive viewport id. Single responsive authority for the shell.
export function useViewport(): Accessor<Viewport> {
  const [size, setSize] = createSignal<Size>(read(), { equals: false })
  onMount(() => {
    const sync = () => setSize(read())
    window.addEventListener("resize", sync)
    window.addEventListener("orientationchange", sync)
    onCleanup(() => {
      window.removeEventListener("resize", sync)
      window.removeEventListener("orientationchange", sync)
    })
  })
  return createMemo(() => classify(size().width, size().height))
}
// Visible panels for one viewport (desktop-wide cohabits, desktop-compact
// keeps last opened, overlays render the stack last-on-top).
export function shown(open: Panel[], id: Viewport): Panel[] {
  return visible(open, id)
}
export function useShell(id: Accessor<Viewport>) {
  const kind = createMemo(() => side(id()))
  const modes = createMemo(() => layouts(id()))
  const wide = createMemo(() => cohabit(id()))
  const single = createMemo(() => exclusive(id()))
  return { kind, modes, wide, single }
}
