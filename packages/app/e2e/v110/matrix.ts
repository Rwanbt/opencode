/* SPDX-License-Identifier: MIT */

// A8-01 Wave 0.5 cartesian matrix. Pure: no DOM, no I/O.
// Expected ids derive from the A1 contract (tokens/viewport classify).
// Mission viewports plus a few pixels around each breakpoint so A2
// threshold regressions fail here, not in production.

import type { Viewport } from "../../src/tokens/viewport"

export type Case = { name: string; width: number; height: number; id: Viewport }

export const WAVE05: Case[] = [
  { name: "desktop-1440x900", width: 1440, height: 900, id: "desktop-wide" },
  { name: "desktop-1280x800", width: 1280, height: 800, id: "desktop-wide" },
  { name: "compact-1024x768", width: 1024, height: 768, id: "desktop-compact" },
  { name: "tablet-768x1024", width: 768, height: 1024, id: "tablet-portrait" },
  { name: "phone-390x844", width: 390, height: 844, id: "phone-portrait" },
  { name: "phone-360x800", width: 360, height: 800, id: "phone-portrait" },
  { name: "landscape-844x390", width: 844, height: 390, id: "compact-landscape" },
  { name: "edge-wide-1200", width: 1200, height: 800, id: "desktop-wide" },
  { name: "edge-wide-1199", width: 1199, height: 800, id: "desktop-compact" },
  { name: "edge-compact-900", width: 900, height: 700, id: "desktop-compact" },
  { name: "edge-gap-899x1000", width: 899, height: 1000, id: "tablet-portrait" },
  { name: "edge-gap-899x600", width: 899, height: 600, id: "desktop-compact" },
  { name: "edge-tablet-600", width: 600, height: 800, id: "tablet-portrait" },
  { name: "edge-phone-599", width: 599, height: 800, id: "phone-portrait" },
  { name: "edge-land-981x390", width: 981, height: 390, id: "desktop-compact" },
  { name: "edge-land-844x561", width: 844, height: 561, id: "desktop-compact" },
]