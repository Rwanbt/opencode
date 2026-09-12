import { DialogSelect } from "@tui/ui/dialog-select"
import { useRoute } from "@tui/context/route"
import { useSync } from "@tui/context/sync"
import { useSDK } from "@tui/context/sdk"
import { useToast } from "@tui/ui/toast"
import { createMemo } from "solid-js"

async function taskAction(sdk: ReturnType<typeof useSDK>, action: string, sessionID: string, body?: object) {
  const url = `${sdk.url}/task/${sessionID}/${action}`
  const res = await sdk.fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  })
  if (!res.ok) {
    const text = await res.text().catch(() => "Unknown error")
    throw new Error(text)
  }
  return res.json()
}

async function getTaskStatus(sdk: ReturnType<typeof useSDK>, sessionID: string) {
  const res = await sdk.fetch(`${sdk.url}/task/${sessionID}`)
  if (!res.ok) return undefined
  return res.json() as Promise<{ session: any; status: { type: string; error?: string; result?: string } }>
}

export function DialogSubagent(props: { sessionID: string }) {
  const route = useRoute()
  const sync = useSync()
  const sdk = useSDK()
  const toast = useToast()

  const status = createMemo(() => sync.data.session_status[props.sessionID])
  // Status type may include extended task states (queued, blocked, etc.)
  // that are not yet in the generated SDK types
  const statusType = createMemo(() => (status() as any)?.type as string ?? "idle")

  const isBusy = createMemo(() => {
    const t = statusType()
    return t === "busy" || t === "retry"
  })
  const isCancellable = createMemo(() => {
    const t = statusType()
    return t !== "idle" && t !== "completed" && t !== "cancelled" && t !== "failed"
  })

  return (
    <DialogSelect
      title={`Subagent Actions (${statusType()})`}
      options={[
        {
          title: "Open",
          value: "subagent.view",
          description: "View the subagent's session",
          onSelect: (dialog) => {
            route.navigate({
              type: "session",
              sessionID: props.sessionID,
            })
            dialog.clear()
          },
        },
        {
          title: "Cancel task",
          value: "subagent.cancel",
          description: "Stop the running task",
          disabled: !isCancellable(),
          onSelect: async (dialog) => {
            try {
              await taskAction(sdk, "cancel", props.sessionID)
              toast.show({ message: "Task cancelled", variant: "success" })
            } catch (err) {
              toast.show({ message: `Failed to cancel: ${err}`, variant: "error" })
            }
            dialog.clear()
          },
        },
        {
          title: "Resume task",
          value: "subagent.resume",
          description: "Continue the task",
          disabled: isBusy(),
          onSelect: async (dialog) => {
            try {
              await taskAction(sdk, "resume", props.sessionID, {})
              toast.show({ message: "Task resumed", variant: "success" })
            } catch (err) {
              toast.show({ message: `Failed to resume: ${err}`, variant: "error" })
            }
            dialog.clear()
          },
        },
        {
          title: "Send follow-up",
          value: "subagent.followup",
          description: "Send a message to the task",
          disabled: isBusy(),
          onSelect: async (dialog) => {
            try {
              await taskAction(sdk, "followup", props.sessionID, {
                prompt: "Continue working on this task and report your progress.",
              })
              toast.show({ message: "Follow-up sent", variant: "success" })
            } catch (err) {
              toast.show({ message: `Failed to send: ${err}`, variant: "error" })
            }
            dialog.clear()
          },
        },
        {
          title: "Check status",
          value: "subagent.status",
          description: "Show current task status",
          onSelect: async (dialog) => {
            try {
              const info = await getTaskStatus(sdk, props.sessionID)
              if (info) {
                const msg =
                  info.status.type === "failed"
                    ? `Status: ${info.status.type} - ${info.status.error}`
                    : `Status: ${info.status.type}`
                toast.show({ message: msg, variant: "info" })
              }
            } catch {
              toast.show({ message: "Failed to get status", variant: "error" })
            }
            dialog.clear()
          },
        },
      ]}
    />
  )
}
