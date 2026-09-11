/* SPDX-License-Identifier: MIT */

// =============================================================================
// pages/workbench/work-timeline-panel.tsx — A5-05
//
// The v110 mockup's Timeline view: the real Team event feed
// (context/team.tsx's details.events, backed by sdk.client.team.listEvents),
// in the append order the server already guarantees. describeEvent
// (work-events.ts) turns each event's real kind/payload into a translated
// sentence — no invented event types beyond the five the DAG executor
// actually emits.
// =============================================================================

import type { JSX } from "solid-js"
import { CollectionView } from "@/components/team/collection-view"
import { useLanguage } from "@/context/language"
import { useTeam } from "@/context/team"
import { describeEvent } from "@/pages/workbench/work-events"

export function WorkTimelinePanel(): JSX.Element {
  const language = useLanguage()
  const t = language.t
  const team = useTeam()

  return (
    <div data-v110="work-timeline-panel">
      <CollectionView
        page={team.details.events.page()}
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
            <div class="flex items-center gap-2 text-11-regular" data-v110="work-timeline-event">
              <span class="text-text-weaker">{event.occurredAt}</span>
              <span class="text-text-base">{t(described.key, described.params)}</span>
            </div>
          )
        }}
      </CollectionView>
    </div>
  )
}
