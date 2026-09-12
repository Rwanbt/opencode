/* SPDX-License-Identifier: MIT */

// A1 Wave 0 — canonical v110 viewport contract (manifest build
// v110-port-ready-r1, authorities ResponsiveV98 / PortReadyV110).
// Pure: no DOM, no signals. A2 wires this into the single responsive
// store; use-mobile-layout and design-responsive keep working until then.

export const WIDE = 1200
export const COMPACT = 900
export const TABLET = 600
export const LANDSCAPE_H = 560
export const LANDSCAPE_W = 980

export type Viewport = "desktop-wide" | "desktop-compact" | "tablet-portrait" | "phone-portrait" | "compact-landscape"
export type Side = "grid" | "single" | "overlay"
export type Layout = "chat" | "split" | "main"

export function classify(width: number, height: number): Viewport {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return "desktop-wide"
  if (height <= LANDSCAPE_H && width <= LANDSCAPE_W && width > height) return "compact-landscape"
  if (width >= WIDE) return "desktop-wide"
  if (width >= COMPACT) return "desktop-compact"
  // WHY two gap buckets: the manifest leaves 840-899 portrait and 600-899
  // landscape unnamed. Portrait under 900 stays tablet (overlay, chat/main);
  // landscape under 900 joins desktop-compact (single utility, split kept).
  if (width > height) return "desktop-compact"
  if (width >= TABLET) return "tablet-portrait"
  return "phone-portrait"
}

export function side(id: Viewport): Side {
  if (id === "desktop-wide") return "grid"
  if (id === "desktop-compact") return "single"
  return "overlay"
}

export function layouts(id: Viewport): Layout[] {
  if (id === "tablet-portrait" || id === "phone-portrait") return ["chat", "main"]
  return ["chat", "split", "main"]
}

export function cohabit(id: Viewport): boolean {
  return id === "desktop-wide"
}

export function exclusive(id: Viewport): boolean {
  return id === "desktop-compact"
}

export type Case = { id: Viewport; width: number; height: number }

// Certification cases from the manifest e2eContract (A8 Port Gate).
export const CASES: Case[] = [
  { id: "desktop-wide", width: 1440, height: 900 },
  { id: "desktop-compact", width: 1024, height: 768 },
  { id: "tablet-portrait", width: 768, height: 1024 },
  { id: "phone-portrait", width: 390, height: 844 },
  { id: "compact-landscape", width: 844, height: 390 },
]
