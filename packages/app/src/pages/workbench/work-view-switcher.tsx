/* SPDX-License-Identifier: MIT */

// =============================================================================
// pages/workbench/work-view-switcher.tsx — A5-03
//
// The Work surface's tab bar, mirroring Design's tablist/tab ARIA and
// data-attribute convention (design-workspace.tsx) so both surfaces read the
// same way to assistive tech and to e2e selectors — but built on a fixed
// array of views (work-view.ts), not Design's dynamic open/close tab state.
//
// `views` (not always WORK_VIEWS) lets the Work surface ship tabs
// incrementally as each view's real content lands, rather than rendering a
// tab that opens onto a "coming soon" placeholder.
// =============================================================================

import { For, type JSX } from "solid-js"
import { useLanguage } from "@/context/language"
import type { WorkView } from "@/pages/workbench/work-view"

const VIEW_ICON: Record<WorkView, string> = {
  overview: "☼",
  tasks: "✓",
  board: "▦",
  timeline: "⌁",
  activity: "◷",
  runs: "▶",
}

const VIEW_LABEL_KEY: Record<WorkView, string> = {
  overview: "workbench.work.view.overview",
  tasks: "workbench.work.view.tasks",
  board: "workbench.work.view.board",
  timeline: "workbench.work.view.timeline",
  activity: "workbench.work.view.activity",
  runs: "workbench.work.view.runs",
}

export interface WorkViewSwitcherProps {
  readonly views: readonly WorkView[]
  readonly active: WorkView
  readonly onSelect: (view: WorkView) => void
}

export function WorkViewSwitcher(props: WorkViewSwitcherProps): JSX.Element {
  const language = useLanguage()
  const t = language.t

  return (
    <div
      class="flex items-center gap-1 border-b border-border-base"
      role="tablist"
      aria-label={t("workbench.work.view.tablistLabel")}
      data-work-view-tablist
    >
      <For each={props.views}>
        {(view) => (
          <button
            type="button"
            role="tab"
            aria-selected={view === props.active}
            class="flex h-9 items-center gap-2 rounded-t px-3 text-12-medium transition-colors"
            classList={{
              "bg-background-stronger text-text-base": view === props.active,
              "text-text-weak hover:bg-background-base": view !== props.active,
            }}
            data-work-view={view}
            onClick={() => props.onSelect(view)}
          >
            <span aria-hidden="true">{VIEW_ICON[view]}</span>
            <span>{t(VIEW_LABEL_KEY[view])}</span>
          </button>
        )}
      </For>
    </div>
  )
}
