/* SPDX-License-Identifier: MIT */

import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

// Static contract (same style as design-split.test.tsx): the bar renders
// what it is given, stays phone-only, keeps touch targets and safe areas.
// Plain substring matchers: no regex escaping pitfalls.
const dir = join(import.meta.dir, ".");
const nav = readFileSync(join(dir, "v110-mobile-nav.tsx"), "utf8")
const css = readFileSync(join(dir, "v110-shell.css"), "utf8")

describe("a2 mobile nav", () => {
  test("renders the given modes plus settings, never a second registry", () => {
    expect(nav.includes('data-v110="mobile-nav"')).toBe(true)
    expect(nav.includes("data-mode={mode}")).toBe(true)
    expect(nav.includes("aria-pressed={props.active() === mode}")).toBe(true)
    expect(nav.includes('data-action="mobile-settings"')).toBe(true)
    expect(nav.includes("SHELL_MODES")).toBe(false)
    expect(nav.includes("useMode")).toBe(false)
  })
  test("touch targets and safe areas follow the A1 contract", () => {
    expect(nav.includes("var(--v110-target-touch, 44px)")).toBe(true)
    expect(nav.includes("env(safe-area-inset-bottom)")).toBe(true)
    expect(nav.includes("env(safe-area-inset-left)")).toBe(true)
    expect(nav.includes("env(safe-area-inset-right)")).toBe(true)
    expect(css.includes("env(safe-area-inset-bottom)")).toBe(true)
  })
  test("phone-portrait only: hidden by default, no important", () => {
    expect(css.includes('[data-v110="mobile-nav"]')).toBe(true)
    expect(css.indexOf("display: none") !== -1 && css.indexOf("display: none") < css.indexOf("display: flex")).toBe(true)
    expect(css.includes("max-width: 599px")).toBe(true)
    expect(css.includes("!important")).toBe(false)
  })
  test("compact landscape overlays start after the compact rail", () => {
    expect(css.includes("max-height: 560px")).toBe(true)
    expect(css.includes("var(--v110-rail-compact, 62px)")).toBe(true)
  })
})
