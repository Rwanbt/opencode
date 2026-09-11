/* SPDX-License-Identifier: MIT */

// =============================================================================
// pages/workbench/work-progress-panel.tsx — A5-01
//
// The v110 mockup's "Progression" panel: a real completed/total percentage
// plus mini-stats, all derived from context/team.tsx (no simulated numbers).
// "Gates ready" is the honest analog of the mockup's "Run prêt" — gates that
// are not blocking (verdict !== CHANGES_REQUESTED) for the active run.
// =============================================================================

import type { JSX } from "solid-js"
import { useLanguage } from "@/context/language"

export interface WorkProgressPanelProps {
  readonly percent: number
  readonly taskCount: number
  readonly runCount: number
  readonly gatesReadyCount: number
}

export function WorkProgressPanel(props: WorkProgressPanelProps): JSX.Element {
  const language = useLanguage()
  const t = language.t

  return (
    <div class="rounded-lg border border-border-base bg-background-stronger p-4" data-v110="work-progress-panel">
      <h2 class="text-14-medium">{t("workbench.work.progressTitle")}</h2>
      <div class="mt-3 h-2 overflow-hidden rounded-full bg-background-base">
        <div class="h-full rounded-full bg-background-success" style={{ width: `${props.percent}%` }} />
      </div>
      <div class="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-12-regular text-text-weak">
        <span>{t("workbench.work.progressTasks", { count: props.taskCount })}</span>
        <span>{t("workbench.work.progressRuns", { count: props.runCount })}</span>
        <span>{t("workbench.work.progressGatesReady", { count: props.gatesReadyCount })}</span>
      </div>
    </div>
  )
}
