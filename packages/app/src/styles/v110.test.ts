/* SPDX-License-Identifier: MIT */

import { afterEach, describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"

const APP_ENTRY = resolve(import.meta.dir, "..", "..", "src", "index.css")
const V110_CSS = resolve(import.meta.dir, "..", "..", "src", "styles", "v110.css")

// A1 Wave 0 — v110.css contract. Follows the unifia-brand.test.ts pattern:
// string match for the cascade wiring plus a happy-dom smoke for :root.
describe("A1 — v110.css shell contract is wired into the app", () => {
  test("index.css imports v110.css once, after brand", () => {
    const css = readFileSync(APP_ENTRY, "utf8")
    const matches = css.match(/@import\s+["']@\/styles\/v110\.css["']/g) ?? []
    expect(matches.length).toBe(1)
    expect(css.indexOf("@/styles/v110.css")).toBeGreaterThan(css.indexOf("@/styles/unifia-brand.css"))
  })

  test("shell geometry matches the maquette tokens", () => {
    const css = readFileSync(V110_CSS, "utf8")
    for (const token of [
      "--v110-topbar: 48px",
      "--v110-rail: 78px",
      "--v110-rail-compact: 62px",
      "--v110-context: 248px",
      "--v110-inspector: 300px",
      "--v110-chat: 348px",
      "--v110-chat-min: 280px",
      "--v110-chat-max: 620px",
      "--v110-radius-sm: 10px",
      "--v110-radius-md: 12px",
      "--v110-radius-lg: 15px",
      "--v110-radius-xl: 18px",
      "--v110-target: 31px",
      "--v110-target-touch: 44px",
    ])
      expect(css).toContain(token)
  })

  test("narrow-desktop overrides, focus and motion contracts are present", () => {
    const css = readFileSync(V110_CSS, "utf8")
    expect(css).toContain("@media (max-width: 1360px)")
    expect(css).toContain("--v110-context: 220px")
    expect(css).toContain("--v110-chat: 330px")
    expect(css).toContain("--v110-inspector: 280px")
    expect(css).toContain("--v110-focus:")
    expect(css).toContain(":where(button, input, textarea, select, [tabindex]):focus-visible")
    expect(css).toContain("--v110-ease: cubic-bezier(0.16, 0.84, 0.2, 1)")
    expect(css).toContain("prefers-reduced-motion")
    expect(css).toContain('html[data-ui-animations="off"]')
  })

  test("the sheet never masks architecture with important", () => {
    expect(readFileSync(V110_CSS, "utf8")).not.toContain("!important")
  })

  test("loading the sheet exposes --v110-topbar on :root", () => {
    const css = readFileSync(V110_CSS, "utf8")
    const style = document.createElement("style")
    style.setAttribute("data-v110-smoke", "true")
    style.textContent = css
    document.head.appendChild(style)
    try {
      const value = getComputedStyle(document.documentElement).getPropertyValue("--v110-topbar").trim()
      expect(value).toBe("48px")
    } finally {
      style.remove()
    }
  })
})

afterEach(() => {
  for (const node of Array.from(document.head.querySelectorAll("style[data-v110-smoke]"))) node.remove()
})
