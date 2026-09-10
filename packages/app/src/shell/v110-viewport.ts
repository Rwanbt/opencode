/* SPDX-License-Identifier: MIT */

// A2-03 v110 responsive authority (Wave 0.5). Single source, pure.
// WHY this file exists: three threshold sets compete (A1-CONTRACT P1-1).
// classify (1200/900/600 plus landscape h<=560 and w<=980) is the only
// authority the shell reads. use-mobile-layout (768/1024, createSignal)
// and design-responsive (1024/768, pure) stay working for their current
// callers until their owners rebase, but shell code must never import
// them: the contract test below fails on such an import (P1-1, P1-6).
// Legacy mapping (read-only, for migration reviews, never branched on):
//   isMobile (<768)  -> phone-portrait, plus tablet 600-767 portrait.
//   isTablet (768..1023) -> tablet-portrait, plus desktop-compact 900-1023
//     and compact-landscape 768-980 short landscape.
//   design mobile (<768) / tablet (<1024) / desktop: same buckets.
// Gap 840-899 (unnamed by the manifest) is cut by orientation:
// portrait stays tablet (overlay, chat/main), landscape joins
// desktop-compact (single utility, split kept).

import { classify, cohabit, exclusive, layouts, side, type Layout, type Viewport } from "@/tokens/viewport"

export type { Layout, Viewport }
export type Legacy = "mobile" | "tablet" | "desktop"

export function legacy(width: number): Legacy {
  if (!Number.isFinite(width) || width < 0) return "desktop"
  if (width < 768) return "mobile"
  if (width < 1024) return "tablet"
  return "desktop"
}

type Summary = { id: Viewport; side: ReturnType<typeof side>; layouts: Layout[]; wide: boolean; single: boolean }

export function describe(width: number, height: number): Summary {
  const id = classify(width, height)
  return { id, side: side(id), layouts: layouts(id), wide: cohabit(id), single: exclusive(id) }
}
