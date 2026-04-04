import type { TuiPlugin, TuiPluginApi, TuiPluginModule } from "@opencode-ai/plugin/tui"
import { createMemo, For, Show } from "solid-js"

const id = "internal:sidebar-tasks"

const STATUS_LABELS: Record<string, { icon: string; label: string }> = {
  busy: { icon: "~", label: "running" },
  queued: { icon: "?", label: "queued" },
  blocked: { icon: "!", label: "blocked" },
  awaiting_input: { icon: "?", label: "needs input" },
  completed: { icon: "*", label: "done" },
  failed: { icon: "x", label: "failed" },
  cancelled: { icon: "-", label: "cancelled" },
  retry: { icon: "~", label: "retrying" },
}

interface TaskInfo {
  sessionId: string
  title: string
  status: string
  mode?: string
}

function View(props: { api: TuiPluginApi; session_id: string }) {
  const theme = () => props.api.theme.current

  // Extract child task session IDs from the message tool parts
  const tasks = createMemo(() => {
    const messages = props.api.state.session.messages(props.session_id)
    const found: TaskInfo[] = []
    const seen = new Set<string>()

    for (const msg of messages) {
      if (msg.role !== "assistant") continue
      const parts = props.api.state.part(msg.id)
      for (const part of parts) {
        if (!("tool" in part) || part.tool !== "task") continue
        const state = part.state as any
        const sessionId = state?.metadata?.sessionId
        if (!sessionId || seen.has(sessionId)) continue
        seen.add(sessionId)

        const status = props.api.state.session.status(sessionId)
        found.push({
          sessionId,
          title: state?.title ?? state?.input?.description ?? "Task",
          status: status?.type ?? "idle",
          mode: state?.metadata?.mode,
        })
      }
    }
    return found
  })

  // Show only active (non-idle, non-completed) background tasks
  const activeTasks = createMemo(() =>
    tasks().filter((t) => t.status !== "idle" && t.status !== "completed"),
  )

  return (
    <Show when={activeTasks().length > 0}>
      <box>
        <text fg={theme().text}>
          <b>Background Tasks</b>
        </text>
        <For each={activeTasks()}>
          {(task) => {
            const info = () => STATUS_LABELS[task.status] ?? { icon: " ", label: task.status }
            return (
              <box flexDirection="row" gap={1}>
                <text
                  fg={
                    task.status === "failed"
                      ? theme().error
                      : task.status === "busy" || task.status === "retry" || task.status === "queued"
                        ? theme().warning
                        : theme().textMuted
                  }
                >
                  {info().icon}
                </text>
                <text fg={theme().textMuted} wrapMode="none">
                  {task.title.length > 28 ? task.title.slice(0, 28) + ".." : task.title}
                </text>
                <text fg={theme().textMuted}>{info().label}</text>
              </box>
            )
          }}
        </For>
      </box>
    </Show>
  )
}

const tui: TuiPlugin = async (api) => {
  api.slots.register({
    order: 350,
    slots: {
      sidebar_content(_ctx, props) {
        return <View api={api} session_id={props.session_id} />
      },
    },
  })

  // Register task management commands
  api.command.register(() => [
    {
      title: "List background tasks",
      value: "task.list",
      category: "Tasks",
      onSelect: () => {
        const route = api.route.current
        if (route?.name !== "session") return
        const sessionId = route.params?.sessionID as string
        if (!sessionId) return

        const messages = api.state.session.messages(sessionId)
        const taskInfos: string[] = []

        for (const msg of messages) {
          if (msg.role !== "assistant") continue
          const parts = api.state.part(msg.id)
          for (const part of parts) {
            if (!("tool" in part) || part.tool !== "task") continue
            const state = part.state as any
            const childId = state?.metadata?.sessionId
            if (!childId) continue
            const status = api.state.session.status(childId)
            const title = state?.title ?? "Task"
            taskInfos.push(`${title}: ${status?.type ?? "idle"}`)
          }
        }

        if (taskInfos.length === 0) {
          api.ui.toast({ message: "No background tasks in this session", variant: "info" })
        } else {
          api.ui.toast({ message: taskInfos.join("\n"), variant: "info" })
        }
      },
    },
  ])
}

const plugin: TuiPluginModule & { id: string } = {
  id,
  tui,
}

export default plugin
