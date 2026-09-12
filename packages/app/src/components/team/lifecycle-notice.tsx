// =============================================================================
// components/team/lifecycle-notice.tsx — TEAM-M01
//
// Says why lifecycle controls are unavailable when the shared Team server
// cannot be reached.
// =============================================================================

import { Show } from "solid-js"
import type { TeamCapabilities } from "@/context/team"

export interface LifecycleNoticeProps {
  readonly capabilities: TeamCapabilities
  /**
   * The explanation to display. Defaults to the reason carried by the
   * capabilities, which is in English; a localised surface passes its own.
   */
  readonly reason?: string
}

export function LifecycleNotice(props: LifecycleNoticeProps) {
  const unavailable = () =>
    !props.capabilities.canStart && !props.capabilities.canPause && !props.capabilities.canCancel

  return (
    <Show when={unavailable()}>
      <p role="note" class="text-10-regular text-text-weaker border border-border-weak-base rounded px-2 py-1">
        {props.reason ?? props.capabilities.lifecycleReason}
      </p>
    </Show>
  )
}
