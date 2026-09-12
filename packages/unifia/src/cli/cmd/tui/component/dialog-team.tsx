// =============================================================================
// tui/component/dialog-team.tsx — TEAM-M02
//
// The Team surface in the terminal: runs, their task graph, gates, and the
// registry's load state.
//
// Lifecycle controls call the same server-owned runtime as the CLI and App.
// Cancellation is armed first and confirmed with a second keypress.
//
// Everything the display depends on being true — which tasks can run when,
// what can never run, what a run cost — is computed in util/team-dag.ts and
// tested there. This file draws the result.
// =============================================================================

import { TextAttributes } from "@opentui/core"
import { useKeyboard } from "@opentui/solid"
import { createEffect, createMemo, createResource, createSignal, For, Show } from "solid-js"
import { useDialog } from "@tui/ui/dialog"
import { lifecycleKey, moveCursor, navigationKey, reconcileCursor } from "../util/team-keyboard"
import { useTheme } from "../context/theme"
import { useSDK } from "../context/sdk"
import { Spinner } from "./spinner"
import { TeamRunGraph } from "./team-run-graph"
import { layoutTaskGraph, summarizeTasks, totalCostUsd, type TaskNode } from "../util/team-dag"

const RUN_PAGE_SIZE = 30

interface RunRow {
  runId: string
  planId: string
  status: string
  createdAt: string
}

interface TaskRow {
  taskId: string
  status: string
  dependsOn: string[]
}

interface GateRow {
  gateId: string
  taskId: string | null
  verdict: string
}

export function DialogTeam() {
  const dialog = useDialog()
  const { theme } = useTheme()
  const sdk = useSDK()

  const [selected, setSelected] = createSignal<string | undefined>(undefined)
  const [cursor, setCursor] = createSignal(0)
  const [controlError, setControlError] = createSignal<string | undefined>()
  const [armedCancel, setArmedCancel] = createSignal<string | undefined>()

  const [runs, { refetch: refreshRuns }] = createResource(async () => {
    const response = await sdk.client.team.listRuns({ limit: RUN_PAGE_SIZE })
    if (response.error) throw response.error
    return response.data as { items: RunRow[]; nextCursor: string | null }
  })

  const [health] = createResource(async () => {
    const response = await sdk.client.modelIntelligence.health()
    if (response.error) return { loaded: false, reachable: false }
    return { loaded: (response.data as { loaded: boolean }).loaded, reachable: true }
  })

  const [detail] = createResource(selected, async (runID: string) => {
    const [tasks, gates] = await Promise.all([
      sdk.client.team.listTasks({ runID }),
      sdk.client.team.listGates({ runID }),
    ])
    return {
      tasks: ((tasks.data as { items: TaskRow[] } | undefined)?.items ?? []) as TaskRow[],
      gates: ((gates.data as { items: GateRow[] } | undefined)?.items ?? []) as GateRow[],
    }
  })

  const runList = createMemo(() => runs()?.items ?? [])

  // Pages arrive while the reader is moving through the list. Growing it must
  // not move the cursor; shrinking it must not leave the cursor past the end.
  createEffect(() => setCursor((index) => reconcileCursor({ index, count: runList().length })))

  async function control(operation: "pause" | "resume" | "cancel") {
    const runID = selected() ?? runList()[cursor()]?.runId
    if (!runID) return
    const response = operation === "pause"
      ? await sdk.client.team.pauseRun({ runID })
      : operation === "resume"
        ? await sdk.client.team.resumeRun({ runID })
        : await sdk.client.team.cancelRun({ runID })
    if (response.error) {
      setControlError(String((response.error as { error?: string }).error ?? response.error))
      return
    }
    setControlError(undefined)
    await refreshRuns()
  }

  useKeyboard((event) => {
    const lifecycle = lifecycleKey(event)
    if (lifecycle !== "none") {
      const runID = selected() ?? runList()[cursor()]?.runId
      if (lifecycle === "cancel" && runID && armedCancel() !== runID) {
        setArmedCancel(runID)
        return
      }
      setArmedCancel(undefined)
      void control(lifecycle)
      return
    }
    const key = navigationKey(event)
    if (key === "none") return
    if (key === "clear") {
      setSelected(undefined)
      return
    }
    if (key === "select") {
      setSelected(runList()[cursor()]?.runId)
      return
    }
    setCursor((index) => moveCursor({ index, count: runList().length, key }))
  })

  const nodes = createMemo<TaskNode[]>(() =>
    (detail()?.tasks ?? []).map((task) => ({
      taskId: task.taskId,
      dependsOn: task.dependsOn,
      status: task.status,
    })),
  )

  // Computed once per data change rather than once per frame: at 200 tasks the
  // difference between the two is the whole responsiveness criterion.
  const layout = createMemo(() => layoutTaskGraph(nodes()))
  const summary = createMemo(() => summarizeTasks(nodes()))
  const cost = createMemo(() => totalCostUsd(nodes()))

  return (
    <box paddingLeft={2} paddingRight={2} gap={1} paddingBottom={1}>
      <box flexDirection="row" justifyContent="space-between">
        <text fg={theme.text} attributes={TextAttributes.BOLD}>
          Team
        </text>
        <text fg={theme.textMuted} onMouseUp={() => dialog.clear()}>
          esc
        </text>
      </box>

      <text fg={theme.textMuted}>p pause · r resume · c twice cancel</text>
      <Show when={controlError()}><text fg={theme.error}>{controlError()}</text></Show>

      <Show when={!runs.loading} fallback={<Spinner />}>
        {/* An unreachable server and a server with no runs are different
            answers, and are never collapsed into one empty list. */}
        <Show
          when={!runs.error}
          fallback={<text fg={theme.error}>Could not reach the server; no runs could be listed.</text>}
        >
          <Show when={runList().length > 0} fallback={<text fg={theme.textMuted}>No runs recorded yet.</text>}>
            <box>
              <For each={runList()}>
                {(run, index) => (
                  <box flexDirection="row" gap={1} onMouseUp={() => setSelected(run.runId)}>
                    {/* The cursor is drawn, not just tracked: without a marker
                        the arrow keys move something invisible. */}
                    <text flexShrink={0} fg={theme.textMuted}>
                      {cursor() === index() ? "›" : " "}
                    </text>
                    <text fg={selected() === run.runId ? theme.text : theme.textMuted}>{run.runId}</text>
                    <text fg={theme.textMuted}>{run.status}</text>
                  </box>
                )}
              </For>
            </box>
            <text fg={theme.textMuted}>↑↓ move · enter select · esc clear · p/r control · c twice cancel</text>
            {/* Shown only when the server said there is more, so the end of the
                list is distinguishable from the end of the page. */}
            <Show when={runs()?.nextCursor !== null}>
              <text fg={theme.textMuted}>… more runs available</text>
            </Show>
          </Show>
        </Show>
      </Show>

      <Show when={selected() && !detail.loading}>
        <box gap={1}>
          <text fg={theme.text} attributes={TextAttributes.BOLD}>
            {selected()}
          </text>

          <TeamRunGraph
            layout={layout()}
            taskCount={summary().total}
            costUsd={cost()}
            colors={{ text: theme.text, muted: theme.textMuted, error: theme.error, warning: theme.warning }}
          />

          <Show when={(detail()?.gates.length ?? 0) > 0}>
            <box>
              <text fg={theme.text}>Gates</text>
              <For each={detail()?.gates ?? []}>
                {(gate) => (
                  <box flexDirection="row" gap={1}>
                    <text fg={gate.verdict === "CHANGES_REQUESTED" ? theme.error : theme.success}>{gate.verdict}</text>
                    <text fg={theme.textMuted}>{gate.taskId ?? "run"}</text>
                  </box>
                )}
              </For>
            </box>
          </Show>

        </box>
      </Show>

      <Show when={!health.loading}>
        <text fg={health()?.reachable ? theme.textMuted : theme.error}>
          {health()?.reachable
            ? `model registry: ${health()?.loaded ? "loaded" : "not loaded yet"}`
            : "model registry: unreachable"}
        </text>
      </Show>
    </box>
  )
}
