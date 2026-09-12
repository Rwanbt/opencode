/* SPDX-License-Identifier: MIT */

import { Show, type JSX } from "solid-js"
import { MessageTimeline, type MessageTimelineProps } from "@/pages/session/message-timeline"
import { PromptIndex } from "@/pages/session/prompt-index"

/**
 * P1-5 Vague 3 (ADR-037). Lifts the MessageTimeline JSX block out of
 * `session.tsx`. Now typed via the exported `MessageTimelineProps`
 * (Phase 43 prerequisite) instead of `unknown`, so future changes to
 * the props cascade through the typechecker.
 */
type AnchorFn = (id: string) => string

export interface SessionTimelineSectionProps
  extends Omit<MessageTimelineProps, "centered" | "turnStart" | "renderedUserMessages" | "historyMore" | "historyLoading"> {
  messagesReady: () => boolean
  centered: () => boolean
  turnStart: () => number
  renderedUserMessages: () => MessageTimelineProps["renderedUserMessages"]
  historyMore: () => boolean
  historyLoading: () => boolean
  visibleUserMessages: () => MessageTimelineProps["renderedUserMessages"]
  scrollEl: () => HTMLElement | undefined
  anchor: AnchorFn
}

export function SessionTimelineSection(props: SessionTimelineSectionProps): JSX.Element {
  return (
    <Show when={props.messagesReady()}>
      <MessageTimeline
        mobileChanges={props.mobileChanges}
        mobileFallback={props.mobileFallback}
        actions={props.actions}
        scroll={props.scroll}
        onResumeScroll={props.onResumeScroll}
        setScrollRef={props.setScrollRef}
        onScheduleScrollState={props.onScheduleScrollState}
        onAutoScrollHandleScroll={props.onAutoScrollHandleScroll}
        onMarkScrollGesture={props.onMarkScrollGesture}
        hasScrollGesture={props.hasScrollGesture}
        onUserScroll={props.onUserScroll}
        onTurnBackfillScroll={props.onTurnBackfillScroll}
        onAutoScrollInteraction={props.onAutoScrollInteraction}
        centered={props.centered()}
        setContentRef={props.setContentRef}
        turnStart={props.turnStart()}
        historyMore={props.historyMore()}
        historyLoading={props.historyLoading()}
        onLoadEarlier={props.onLoadEarlier}
        renderedUserMessages={props.renderedUserMessages()}
        anchor={props.anchor}
      />
      <PromptIndex messages={props.visibleUserMessages} scrollEl={props.scrollEl} />
    </Show>
  )
}

