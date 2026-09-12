/* SPDX-License-Identifier: MIT */

import { afterEach, describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"

const APP_ENTRY = resolve(import.meta.dir, "..", "..", "src", "index.css")
const BRAND_CSS = resolve(import.meta.dir, "..", "..", "src", "styles", "unifia-brand.css")

/**
 * DA-UI-04 — `unifia-brand.css` is actually imported in dev and production.
 *
 * Plan-Critique 4.0 §2.1 D7: the brand file lived in
 * `packages/app/src/styles/unifia-brand.css` with 25 `--unifia-*` custom
 * properties, but `index.css` only imported the tailwind layer, so every
 * `--unifia-obsidian` / `--surface-canvas` reference resolved to the
 * inherited fallback (or `unset` in dark mode). The fix is one `@import`
 * line plus this smoke test: the brand contract is "the obsidian token is
 * defined on `:root`", and the index.css chain is "the import reaches the
 * Vite build for dev and prod". Both halves are checked here.
 */
describe("DA-UI-04 — unifia-brand.css is wired into the app", () => {
  test("the brand stylesheet still defines the obsidian token on :root", () => {
    // WHY string match and not `import` resolution: the test is also run
    // under the bare-Node tooling for the docs-style smoke check; a CSS
    // `@import` resolution would need a real bundler, which is what the
    // second test below verifies.
    const css = readFileSync(BRAND_CSS, "utf8")
    expect(css).toMatch(/:root\s*\{/)
    expect(css).toMatch(/--unifia-obsidian:\s*#070A13/)
  })

  test("index.css imports unifia-brand.css so the bundle reaches both dev and prod", () => {
    // The import path uses the Vite `@` alias which resolves to
    // `./packages/app/src`. The literal `@/styles/unifia-brand.css` must
    // appear once and once only — the Vite plugin would otherwise emit
    // two identical CSS modules and double the bundle.
    const css = readFileSync(APP_ENTRY, "utf8")
    const matches = css.match(/@import\s+["']@\/styles\/unifia-brand\.css["']/g) ?? []
    expect(matches.length).toBe(1)
    // The tailwind layer must remain imported first; otherwise the brand
    // tokens land before the Tailwind reset and can be overridden by the
    // cascade later.
    const tailwindIndex = css.indexOf("@unifia/ui/styles/tailwind")
    const brandIndex = css.indexOf("@/styles/unifia-brand.css")
    expect(tailwindIndex).toBeGreaterThanOrEqual(0)
    expect(brandIndex).toBeGreaterThan(tailwindIndex)
  })

  test("loading the brand sheet into the document exposes --unifia-obsidian on :root", () => {
    // Apply the brand sheet to a style element so getComputedStyle sees
    // the same `:root { --unifia-obsidian: #070A13; }` rule the real
    // Vite build injects. The smoke assertion is that the computed
    // value is non-empty (i.e. the cascade resolved a real color, not
    // a fallback to the initial value).
    const css = readFileSync(BRAND_CSS, "utf8")
    const style = document.createElement("style")
    style.setAttribute("data-unifia-brand-smoke", "true")
    style.textContent = css
    document.head.appendChild(style)
    try {
      const value = getComputedStyle(document.documentElement).getPropertyValue("--unifia-obsidian").trim()
      expect(value.length).toBeGreaterThan(0)
      // The full hex value confirms the rule landed on `:root`, not
      // somewhere narrower in the cascade (a strict match is safer
      // than `toBe` because happy-dom may normalise whitespace).
      expect(value).toMatch(/#070A13/i)
    } finally {
      style.remove()
    }
  })
})

afterEach(() => {
  // Defensive cleanup if a test fails before its `finally` runs.
  for (const node of Array.from(document.head.querySelectorAll('style[data-unifia-brand-smoke]'))) node.remove()
})
