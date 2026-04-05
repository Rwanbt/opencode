import { For, Show } from "solid-js"

export interface PresenceUser {
  userID: string
  username: string
  status: "online" | "idle" | "away"
  activeSessionID?: string
}

export interface PresenceIndicatorProps {
  users: PresenceUser[]
  currentUserID?: string
}

const statusColors = {
  online: "bg-green-500",
  idle: "bg-yellow-500",
  away: "bg-gray-400",
}

/**
 * Shows online users with colored status dots.
 * Compact horizontal layout for header/toolbar placement.
 */
export function PresenceIndicator(props: PresenceIndicatorProps) {
  const others = () => props.users.filter((u) => u.userID !== props.currentUserID)

  return (
    <Show when={others().length > 0}>
      <div class="flex items-center gap-1 px-2">
        <For each={others().slice(0, 5)}>
          {(user) => (
            <div class="relative group" title={`${user.username} (${user.status})`}>
              <div class="w-6 h-6 rounded-full bg-secondary/20 flex items-center justify-center text-xs font-medium">
                {user.username.charAt(0).toUpperCase()}
              </div>
              <div
                class={`absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border-2 border-surface ${statusColors[user.status]}`}
              />
              {/* Tooltip */}
              <div class="absolute bottom-full left-1/2 -translate-x-1/2 mb-1 px-2 py-0.5 bg-black text-white text-xs rounded whitespace-nowrap opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity">
                {user.username}
              </div>
            </div>
          )}
        </For>
        <Show when={others().length > 5}>
          <span class="text-xs text-secondary">+{others().length - 5}</span>
        </Show>
      </div>
    </Show>
  )
}
