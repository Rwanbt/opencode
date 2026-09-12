/* SPDX-License-Identifier: MIT */

import { renderDesignSpecSvg } from "./design-renderer.js"
import type { DesignSpecDiagnostic, DesignSpecPanelState } from "./design-spec.js"

export type DesignPreview = { label: "mobile" | "tablet" | "desktop"; width: number; src: string }
export type DesignPreviewPanelState = { diagnostics: readonly DesignSpecDiagnostic[]; previews: readonly DesignPreview[] }

const VIEWPORTS = [
  { label: "mobile", width: 390 },
  { label: "tablet", width: 768 },
  { label: "desktop", width: 1440 },
] as const

/** Builds the three responsive preview sources without executing generated markup. */
export function createDesignPreviewPanelState(state: DesignSpecPanelState): DesignPreviewPanelState {
  if (!state.spec || state.diagnostics.length > 0) return { diagnostics: state.diagnostics, previews: [] }
  const spec = state.spec
  const previews = VIEWPORTS.map(({ label, width }) => {
    const height = Math.round(width * 0.75)
    const svg = renderDesignSpecSvg(spec, { width, height })
    return { label, width, src: `data:image/svg+xml,${encodeURIComponent(svg)}` }
  })
  return { diagnostics: [], previews }
}
