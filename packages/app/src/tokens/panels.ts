/* SPDX-License-Identifier: MIT */

// A1 Wave 0 — canonical v110 panel contract (manifest build
// v110-port-ready-r1, authorities LayoutControllerV98 / CanonicalV110).
// Pure: no DOM, no signals. Widths mirror styles/v110.css; the CSS owns
// rendering, this module owns logic (invariants, clamps, visibility).

import type { Viewport } from "@/tokens/viewport"

export const TOPBAR = 48
export const RAIL = 78
export const RAIL_COMPACT = 62
export const CONTEXT = 248
export const INSPECTOR = 300
export const CHAT = 348
export const CHAT_MIN = 280
export const CHAT_MAX = 620
export const NARROW = 1360
export const CONTEXT_NARROW = 220
export const CHAT_NARROW = 330
export const INSPECTOR_NARROW = 280

export type Panel = "context" | "inspector"
// Graph is a Memory sub-view, never a global layout (COMPONENT-MAP §1).
export type MemoryView = "note" | "graph"

export function clamp(value: number, min: number, max: number): number {
  if (Number.isNaN(value)) return min
  return Math.min(max, Math.max(min, value))
}

export function narrow(width: number): boolean {
  return width <= NARROW
}

export function width(panel: Panel | "chat", viewport: number): number {
  if (panel === "context") return narrow(viewport) ? CONTEXT_NARROW : CONTEXT
  if (panel === "inspector") return narrow(viewport) ? INSPECTOR_NARROW : INSPECTOR
  return narrow(viewport) ? CHAT_NARROW : CHAT
}

// Visible panels for one viewport given the panels opened last-first.
// desktop-wide cohabits; desktop-compact keeps the last opened only;
// overlays render the full stack with the last opened on top.
export function visible(open: Panel[], id: Viewport): Panel[] {
  const order = open.filter((panel, index) => open.indexOf(panel) === index)
  if (id === "desktop-compact") return order.slice(-1)
  return order
}
