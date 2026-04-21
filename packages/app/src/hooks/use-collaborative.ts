import { createSignal, onCleanup, onMount } from "solid-js"
import type { PresenceUser } from "../components/presence/presence-indicator"

export interface CollaborativeConfig {
  serverUrl: string
  accessToken: string
  directory?: string
}

export interface CollaborativeState {
  connected: boolean
  presence: PresenceUser[]
  events: any[]
}

/**
 * Hook for managing the collaborative WebSocket connection.
 * Provides real-time presence data and event broadcasting.
 */
export function useCollaborative(config: () => CollaborativeConfig | null) {
  const [connected, setConnected] = createSignal(false)
  const [presence, setPresence] = createSignal<PresenceUser[]>([])
  const [lastEvent, setLastEvent] = createSignal<any>(null)

  let ws: WebSocket | null = null
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null
  let pingTimer: ReturnType<typeof setInterval> | null = null

  function connect() {
    const cfg = config()
    if (!cfg) return

    const params = new URLSearchParams({ token: cfg.accessToken })
    if (cfg.directory) params.set("directory", cfg.directory)

    const wsUrl = cfg.serverUrl.replace(/^http/, "ws") + `/ws/events?${params}`

    // Sprint 6 item 3 — NOT migrated to createAuthenticatedWebSocket.
    // Rationale: this endpoint lives on the collaborative *tenant* server
    // (SST, not the local opencode daemon) and authenticates via an opaque
    // `token` query param (tenant access token), not Basic/Bearer credentials
    // consumable by /auth/ws-ticket. The ws-ticket flow on the local daemon
    // is a different auth domain and would not help here.
    try {
      ws = new WebSocket(wsUrl)

      ws.onopen = () => {
        setConnected(true)
        // Send ping every 25s to keep connection alive
        pingTimer = setInterval(() => {
          ws?.send(JSON.stringify({ type: "ping" }))
        }, 25_000)
      }

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data)
          if (data.type === "presence") {
            setPresence(data.users ?? [])
          } else if (data.type === "pong") {
            // Keepalive response
          } else {
            setLastEvent(data)
          }
        } catch {
          // Ignore malformed messages
        }
      }

      ws.onclose = () => {
        setConnected(false)
        cleanup()
        // Auto-reconnect after 3s
        reconnectTimer = setTimeout(connect, 3000)
      }

      ws.onerror = () => {
        ws?.close()
      }
    } catch {
      reconnectTimer = setTimeout(connect, 3000)
    }
  }

  function cleanup() {
    if (pingTimer) {
      clearInterval(pingTimer)
      pingTimer = null
    }
  }

  function disconnect() {
    if (reconnectTimer) {
      clearTimeout(reconnectTimer)
      reconnectTimer = null
    }
    cleanup()
    ws?.close()
    ws = null
    setConnected(false)
    setPresence([])
  }

  function reportActivity(sessionID?: string) {
    ws?.send(JSON.stringify({ type: "activity", sessionID }))
  }

  onMount(() => {
    if (config()) connect()
  })

  onCleanup(disconnect)

  return {
    connected,
    presence,
    lastEvent,
    connect,
    disconnect,
    reportActivity,
  }
}
