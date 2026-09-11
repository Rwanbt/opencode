/* SPDX-License-Identifier: MIT */

// =============================================================================
// pages/workbench/work-hero.tsx — A5-01
//
// The Work surface's one genuinely new hero element: a real count of runs
// currently in flight, standing in for the v110 mockup's fixed "N agents
// actifs" text. The page's title/heading/description already exist in
// work-surface.tsx's own header — this only supplies the status badge next
// to it, rather than duplicating that copy in a second component.
// =============================================================================

import type { JSX } from "solid-js"
import { useLanguage } from "@/context/language"

export interface WorkHeroProps {
  readonly activeRunCount: number
}

export function WorkHero(props: WorkHeroProps): JSX.Element {
  const language = useLanguage()
  const t = language.t

  return (
    <span class="flex shrink-0 items-center gap-2 text-12-medium text-text-weak" data-v110="work-active-runs">
      <span
        class="size-2 rounded-full"
        classList={{ "bg-background-success": props.activeRunCount > 0, "bg-border-base": props.activeRunCount === 0 }}
      />
      {t("workbench.work.activeRuns", { count: props.activeRunCount })}
    </span>
  )
}
