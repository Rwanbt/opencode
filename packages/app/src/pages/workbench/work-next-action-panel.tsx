/* SPDX-License-Identifier: MIT */

// =============================================================================
// pages/workbench/work-next-action-panel.tsx — A5-02
//
// Replaces the v110 mockup's "Next safe action" panel: the mockup's
// confidence/agentic-load sliders (values 78/42) are bound to nothing real
// anywhere in the app. This shows the actual next task the DAG says should
// run — the honest analog of "what's safe to do next" — or an explicit "not
// available" state when there is none, never a fabricated score.
// =============================================================================

import { Show, type JSX } from "solid-js"
import type { TeamGraphTask } from "@unifia/ui/team-graph"
import { useLanguage } from "@/context/language"
import { nextActionableTask } from "@/pages/workbench/work-team"

export interface WorkNextActionPanelProps {
  readonly tasks: readonly TeamGraphTask[]
}

export function WorkNextActionPanel(props: WorkNextActionPanelProps): JSX.Element {
  const language = useLanguage()
  const t = language.t
  const next = () => nextActionableTask(props.tasks)

  return (
    <div class="rounded-lg border border-border-base bg-background-stronger p-4" data-v110="work-next-action-panel">
      <h2 class="text-14-medium">{t("workbench.work.nextActionTitle")}</h2>
      <div class="mt-3">
        <Show
          when={next()}
          fallback={<p class="text-12-regular text-text-weak">{t("workbench.work.nextActionEmpty")}</p>}
        >
          {(task) => (
            <p class="text-12-regular text-text-weak">
              {t("workbench.work.nextActionTask", { taskId: task().taskId })}
            </p>
          )}
        </Show>
      </div>
    </div>
  )
}
