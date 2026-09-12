/* SPDX-License-Identifier: MIT */

import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"

const SPLIT = resolve(import.meta.dir, "./design-split.tsx")
const source = readFileSync(SPLIT, "utf-8")

// V06 — the split must read the viewport, consume V05's model, and
// render the three regimes. Static tests assert the structural
// contract: the resolver is wired, the resize is gated on
// `resizable`, the switcher is rendered only on mobile, and the
// hidden surface is not focusable.
describe("V06 — DesignSplit consumes the responsive model", () => {
  test("imports the V05 resolver and viewport-aware clamp", () => {
    expect(source).toMatch(/resolveLayout/)
    expect(source).toMatch(/clampChatWidthForViewport/)
    expect(source).toMatch(/pickMobileSurface/)
  })

  test("tracks window.innerWidth and reacts to resize", () => {
    expect(source).toMatch(/window\.innerWidth/)
    expect(source).toMatch(/addEventListener\("resize"/)
    expect(source).toMatch(/removeEventListener\("resize"/)
  })

  test("the resize handler and the keyboard handler both bail when the layout is not resizable", () => {
    // The plan's V06: "désactiver le resize hors desktop." Tablet must
    // not start a drag, and the keyboard shortcuts must be inert.
    expect(source).toMatch(/if \(!layout\(\)\.resizable\) return/)
  })

  test("mobile renders the switcher and exactly one surface", () => {
    expect(source).toMatch(/data-design-split-mobile/)
    expect(source).toMatch(/DesignSurfaceSwitcher/)
    expect(source).toMatch(/data-design-split-assistant/)
    expect(source).toMatch(/data-design-split-atelier/)
  })

  test("non-mobile renders the chat + handle + workspace trio", () => {
    expect(source).toMatch(/data-design-split-chat/)
    expect(source).toMatch(/data-design-split-handle/)
    expect(source).toMatch(/data-design-split-workspace/)
  })

  test("the grid template changes per regime (mobile collapses, tablet caps the chat, desktop honours the var)", () => {
    // WHY: the plan §4 decision 4 forbids any minimum from exceeding
    // the viewport. The mobile branch must collapse to a single
    // `minmax(0, 1fr)`, the tablet branch must use a px width that
    // is bounded by V05's `chatWidth`, and the desktop branch must
    // keep the resizable var.
    expect(source).toMatch(/if \(layout\(\)\.kind === "mobile"\) return "minmax\(0, 1fr\)"/)
    expect(source).toMatch(/if \(layout\(\)\.kind === "tablet"\)[\s\S]+?\$\{layout\(\)\.chatWidth\}px/)
  })

  test("safe-area insets are applied (mobile + iOS notch)", () => {
    // The plan's V06: "respecter safe areas." The CSS env() calls are
    // the only portable way; this guards against a refactor that
    // drops them.
    expect(source).toMatch(/env\(safe-area-inset-top/)
    expect(source).toMatch(/env\(safe-area-inset-bottom/)
  })

  test("the data attribute announces the regime so the runtime test can target it", () => {
    // V15 (browser gate) checks `scrollWidth <= innerWidth` at four
    // viewports. The runtime test needs a stable selector; the
    // data-design-split-kind attribute gives it.
    expect(source).toMatch(/data-design-split-kind=\{layout\(\)\.kind\}/)
  })

  test("the mobile surface choice is persisted under the same key as the chat width", () => {
    // WHY: the user's last mobile selection must survive a
    // worktree change. Persisting it next to chatWidth means the
    // workspace-level store already covers it; no new key, no new
    // migration.
    expect(source).toMatch(/mobileSurface: "assistant"/)
    expect(source).toMatch(/setPreferences\("mobileSurface", surface\)/)
  })
})
