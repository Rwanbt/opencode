/* SPDX-License-Identifier: MIT */

import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"

const SWITCHER = resolve(import.meta.dir, "./design-surface-switcher.tsx")
const source = readFileSync(SWITCHER, "utf-8")

// V06 — the surface switcher is a small component, but the contract
// is what keeps the mobile layout accessible. Static tests read the
// source and assert the structural contract: role, a11y label, two
// tabs, button size, focus handling.
describe("V06 — DesignSurfaceSwitcher contract", () => {
  test("renders a tablist with the two surfaces (assistant + atelier)", () => {
    expect(source).toMatch(/role="tablist"/)
    expect(source).toMatch(/data-design-surface-switcher/)
    expect(source).toMatch(/data-design-surface-tab=\{option\.id\}/)
    expect(source).toMatch(/id: "assistant"/)
    expect(source).toMatch(/id: "atelier"/)
  })

  test("each tab is a real button with role=tab and the right aria-selected wiring", () => {
    expect(source).toMatch(/role="tab"/)
    expect(source).toMatch(/aria-selected=\{props\.surface === option\.id \? "true" : "false"\}/)
    // WHY: the tablist pattern requires only the active tab to be in
    // the natural tab order. Roving tabindex keeps the keyboard
    // navigation predictable and avoids the hidden panel stealing
    // focus (a screen reader would announce it as available).
    expect(source).toMatch(/tabindex=\{props\.surface === option\.id \? 0 : -1\}/)
    expect(source).toMatch(/onKeyDown=\{\(event\) => moveFocus\(event, option\.id\)\}/)
    expect(source).toMatch(/event\.key === "ArrowRight"/)
    expect(source).toMatch(/event\.key === "ArrowLeft"/)
    expect(source).toMatch(/event\.key === "Home"/)
    expect(source).toMatch(/event\.key === "End"/)
  })

  test("uses translation keys for the surface labels (no hardcoded strings)", () => {
    // WHY: the user's locale must drive the switcher. Hardcoding
    // "Assistant" / "Atelier" would lock the UI to French or
    // English; the plan §4 decision 9 also expects the rest of the
    // design surface to follow i18n.
    expect(source).toMatch(/workbench\.design\.surface\.assistant/)
    expect(source).toMatch(/workbench\.design\.surface\.atelier/)
    expect(source).toMatch(/workbench\.design\.surfaceSwitcherLabel/)
  })

  test("buttons meet the touch-target minimum (min-h-11 = 44px in Tailwind)", () => {
    // The plan §4 decision 9 (V08 will harden this for the rest of
    // the surface). The switcher is V06's only touch surface, so the
    // minimum is asserted here.
    expect(source).toMatch(/min-h-11/)
  })
})
