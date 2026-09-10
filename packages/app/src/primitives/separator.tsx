/* SPDX-License-Identifier: MIT */

import { splitProps, type JSX } from "solid-js"
import { clampSize, delta, drag, orientation, type Axis, type Edge } from "@/tokens/resizer"

export interface SeparatorProps extends Omit<JSX.HTMLAttributes<HTMLDivElement>, "onResize"> {
  axis: Axis
  edge?: Edge
  label: string
  size: number
  min: number
  max: number
  onResize: (size: number) => void
}

// WHY a new primitive next to @unifia/ui/resize-handle: ResizeHandle is
// pointer-only. The v110 contract (INTERACTIONS.md) requires role separator,
// arrow keys, Shift fast-step and Home/End. A2 adopts this for shell panels;
// session.tsx and layout.tsx keep their handles until A2 migrates them.
export function Separator(props: SeparatorProps) {
  const [local, rest] = splitProps(props, ["axis", "edge", "label", "size", "min", "max", "onResize", "class"])

  const apply = (next: number) => {
    local.onResize(clampSize(next, local.min, local.max))
  }

  const onKeyDown = (event: KeyboardEvent) => {
    const step = delta(event.key, event.shiftKey)
    if (step !== undefined) {
      event.preventDefault()
      apply(local.size + step)
      return
    }
    if (event.key === "Home") {
      event.preventDefault()
      apply(local.min)
      return
    }
    if (event.key === "End") {
      event.preventDefault()
      apply(local.max)
    }
  }

  const onPointerDown = (event: PointerEvent) => {
    if (event.button !== 0) return
    event.preventDefault()
    const edge = local.edge ?? (local.axis === "x" ? "start" : "end")
    const at = (e: PointerEvent) => (local.axis === "x" ? e.clientX : e.clientY)
    const origin = at(event)
    const base = local.size
    const prior = document.body.style.userSelect
    document.body.style.userSelect = "none"
    const onMove = (move: PointerEvent) => {
      apply(drag(base, origin, at(move), edge))
    }
    const onUp = () => {
      document.body.style.userSelect = prior
      window.removeEventListener("pointermove", onMove)
      window.removeEventListener("pointerup", onUp)
    }
    window.addEventListener("pointermove", onMove)
    window.addEventListener("pointerup", onUp)
  }

  return (
    <div
      {...rest}
      role="separator"
      aria-orientation={orientation(local.axis)}
      aria-label={local.label}
      aria-valuenow={Math.round(local.size)}
      aria-valuemin={local.min}
      aria-valuemax={local.max}
      tabindex="0"
      data-component="separator"
      data-axis={local.axis}
      class={local.class}
      onPointerDown={onPointerDown}
      onKeyDown={onKeyDown}
    />
  )
}
