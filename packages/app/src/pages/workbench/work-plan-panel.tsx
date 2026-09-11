/* SPDX-License-Identifier: MIT */

// =============================================================================
// pages/workbench/work-plan-panel.tsx — A5-01
//
// The v110 mockup's "Plan de travail" panel, built from the real DAG-team
// task graph (context/team.tsx + @unifia/ui/team-graph) instead of the
// mockup's own client-simulated task list. Tasks are labeled by their real
// taskId — the server never persists a human-readable title (see A5-01's
// plan), so this deliberately does not invent one.
// =============================================================================

import { Show, type JSX } from "solid-js"
import { TeamGraph, wavesFor, type TeamGraphTask } from "@unifia/ui/team-graph"
import { useLanguage } from "@/context/language"

export interface WorkPlanPanelProps {
  readonly tasks: readonly TeamGraphTask[]
  readonly percent: number
  readonly canRead: boolean
}

const STATUS_DOT_CLASS: Record<string, string> = {
  completed: "bg-background-success",
  running: "bg-background-info",
  blocked: "bg-background-danger",
  cancelled: "bg-border-base",
}

export function WorkPlanPanel(props: WorkPlanPanelProps): JSX.Element {
  const language = useLanguage()
  const t = language.t

  return (
    <div class="rounded-lg border border-border-base bg-background-stronger p-4" data-v110="work-plan-panel">
      <div class="flex items-center justify-between gap-2">
        <h2 class="text-14-medium">{t("workbench.work.planTitle")}</h2>
        <Show when={props.tasks.length > 0}>
          <span class="text-12-medium text-text-weak">
            {t("workbench.work.planProgress", { percent: props.percent })}
          </span>
        </Show>
      </div>
      <div class="mt-3">
        <Show
          when={props.canRead}
          fallback={
            <p role="status" class="text-12-regular text-text-weak">
              {t("team.lifecycle.unreachable")}
            </p>
          }
        >
          <Show
            when={props.tasks.length > 0}
            fallback={<p class="text-12-regular text-text-weak">{t("workbench.work.planEmpty")}</p>}
          >
            <TeamGraph label={t("team.graph.label")} waves={wavesFor(props.tasks)} tasks={props.tasks}>
              {(task) => (
                <span class="flex items-center gap-1.5 text-11-regular">
                  <span class={`size-1.5 rounded-full ${STATUS_DOT_CLASS[task.status] ?? "bg-border-base"}`} />
                  {task.taskId}
                </span>
              )}
            </TeamGraph>
          </Show>
        </Show>
      </div>
    </div>
  )
}
