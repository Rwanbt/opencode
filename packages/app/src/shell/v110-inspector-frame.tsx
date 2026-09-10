/* SPDX-License-Identifier: MIT */

// A2-02 v110 inspector frame (Wave 0.5). Frame only, never content.
// WHY frame-only: COMPONENT-MAP 1 gives the shell ONE structural inspector
// authority (frame plus tabs), modes own content (A3 and later). The file
// explorer stays the single instance inside the session inspector content
// (data-v110 inspector-content): this file owns structure, never content.
// Tabs Explorer plus Inspector plus Execution mirror INTERACTIONS.md. Graph
// Memory stays a Memory sub-view, never a global tab. Sizes come from A1
// vars (v110-inspector). Open state stays owned by callers and persisted in
// context/layout (layout.v6): the frame is controlled, stores nothing.
// Not mounted yet: A3 branches mode content onto it. Mounting now would
// render a second inspector next to the session panel (P1-2).

import { For, type JSX } from "solid-js"

export const TABS = ["explorer", "inspector", "execution"] as const
export type Tab = (typeof TABS)[number]

export function normalizeTab(value: string | undefined): Tab {
  if (value === "inspector") return "inspector"
  if (value === "execution") return "execution"
  return "explorer"
}

type Props = {
  tab: Tab
  onTab: (tab: Tab) => void
  open: boolean
  onToggle: () => void
  label: string
  title: (tab: Tab) => string
  children: JSX.Element
}

export function InspectorFrame(props: Props): JSX.Element {
  const current = () => normalizeTab(props.tab)
  return (
    <aside
      data-v110="inspector-frame"
      data-component="v110-inspector-frame"
      role="complementary"
      aria-label={props.label}
      style={{ width: "var(--v110-inspector, 300px)" }}
    >
      <div role="tablist" aria-label={props.label} data-v110="inspector-tabs">
        <For each={TABS}>
          {(tab) => (
            <button
              type="button"
              role="tab"
              aria-selected={current() === tab}
              data-v110-tab={tab}
              onClick={() => props.onTab(tab)}
            >
              {props.title(tab)}
            </button>
          )}
        </For>
        <button
          type="button"
          aria-expanded={props.open}
          aria-controls="v110-inspector-panel"
          data-action="inspector-toggle"
          onClick={props.onToggle}
        >
          {props.open ? "\u2013" : "+"}
        </button>
      </div>
      <div id="v110-inspector-panel" role="tabpanel" hidden={!props.open}>
        {props.children}
      </div>
    </aside>
  )
}
