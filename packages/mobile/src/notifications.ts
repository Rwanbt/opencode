import { sendNotification, isPermissionGranted, requestPermission } from "@tauri-apps/plugin-notification"

/**
 * Mobile notification bridge.
 * Listens to SSE events from the remote OpenCode server and
 * triggers native push notifications when the app is backgrounded.
 */
export class NotificationBridge {
  private eventSource: EventSource | null = null
  private serverUrl: string
  private isBackground = false

  constructor(serverUrl: string) {
    this.serverUrl = serverUrl.replace(/\/+$/, "")
    this.setupVisibilityListener()
  }

  private setupVisibilityListener() {
    document.addEventListener("visibilitychange", () => {
      this.isBackground = document.visibilityState === "hidden"
    })
  }

  async connect(directory?: string) {
    // Ensure notification permission
    let granted = await isPermissionGranted()
    if (!granted) {
      const perm = await requestPermission()
      granted = perm === "granted"
    }

    const url = directory
      ? `${this.serverUrl}/event?directory=${encodeURIComponent(directory)}`
      : `${this.serverUrl}/event`

    this.eventSource = new EventSource(url)

    this.eventSource.onmessage = async (event) => {
      if (!this.isBackground || !granted) return

      try {
        const data = JSON.parse(event.data)

        // Only notify on significant events when backgrounded
        if (data.type === "session.updated" && data.properties?.status === "completed") {
          sendNotification({
            title: "Task Complete",
            body: data.properties?.title || "A background task has finished.",
          })
        } else if (data.type === "session.updated" && data.properties?.status === "failed") {
          sendNotification({
            title: "Task Failed",
            body: data.properties?.title || "A background task has failed.",
          })
        }
      } catch {
        // Ignore parse errors from SSE heartbeats
      }
    }

    this.eventSource.onerror = () => {
      // Auto-reconnect is handled by EventSource
    }
  }

  disconnect() {
    if (this.eventSource) {
      this.eventSource.close()
      this.eventSource = null
    }
  }
}
