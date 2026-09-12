/* SPDX-License-Identifier: MIT */

/**
 * P26 — Plan the page size of a PDF export from a batch of captures.
 *
 * The plan is a pure transformation: the same input always produces
 * the same output. The plan is consumed by a downstream builder that
 * knows how to assemble a PDF — the planner does not write one itself.
 *
 * The conversion from pixels to points uses 72 dpi by convention
 * (1 CSS pixel = 1 point at 72 dpi). The constant is named
 * `POINTS_PER_INCH` and reused everywhere; the per-page size is
 * derived from the capture's pixel dimensions.
 */

export const POINTS_PER_INCH = 72

export type CapturedPage = {
  dataUrl: string
  w: number
  h: number
  index: number
}

export type PdfPagePlan = {
  index: number
  orientation: "portrait" | "landscape"
  widthPt: number
  heightPt: number
}

const EMPTY_RENDER_FRAGMENT = "data:image/png;base64,"

/**
 * Detects a capture that the snapshot bridge flagged as empty (the
 * bridge emits `error: "empty-render"` and surfaces a near-empty PNG).
 * The check is intentionally conservative: a non-empty data URL is
 * at least the `data:image/png;base64,` prefix plus some payload.
 */
export function isEmptyRenderCapture(capture: CapturedPage): boolean {
  if (!capture.dataUrl.startsWith(EMPTY_RENDER_FRAGMENT)) return false
  const payload = capture.dataUrl.slice(EMPTY_RENDER_FRAGMENT.length)
  // A base64 string for a near-empty image is short; the threshold
  // is intentionally generous because icons and backgrounds can be
  // visually small yet non-blank.
  return payload.length < 64
}

export class EmptyRenderError extends Error {
  constructor(public readonly pageIndex: number) {
    super(`page ${pageIndex} is an empty render`)
    this.name = "EmptyRenderError"
  }
}

/**
 * Plans the page sizes for a PDF. The function refuses to plan an
 * empty render: any capture flagged by the snapshot bridge as empty
 * is reported with `EmptyRenderError`, never silently inserted.
 */
export function planPdfPages(pages: readonly CapturedPage[]): readonly PdfPagePlan[] {
  const plan: PdfPagePlan[] = []
  for (const page of pages) {
    if (isEmptyRenderCapture(page)) throw new EmptyRenderError(page.index)
    const orientation: "portrait" | "landscape" = page.w >= page.h ? "landscape" : "portrait"
    plan.push({
      index: page.index,
      orientation,
      widthPt: page.w,
      heightPt: page.h,
    })
  }
  return plan
}
