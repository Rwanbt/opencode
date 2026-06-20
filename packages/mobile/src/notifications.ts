import { isPermissionGranted, requestPermission, sendNotification } from "@tauri-apps/plugin-notification"

export type SSEEvent =
  | { type: "session.updated"; properties?: { status?: string; title?: string; id?: string } }
  | { type: "llm.status"; properties?: { event?: string; model?: string } }
  | { type: string; properties?: Record<string, string> }

async function ensurePermission(): Promise<boolean> {
  let granted = await isPermissionGranted()
  if (!granted) {
    const perm = await requestPermission()
    granted = perm === "granted"
  }
  return granted
}

function trySend(title: string, body: string) {
  try {
    sendNotification({ title, body })
  } catch {
    // plugin unavailable in desktop/simulator build
  }
}

/**
 * Mobile notification bridge.
 * Subscribes to the server's SSE event stream and triggers native push
 * notifications when the app is in the background.
 *
 * Usage:
 *   const bridge = new NotificationBridge(serverUrl)
 *   await bridge.connect()          // call once on app ready
 *   bridge.disconnect()             // call in onCleanup
 */
export class NotificationBridge {
  private eventSource: EventSource | null = null
  private serverUrl: string
  private granted = false
  private isBackground = false
  private visibilityHandler: (() => void) | null = null

  constructor(serverUrl: string) {
    this.serverUrl = serverUrl.replace(/\/+$/, "")
  }

  async connect(directory?: string) {
    this.granted = await ensurePermission()

    this.isBackground = document.visibilityState === "hidden"
    this.visibilityHandler = () => {
      this.isBackground = document.visibilityState === "hidden"
    }
    document.addEventListener("visibilitychange", this.visibilityHandler)

    const url = directory
      ? `${this.serverUrl}/event?directory=${encodeURIComponent(directory)}`
      : `${this.serverUrl}/event`

    this.eventSource = new EventSource(url)
    this.eventSource.onmessage = (e) => this.handleMessage(e)
    // EventSource auto-reconnects on error — no onerror handler needed
  }

  private handleMessage(e: MessageEvent) {
    if (!this.isBackground || !this.granted) return
    let data: SSEEvent
    try {
      data = JSON.parse(e.data) as SSEEvent
    } catch {
      return // heartbeat or malformed frame
    }

    if (data.type === "session.updated") {
      const { status, title } = data.properties ?? {}
      if (status === "completed") {
        trySend("Task Complete", title || "A background task has finished.")
      } else if (status === "failed") {
        trySend("Task Failed", title || "A background task has failed.")
      }
    } else if (data.type === "llm.status") {
      const { event: evt, model } = data.properties ?? {}
      if (evt === "loaded") {
        trySend("Model Ready", model ? `${model} is loaded and ready.` : "Local model is ready.")
      }
    }
  }

  disconnect() {
    if (this.visibilityHandler) {
      document.removeEventListener("visibilitychange", this.visibilityHandler)
      this.visibilityHandler = null
    }
    if (this.eventSource) {
      this.eventSource.close()
      this.eventSource = null
    }
  }
}
