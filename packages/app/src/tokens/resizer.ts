/* SPDX-License-Identifier: MIT */

// A1 Wave 0 — v110 resizer contract (INTERACTIONS.md: role separator,
// arrows, Shift fast-step). Pure math for primitives/separator; the
// component owns DOM, this module owns steps and orientation.

export const STEP = 16
export const FAST = 24

export type Axis = "x" | "y"
export type Edge = "start" | "end"

export function clampSize(value: number, min: number, max: number): number {
  if (Number.isNaN(value)) return min
  return Math.min(max, Math.max(min, value))
}

// Arrow-key step for one keypress; undefined when the key is not handled.
export function delta(key: string, shift: boolean): number | undefined {
  const step = shift ? FAST : STEP
  if (key === "ArrowLeft" || key === "ArrowUp") return -step
  if (key === "ArrowRight" || key === "ArrowDown") return step
  return undefined
}

export function orientation(axis: Axis): "vertical" | "horizontal" {
  return axis === "x" ? "vertical" : "horizontal"
}

// Signed drag distance: edge "start" means the sized panel sits before the
// handle in axis order (chat left of its handle); "end" means after it
// (terminal below its handle). Positive grows the sized panel.
export function drag(base: number, origin: number, pos: number, edge: Edge): number {
  if (edge === "start") return base + (pos - origin)
  return base - (pos - origin)
}
