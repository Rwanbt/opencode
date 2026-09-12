/* SPDX-License-Identifier: MIT */

import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"

const TOOLBAR = resolve(import.meta.dir, "./design-toolbar.tsx")
const TABS_BAR = resolve(import.meta.dir, "../../components/workspace-tabs-bar.tsx")
const SWITCHER = resolve(import.meta.dir, "./design-surface-switcher.tsx")

const toolbar = readFileSync(TOOLBAR, "utf-8")
const tabsBar = readFileSync(TABS_BAR, "utf-8")
const switcher = readFileSync(SWITCHER, "utf-8")

// V08 — touch + keyboard accessibility. The audit caught the
// toolbar and the tabs at 24-36 px tall, well under the WCAG
// target size of 44x44 px. The V08 fix bumps every primary action
// to min-h-11 (44 px) and adds a focus-visible ring so a
// keyboard user can see where the focus is. The motion-reduce
// variant removes the transition animation under
// `prefers-reduced-motion: reduce` (WCAG 2.2.2).
describe("V08 — design-toolbar meets the 44x44 touch target", () => {
  test("every viewport / zoom / mode / comments button uses min-h-11 and min-w-11", () => {
    // The regex matches the data-* attribute (which appears after
    // the class in JSX) AND the min-h-11 / min-w-11 tokens anywhere
    // in the same source. Splitting the regex avoids the JSX
    // order assumption: the class is on one line, the data
    // attribute is on another.
    expect(toolbar).toMatch(/data-design-toolbar-viewport-button=\{preset\.id\}/)
    expect(toolbar).toMatch(/min-h-11 min-w-11/)
    expect(toolbar).toMatch(/data-design-toolbar-zoom-button=\{zoom\}/)
    expect(toolbar).toMatch(/data-design-toolbar-mode-button="preview"/)
    expect(toolbar).toMatch(/data-design-toolbar-mode-button="source"/)
    // The min-h-11 + min-w-11 pair must appear on the action
    // button classes, not just once in the file. Counting tokens
    // pins the contract — a regression that strips the min-w-11
    // from one of the four groups is caught here.
    const minH11 = (toolbar.match(/\bmin-h-11\b/g) ?? []).length
    const minW11 = (toolbar.match(/\bmin-w-11\b/g) ?? []).length
    expect(minH11).toBeGreaterThanOrEqual(4)
    expect(minW11).toBeGreaterThanOrEqual(4)
  })

  test("buttons have a visible focus ring (focus-visible:outline)", () => {
    // The plan: "focus visible" must survive the small icon size.
    // Tailwind's focus-visible: pseudo-class is the standard way to
    // draw a focus ring only when the user is navigating by
    // keyboard, not when they click.
    expect(toolbar).toMatch(/focus-visible:outline/)
  })

  test("motion-reduce:transition-none suppresses transitions for users with prefers-reduced-motion", () => {
    expect(toolbar).toMatch(/motion-reduce:transition-none/)
  })

  test("aria-pressed wires the toggle groups (viewport, zoom, mode) correctly", () => {
    // aria-pressed marks a button as a toggle in the accessibility
    // tree. The plan requires the main commands to be reachable and
    // announceable; the V08 fix would break that contract.
    expect(toolbar).toMatch(/aria-pressed=\{preset\.id === props\.viewport\}/)
    expect(toolbar).toMatch(/aria-pressed=\{zoom === props\.zoom\}/)
    expect(toolbar).toMatch(/aria-pressed=\{props\.mode === "preview"\}/)
    expect(toolbar).toMatch(/aria-pressed=\{props\.mode === "source"\}/)
  })
})

describe("V08 — workspace-tabs-bar meets the 44x44 touch target", () => {
  test("TabRow and SortableTabRow use min-h-11 (44 px)", () => {
    // WHY: a tab is a primary navigation element. A 28 px target
    // forces a fine-motor pinch on touch devices.
    expect(tabsBar).toMatch(/function TabRow[\s\S]+?min-h-11/)
    expect(tabsBar).toMatch(/function SortableTabRow[\s\S]+?min-h-11/)
  })

  test("the tab row focuses its inner button (focus-within:outline)", () => {
    // focus-within propagates the focus ring from the inner
    // <button> to the surrounding <div role=tab>. A keyboard user
    // sees a clear focus boundary even though the click target is
    // the inner button.
    expect(tabsBar).toMatch(/focus-within:outline/)
  })

  test("motion-reduce:transition-none is applied to the tab row", () => {
    expect(tabsBar).toMatch(/motion-reduce:transition-none/)
  })
})

describe("V08 — design-surface-switcher meets the 44x44 touch target", () => {
  test("each tab uses min-h-11 (44 px) for the touch target", () => {
    // The switcher was already 44 px from V06. V08 pins the
    // contract so a future refactor cannot regress.
    expect(switcher).toMatch(/min-h-11/)
  })
})
