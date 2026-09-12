/* SPDX-License-Identifier: MIT */

import { Show, type JSX } from "solid-js"
import { Tabs } from "@unifia/ui/tabs"

/**
 * Vague 4 P1-5 (ADR-037) — mobile tabs section extracted from
 * `session.tsx`. Renders the segmented control that switches between
 * "Session" and "Changes" at viewport width ≤ desktop break.
 *
 * Caller passes the current value, the language accessor (already
 * reactive), and the two click handlers. We don't pass the whole
 * `store` because the section only reads `mobileTab`.
 */
export function SessionMobileTabsSection(props: {
  mobileTab: "session" | "changes"
  hasReview: boolean
  reviewCount: number
  language: { t: (key: string | number, params?: Record<string, string | number | boolean>) => string }
  setMobileTab: (next: "session" | "changes") => void
  visible: boolean
}): JSX.Element {
  return (
    <Show when={props.visible}>
      <Tabs value={props.mobileTab} class="h-auto">
        <Tabs.List>
          <Tabs.Trigger
            value="session"
            class="!w-1/2 !max-w-none"
            classes={{ button: "w-full" }}
            onClick={() => props.setMobileTab("session")}
          >
            {props.language.t("session.tab.session")}
          </Tabs.Trigger>
          <Tabs.Trigger
            value="changes"
            class="!w-1/2 !max-w-none !border-r-0"
            classes={{ button: "w-full" }}
            onClick={() => props.setMobileTab("changes")}
          >
            {props.hasReview
              ? props.language.t("session.review.filesChanged", { count: props.reviewCount })
              : props.language.t("session.review.change.other")}
          </Tabs.Trigger>
        </Tabs.List>
      </Tabs>
    </Show>
  )
}
