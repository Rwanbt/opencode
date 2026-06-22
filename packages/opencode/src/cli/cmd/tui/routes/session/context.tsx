import { createContext, useContext } from "solid-js"
import type { Provider } from "@opencode-ai/sdk/v2"
import { useSync } from "@tui/context/sync"
import { useTuiConfig } from "../../context/tui-config"

// Session render context, shared between the Session coordinator (index.tsx,
// which provides it) and the message/part/tool components (message-parts.tsx,
// which consume it via use()). Lives in its own module so the two files never
// import each other.
export const context = createContext<{
  width: number
  sessionID: string
  conceal: () => boolean
  showThinking: () => boolean
  showTimestamps: () => boolean
  showDetails: () => boolean
  showGenericToolOutput: () => boolean
  diffWrapMode: () => "word" | "none"
  providers: () => ReadonlyMap<string, Provider>
  sync: ReturnType<typeof useSync>
  tui: ReturnType<typeof useTuiConfig>
}>()

export function use() {
  const ctx = useContext(context)
  if (!ctx) throw new Error("useContext must be used within a Session component")
  return ctx
}
