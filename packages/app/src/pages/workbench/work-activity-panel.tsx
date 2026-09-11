/* SPDX-License-Identifier: MIT */

// =============================================================================
// pages/workbench/work-activity-panel.tsx — A5-05
//
// The v110 mockup's Activity view. Confirmed this is not a second real
// capability the mockup only assumes exists: it's the identical event feed
// Timeline shows (context/team.tsx's details.events), presented filtered by
// kind instead of purely chronological — one fetch, two presentations, no
// second query path for data that doesn't diverge.
// =============================================================================

import { createMemo, createSignal, For, type JSX } from "solid-js"
import { CollectionView } from "@/components/team/collection-view"
import { useLanguage } from "@/context/language"
import { useTeam } from "@/context/team"
import { describeEvent, EVENT_KINDS, type EventKind } from "@/pages/workbench/work-events"

const KIND_LABEL_KEY: Record<EventKind, string> = {
  "team.started": "workbench.work.event.kind.started",
  "team.budget_handoff": "workbench.work.event.kind.budgetHandoff",
  "team.task_finished": "workbench.work.event.kind.taskFinished",
  "team.final_validation": "workbench.work.event.kind.finalValidation",
  "team.runtime_failed": "workbench.work.event.kind.runtimeFailed",
}

export function WorkActivityPanel(): JSX.Element {
  const language = useLanguage()
  const t = language.t
  const team = useTeam()
  const [filter, setFilter] = createSignal<EventKind | "all">("all")

  const filteredPage = createMemo(() => {
    const page = team.details.events.page()
    if (filter() === "all") return page
    return { items: page.items.filter((event) => event.kind === filter()), nextCursor: page.nextCursor }
  })

  return (
    <div data-v110="work-activity-panel">
      <select
        class="mb-3 rounded border border-border-base bg-background-base px-2 py-1 text-12-regular"
        data-v110="work-activity-filter"
        value={filter()}
        onChange={(event) => setFilter(event.currentTarget.value as EventKind | "all")}
      >
        <option value="all">{t("workbench.work.activity.filterAll")}</option>
        <For each={EVENT_KINDS}>{(kind) => <option value={kind}>{t(KIND_LABEL_KEY[kind])}</option>}</For>
      </select>
      <CollectionView
        page={filteredPage()}
        reachability={team.details.events.reachability()}
        labels={{
          empty: t("workbench.work.timeline.empty"),
          unreachable: t("workbench.work.timeline.unreachable"),
          stale: t("workbench.work.timeline.stale"),
          more: t("workbench.work.timeline.more"),
        }}
        onMore={() => void team.details.events.more()}
      >
        {(event) => {
          const described = describeEvent(event.kind, event.payload)
          return (
            <div class="flex items-center gap-2 text-11-regular" data-v110="work-activity-event">
              <span class="text-text-weaker">{event.occurredAt}</span>
              <span class="text-text-base">{t(described.key, described.params)}</span>
            </div>
          )
        }}
      </CollectionView>
    </div>
  )
}
