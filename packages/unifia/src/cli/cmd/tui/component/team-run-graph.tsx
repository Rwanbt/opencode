// =============================================================================
// tui/component/team-run-graph.tsx — TEAM-M02
//
// The task graph of one run, drawn from an already-computed layout.
//
// Split out of dialog-team.tsx so it can actually be rendered in a test. The
// dialog owns the SDK, the theme and the dialog stack, and mounting it pulls in
// the whole renderer/config/kv provider chain; this takes its data and its
// three colours as props and needs none of that. The result is that the states
// which are easy to get quietly wrong — a task that will never run, a cost that
// was never measured — are asserted against real rendered output rather than
// against a description of it.
// =============================================================================

import { For, Show } from "solid-js"
import type { RGBA } from "@opentui/core"
import { criticalPathLength, type GraphLayout } from "../util/team-dag"

export interface TeamRunGraphProps {
  readonly layout: GraphLayout
  readonly taskCount: number
  /** `undefined` means no producer measured a cost — not that it was free. */
  readonly costUsd: number | undefined
  readonly colors: {
    readonly text: RGBA
    readonly muted: RGBA
    readonly error: RGBA
    readonly warning: RGBA
  }
}

export function TeamRunGraph(props: TeamRunGraphProps) {
  return (
    <box gap={1}>
      <text fg={props.colors.text}>
        {props.taskCount} tasks in {criticalPathLength(props.layout)} waves
      </text>

      <For each={props.layout.waves}>
        {(wave) => (
          <box flexDirection="row" gap={1}>
            <text flexShrink={0} fg={props.colors.muted}>
              wave {wave.index + 1}
            </text>
            <text fg={props.colors.text}>{wave.taskIds.join(", ")}</text>
          </box>
        )}
      </For>

      {/* A task absent from every wave reads as "already done". It is the
          opposite: it is the one thing in the run that will never happen. */}
      <Show when={props.layout.unschedulable.length > 0}>
        <text fg={props.colors.error}>
          {props.layout.hasCycle ? "cycle — never runs: " : "blocked — never runs: "}
          {props.layout.unschedulable.join(", ")}
        </text>
      </Show>

      {/* Told apart from a cycle on purpose: one is a broken plan, the other a
          partial fetch, and they send the reader after different things. */}
      <Show when={props.layout.missingDependencies.length > 0}>
        <text fg={props.colors.warning}>missing dependencies: {props.layout.missingDependencies.join(", ")}</text>
      </Show>

      {/* "not recorded" rather than "$0.00": a run whose cost was never
          measured and a run that cost nothing are different facts, and only
          one of them is something the reader should act on. */}
      <text fg={props.colors.muted}>
        cost: {props.costUsd === undefined ? "not recorded" : `$${props.costUsd.toFixed(2)}`}
      </text>
    </box>
  )
}
