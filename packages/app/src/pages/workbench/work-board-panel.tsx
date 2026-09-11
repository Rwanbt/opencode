/* SPDX-License-Identifier: MIT */

// =============================================================================
// pages/workbench/work-board-panel.tsx — A5-04
//
// The v110 mockup's Board view, ported onto the real 6-value task status
// enum (no fictional "Review" column — see work-board.ts). Cards show only
// persisted fields: taskId, status, dependency count — no title/description/
// assignee/priority, none of which the server stores (TaskSchema,
// packages/unifia/src/server/routes/team.ts:84-92).
//
// The grab handle is visually present for layout fidelity with the mockup,
// but there is no HTTP capability to change a task's status (confirmed —
// see issue #86), so interacting with it surfaces that fact instead of
// performing a fake local reorder. No @thisbeyond/solid-dnd wiring: building
// real cross-column drag machinery whose only possible outcome is a refusal
// isn't worth the complexity.
// =============================================================================

import { For, Show, createSignal, type JSX } from "solid-js"
import type { TeamGraphTask } from "@unifia/ui/team-graph"
import { useLanguage } from "@/context/language"
import { groupByColumn, KANBAN_COLUMNS, type KanbanColumn } from "@/pages/workbench/work-board"

export interface WorkBoardPanelProps {
  readonly tasks: readonly TeamGraphTask[]
}

const COLUMN_LABEL_KEY: Record<KanbanColumn, string> = {
  pending: "workbench.work.board.column.pending",
  assigned: "workbench.work.board.column.assigned",
  running: "workbench.work.board.column.running",
  blocked: "workbench.work.board.column.blocked",
  completed: "workbench.work.board.column.completed",
  cancelled: "workbench.work.board.column.cancelled",
}

export function WorkBoardPanel(props: WorkBoardPanelProps): JSX.Element {
  const language = useLanguage()
  const t = language.t
  const [notice, setNotice] = createSignal(false)
  const grouping = () => groupByColumn(props.tasks)

  return (
    <div data-v110="work-board-panel">
      <Show when={props.tasks.length === 0}>
        <p class="text-12-regular text-text-weak">{t("workbench.work.planEmpty")}</p>
      </Show>
      <Show when={notice()}>
        <p role="status" class="mb-3 text-12-regular text-text-weak">
          {t("workbench.work.board.dragNotSupported")}
        </p>
      </Show>
      <div class="grid grid-flow-col auto-cols-[minmax(180px,1fr)] gap-3 overflow-x-auto">
        <For each={KANBAN_COLUMNS}>
          {(column) => (
            <div
              class="rounded-lg border border-border-base bg-background-stronger p-3"
              data-v110="work-board-column"
              data-status={column}
            >
              <h3 class="text-12-medium text-text-weak">{t(COLUMN_LABEL_KEY[column])}</h3>
              <ul class="mt-2 flex flex-col gap-2">
                <For each={grouping()[column]}>
                  {(task) => (
                    <li
                      class="flex items-center gap-2 rounded border border-border-weak-base bg-background-base p-2 text-11-regular"
                      data-v110="work-board-card"
                    >
                      <button
                        type="button"
                        class="cursor-grab text-text-weaker"
                        aria-label={t("workbench.work.board.dragHandle")}
                        onClick={() => setNotice(true)}
                        onDragStart={(event) => {
                          event.preventDefault()
                          setNotice(true)
                        }}
                        draggable="true"
                      >
                        ⠿
                      </button>
                      <div class="flex flex-col">
                        <span class="text-text-base">{task.taskId}</span>
                        <Show when={task.dependsOn.length > 0}>
                          <span class="text-text-weaker">
                            {t("workbench.work.board.dependencyCount", { count: task.dependsOn.length })}
                          </span>
                        </Show>
                      </div>
                    </li>
                  )}
                </For>
              </ul>
            </div>
          )}
        </For>
      </div>
    </div>
  )
}
