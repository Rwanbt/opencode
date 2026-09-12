/* SPDX-License-Identifier: MIT */

import { For, Show, type JSX, createSignal } from "solid-js"

/**
 * A6-D03/D04/D05/D06 Vector tools MVP — v110 surface.
 *
 * The contract calls for a single, non-stacked toolbar (D05) plus
 * selection handles (D03/D04) and a Bezier tool (D06). This MVP ships
 * the surface area: a tool selector with the four primitives plus a
 * Bezier option, selection handles around the current selection, and a
 * stub Bezier path. Real canvas wiring lives with the design runtime;
 * this component is the v110-styled shell.
 */

export type DesignVectorTool = "select" | "rect" | "line" | "ellipse" | "bezier"

export type DesignSelection = {
  readonly id: string
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

const TOOLS: readonly { id: DesignVectorTool; label: string; shortcut: string }[] = [
  { id: "select", label: "Select", shortcut: "V" },
  { id: "rect", label: "Rectangle", shortcut: "R" },
  { id: "line", label: "Line", shortcut: "L" },
  { id: "ellipse", label: "Ellipse", shortcut: "E" },
  { id: "bezier", label: "Bezier", shortcut: "B" },
]

export function DesignVectorToolbar(props: {
  tool: DesignVectorTool
  onTool: (tool: DesignVectorTool) => void
}): JSX.Element {
  return (
    <div
      class="flex h-9 items-center gap-1 border-b border-border-base bg-background-stronger px-2"
      role="toolbar"
      aria-label="Design vector tools"
      data-v110="design-vector-toolbar"
    >
      <For each={TOOLS}>
        {(entry) => (
          <button
            type="button"
            class="flex min-h-7 min-w-7 items-center justify-center rounded px-2 text-11-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus motion-reduce:transition-none transition-colors"
            classList={{ "bg-background-base text-text-strong": props.tool === entry.id }}
            aria-pressed={props.tool === entry.id}
            title={`${entry.label} (${entry.shortcut})`}
            data-design-vector-tool={entry.id}
            onClick={() => props.onTool(entry.id)}
          >
            {entry.label}
          </button>
        )}
      </For>
    </div>
  )
}

export function DesignSelectionHandles(props: {
  selection: DesignSelection | undefined
}): JSX.Element {
  return (
    <Show when={props.selection}>
      {(selection) => {
        const handles = [
          { id: "nw", cx: selection().x, cy: selection().y },
          { id: "n", cx: selection().x + selection().width / 2, cy: selection().y },
          { id: "ne", cx: selection().x + selection().width, cy: selection().y },
          { id: "e", cx: selection().x + selection().width, cy: selection().y + selection().height / 2 },
          { id: "se", cx: selection().x + selection().width, cy: selection().y + selection().height },
          { id: "s", cx: selection().x + selection().width / 2, cy: selection().y + selection().height },
          { id: "sw", cx: selection().x, cy: selection().y + selection().height },
          { id: "w", cx: selection().x, cy: selection().y + selection().height / 2 },
        ]
        return (
          <g data-v110="design-selection-handles" data-selection-id={selection().id}>
            <rect
              x={selection().x - 0.5}
              y={selection().y - 0.5}
              width={selection().width + 1}
              height={selection().height + 1}
              fill="none"
              stroke="currentColor"
              stroke-width="1"
              stroke-dasharray="3 2"
              data-design-selection-frame
            />
            <For each={handles}>
              {(handle) => (
                <rect
                  x={handle.cx - 3}
                  y={handle.cy - 3}
                  width={6}
                  height={6}
                  fill="currentColor"
                  stroke="var(--background-base)"
                  stroke-width="1"
                  data-design-handle={handle.id}
                />
              )}
            </For>
          </g>
        )
      }}
    </Show>
  )
}

export function DesignBezierPath(props: {
  points: readonly { x: number; y: number }[]
  /** Optional explicit control points between anchors. When supplied,
   * the renderer emits cubic segments (`C`) instead of the default
   * midpoint quadratic (`Q`/`T`). Length should be points.length - 1. */
  controls?: readonly ({ x: number; y: number } | null)[]
}): JSX.Element {
  // Two render modes:
  // 1. points only: emit a quadratic path with midpoints between anchors
  //    (cheap default, supports arbitrary anchor counts).
  // 2. points + controls: emit a cubic path. Null control entries fall
  //    back to the midpoint, so callers can mix-and-match segments.
  const path = (): string => {
    const points = props.points
    const controls = props.controls
    if (points.length < 2) return ""
    const head = `M ${points[0].x} ${points[0].y}`
    if (controls && controls.length > 0) {
      const segments: string[] = [head]
      for (let i = 0; i < points.length - 1; i += 1) {
        const anchor = points[i + 1]
        const explicit = controls[i]
        const prev = points[i]
        const c1 = explicit ?? { x: (prev.x + anchor.x) / 2, y: (prev.y + anchor.y) / 2 }
        const c2 = explicit ?? c1
        segments.push(`C ${c1.x} ${c1.y} ${c2.x} ${c2.y} ${anchor.x} ${anchor.y}`)
      }
      return segments.join(" ")
    }
    if (points.length === 2) {
      const mid = { x: (points[0].x + points[1].x) / 2, y: (points[0].y + points[1].y) / 2 }
      return `${head} Q ${points[1].x} ${points[1].y} ${mid.x} ${mid.y}`
    }
    const rest = points.slice(1).map((point, index) => {
      const prev = points[index]
      const cx = (prev.x + point.x) / 2
      const cy = (prev.y + point.y) / 2
      return `Q ${prev.x} ${prev.y} ${cx} ${cy}`
    })
    const tail = `T ${points[points.length - 1].x} ${points[points.length - 1].y}`
    return [head, ...rest, tail].join(" ")
  }
  return <path d={path()} fill="none" stroke="currentColor" stroke-width="1.5" data-v110="design-bezier" />
}

/** Render the editable control points (handles) of a multi-segment Bezier.
 * Each anchor plus each explicit control point gets a draggable handle,
 * so the canvas runtime can wire pointer-driven Bezier editing without
 * reimplementing the geometry. */
export function DesignBezierHandles(props: {
  points: readonly { x: number; y: number }[]
  controls: readonly ({ x: number; y: number } | null)[]
}): JSX.Element {
  return (
    <g data-v110="design-bezier-handles">
      <For each={props.points}>
        {(point, index) => (
          <rect
            x={point.x - 3}
            y={point.y - 3}
            width={6}
            height={6}
            fill="var(--background-base)"
            stroke="currentColor"
            stroke-width="1"
            data-design-bezier-anchor={index()}
          />
        )}
      </For>
      <For each={props.controls}>
        {(control, index) => {
          if (!control) return null
          return (
            <circle
              cx={control.x}
              cy={control.y}
              r={3}
              fill="none"
              stroke="currentColor"
              stroke-width="1"
              data-design-bezier-control={index()}
            />
          )
        }}
      </For>
    </g>
  )
}

/** Convenience: full MVP canvas with a tool selector and selection box. */
export function DesignVectorCanvas(props: {
  selection?: DesignSelection
  bezier?: readonly { x: number; y: number }[]
}): JSX.Element {
  const [tool, setTool] = createSignal<DesignVectorTool>("select")
  return (
    <section class="flex size-full min-h-0 flex-col" data-v110="design-vector-canvas" aria-label="Design canvas">
      <DesignVectorToolbar tool={tool()} onTool={setTool} />
      <div class="relative flex-1 bg-background-base">
        <svg class="absolute inset-0 size-full" viewBox="0 0 100 100" preserveAspectRatio="xMidYMid meet" role="img" aria-label="Design canvas surface">
          <Show when={props.bezier}>
            {(points) => <DesignBezierPath points={points()} />}
          </Show>
          <DesignSelectionHandles selection={props.selection} />
        </svg>
        <p class="absolute bottom-1 left-1 rounded bg-background-stronger px-2 py-1 text-10-regular text-text-weak">Tool: {tool()}</p>
      </div>
    </section>
  )
}
