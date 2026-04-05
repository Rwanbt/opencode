import { Show } from "solid-js"

export interface ObserverBadgeProps {
  observerCount: number
}

/**
 * Small badge showing the number of observers on a session.
 * Displayed next to session title when others are watching.
 */
export function ObserverBadge(props: ObserverBadgeProps) {
  return (
    <Show when={props.observerCount > 0}>
      <span
        class="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-blue-500/10 text-blue-500 text-xs"
        title={`${props.observerCount} observer${props.observerCount > 1 ? "s" : ""} watching`}
      >
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
          <circle cx="12" cy="12" r="3" />
        </svg>
        {props.observerCount}
      </span>
    </Show>
  )
}
