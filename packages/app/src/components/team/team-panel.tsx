// =============================================================================
// components/team/team-panel.tsx — TEAM-M03
//
// The desktop Team surface: runs, lifecycle controls, the task graph, and the
// shared model selector.
//
// Composes the primitives in this directory against the context from TEAM-M01.
// Every user-facing string arrives through `labels`, because this component is
// shared with mobile (TEAM-M04) and neither surface owns the other's copy; the
// dictionary work is TEAM-M05's.
//
// =============================================================================

import { createMemo, createSignal, For, Match, Show, Switch } from "solid-js"
import { TeamGraph, wavesFor, type TeamGraphTask, type TeamGraphWave } from "@unifia/ui/team-graph"
import { Button } from "@unifia/ui/button"
import { useTeam } from "@/context/team"
import { CollectionView, type CollectionLabels } from "./collection-view"
import { LifecycleNotice } from "./lifecycle-notice"
import { ModelSelector, type ModelOption, type SelectorLabels } from "./model-selector"

export interface TeamPanelLabels {
  readonly runs: CollectionLabels
  readonly models: CollectionLabels
  readonly selector: SelectorLabels
  readonly graph: string
  readonly gates: string
  readonly lifecycle: string
  readonly runStatus: (status: string) => string
  readonly gateVerdict: (verdict: string) => string
  readonly controls: { readonly pause: string; readonly resume: string; readonly cancel: string; readonly confirmCancel: string }
  /** Shown while a recoverable failure is still being retried. */
  readonly retrying: string
  /** Shown once retrying has been given up, so the surface is not just silent. */
  readonly exhausted: string
}

export interface TeamPanelProps {
  readonly labels: TeamPanelLabels
  /**
   * Waves for the selected run, already laid out by the caller.
   *
   * The layout algorithm lives in the CLI package and is tested there; passing
   * the result in keeps one implementation of "which task runs when" rather
   * than growing a second one here that could disagree with the terminal.
   */
  readonly waves?: readonly TeamGraphWave[]
  readonly tasks?: readonly TeamGraphTask[]
  /** True once recovery has stopped retrying; see refresh-policy.ts. */
  readonly exhausted?: boolean
}

export function TeamPanel(props: TeamPanelProps) {
  const team = useTeam()
  const [selectedTask, setSelectedTask] = createSignal<string | undefined>(undefined)
  const [armedCancel, setArmedCancel] = createSignal<string | undefined>(undefined)
  const [controlError, setControlError] = createSignal<string | undefined>(undefined)
  const [controlling, setControlling] = createSignal<string | undefined>(undefined)

  const graphTasks = createMemo<TeamGraphTask[]>(() => props.tasks ? [...props.tasks] : [...team.details.tasks()])
  const graphWaves = createMemo<TeamGraphWave[]>(() => props.waves ? [...props.waves] : [...wavesFor(graphTasks())])
  const runControlStatus = (run: { status: string; controlStatus?: "running" | "paused" | "cancelled" | null }) =>
    run.controlStatus ?? (run.status === "running" || run.status === "pending" ? "running" : null)

  const control = async (runId: string, operation: "pause" | "resume" | "cancel") => {
    setControlError(undefined)
    setControlling(runId)
    try {
      await team.lifecycle[operation](runId)
    } catch (error) {
      setControlError(error instanceof Error ? error.message : String(error))
    } finally {
      setControlling(undefined)
    }
  }
  const options = createMemo<ModelOption[]>(() =>
    team.models.page().items.map((model) => ({
      providerID: model.providerID,
      modelID: model.modelId,
      label: model.family ? `${model.family} · ${model.modelId}` : model.modelId,
    })),
  )

  return (
    <div class="flex flex-col gap-4 p-3">
      <LifecycleNotice capabilities={team.capabilities()} reason={team.capabilities().canRead ? undefined : props.labels.lifecycle} />

      {/* Retrying and having given up are different things to show. Collapsing
          them leaves a panel that silently stops updating. */}
      <Switch>
        <Match when={props.exhausted}>
          <p role="alert" class="text-11-regular text-text-danger">
            {props.labels.exhausted}
          </p>
        </Match>
        <Match when={team.runs.stale()}>
          <p role="status" class="text-11-regular text-text-weaker">
            {props.labels.retrying}
          </p>
        </Match>
      </Switch>

      <Show when={controlError()}>
        <p role="alert" class="text-11-regular text-text-danger">{controlError()}</p>
      </Show>

      <CollectionView
        page={team.runs.page()}
        reachability={team.runs.reachability()}
        labels={props.labels.runs}
        onMore={() => void team.runs.more()}
      >
        {(run) => (
          <div class="flex items-center gap-2 text-11-regular">
            <button
              type="button"
              class="text-text-base hover:underline"
              aria-pressed={team.details.runId() === run.runId}
              onClick={() => void team.details.select(run.runId).catch((error) => setControlError(String(error)))}
            >
              {run.runId}
            </button>
            <span class="text-text-weaker">{props.labels.runStatus(run.status)}</span>
            <Show when={runControlStatus(run) === "running"}>
              <Button size="small" variant="ghost" disabled={controlling() === run.runId} onClick={() => void control(run.runId, "pause")}>
                {props.labels.controls.pause}
              </Button>
            </Show>
            <Show when={runControlStatus(run) === "paused"}>
              <Button size="small" variant="ghost" disabled={controlling() === run.runId} onClick={() => void control(run.runId, "resume")}>
                {props.labels.controls.resume}
              </Button>
            </Show>
            <Show when={runControlStatus(run) === "running" || runControlStatus(run) === "paused"}>
              <Button
                size="small"
                disabled={controlling() === run.runId}
                variant={armedCancel() === run.runId ? "primary" : "ghost"}
                onClick={() => {
                  if (armedCancel() !== run.runId) return setArmedCancel(run.runId)
                  setArmedCancel(undefined)
                  void control(run.runId, "cancel")
                }}
              >
                {armedCancel() === run.runId ? props.labels.controls.confirmCancel : props.labels.controls.cancel}
              </Button>
            </Show>
          </div>
        )}
      </CollectionView>

      <Show when={graphWaves().length > 0}>
        <TeamGraph
          label={props.labels.graph}
          waves={graphWaves()}
          tasks={graphTasks()}
          selected={selectedTask()}
          onSelect={setSelectedTask}
        />
      </Show>

      <Show when={team.details.gates().length > 0}>
        <div role="list" aria-label={props.labels.gates} class="flex flex-col gap-1">
          <For each={team.details.gates()}>
            {(gate) => (
              <div role="listitem" class="flex gap-2 text-11-regular">
                <span class={gate.verdict === "CHANGES_REQUESTED" ? "text-text-danger" : "text-text-success"}>{props.labels.gateVerdict(gate.verdict)}</span>
                <span class="text-text-weaker">{gate.taskId ?? team.details.runId()}</span>
              </div>
            )}
          </For>
        </div>
      </Show>
      <ModelSelector
        options={options()}
        selected={team.selection.effective()}
        source={team.selection.source()}
        rejected={team.selection.rejected()}
        labels={props.labels.selector}
        onPick={(selection) => team.selection.setOverride(selection)}
        onSaveDefault={(selection) => team.selection.save(selection)}
        onClearOverride={() => team.selection.clearOverride()}
      />

      <CollectionView
        page={team.models.page()}
        reachability={team.models.reachability()}
        labels={props.labels.models}
        onMore={() => void team.models.more()}
      >
        {(model) => <span class="text-11-regular text-text-weak">{model.modelId}</span>}
      </CollectionView>
    </div>
  )
}
