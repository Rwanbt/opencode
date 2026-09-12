/* SPDX-License-Identifier: MIT */

import { describe, expect, test } from "bun:test"
import { POINTS_PER_INCH, planPdfPages, EmptyRenderError, isEmptyRenderCapture, type CapturedPage } from "../src/export-pdf"

const cap = (index: number, w: number, h: number, dataUrl?: string): CapturedPage => ({
  index,
  w,
  h,
  dataUrl: dataUrl ?? "data:image/png;base64," + "A".repeat(200),
})

describe("planPdfPages", () => {
  test("a wide capture is landscape", () => {
    const plan = planPdfPages([cap(0, 1920, 1080)])
    expect(plan).toEqual([{ index: 0, orientation: "landscape", widthPt: 1920, heightPt: 1080 }])
  })

  test("a tall capture is portrait", () => {
    const plan = planPdfPages([cap(0, 800, 1200)])
    expect(plan).toEqual([{ index: 0, orientation: "portrait", widthPt: 800, heightPt: 1200 }])
  })

  test("a square capture is treated as landscape (tie-breaker)", () => {
    const plan = planPdfPages([cap(0, 1000, 1000)])
    expect(plan[0]?.orientation).toBe("landscape")
  })

  test("a mixed batch keeps the per-page orientation", () => {
    const plan = planPdfPages([cap(0, 1920, 1080), cap(1, 800, 1200), cap(2, 600, 600)])
    expect(plan.map((p) => p.orientation)).toEqual(["landscape", "portrait", "landscape"])
    expect(plan.map((p) => p.index)).toEqual([0, 1, 2])
  })

  test("an empty batch produces an empty plan", () => {
    expect(planPdfPages([])).toEqual([])
  })

  test("a capture flagged as empty-render is refused with EmptyRenderError", () => {
    const emptyDataUrl = "data:image/png;base64,"
    expect(() => planPdfPages([cap(0, 1920, 1080, emptyDataUrl + "short")])).toThrow(EmptyRenderError)
  })

  test("the page index is carried into the error", () => {
    try {
      planPdfPages([cap(0, 100, 100, "data:image/png;base64,")])
    } catch (error) {
      expect(error).toBeInstanceOf(EmptyRenderError)
      if (error instanceof EmptyRenderError) expect(error.pageIndex).toBe(0)
    }
  })

  test("POINTS_PER_INCH is 72 (the constant the planner uses)", () => {
    expect(POINTS_PER_INCH).toBe(72)
  })
})

describe("isEmptyRenderCapture", () => {
  test("a near-empty base64 payload is detected", () => {
    expect(isEmptyRenderCapture(cap(0, 100, 100, "data:image/png;base64,AAAA"))).toBe(true)
  })

  test("a real-looking data URL is not flagged as empty", () => {
    const real = "data:image/png;base64," + "A".repeat(200)
    expect(isEmptyRenderCapture(cap(0, 100, 100, real))).toBe(false)
  })

  test("a non-data URL is not flagged as empty", () => {
    expect(isEmptyRenderCapture(cap(0, 100, 100, "https://example.com/img.png"))).toBe(false)
  })
})
