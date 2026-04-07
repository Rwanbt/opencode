import { describe, expect, test } from "bun:test"
import { readFileSync } from "fs"
import { resolve } from "path"

/**
 * Validates that the mobile CSS file contains all critical rules
 * and does NOT contain dangerous overrides that break Android WebView.
 */

const mobileCssPath = resolve(__dirname, "../../../mobile/src/mobile.css")
let css: string

try {
  css = readFileSync(mobileCssPath, "utf-8")
} catch {
  css = ""
}

describe("mobile.css validation", () => {
  test("file exists and is non-empty", () => {
    expect(css.length).toBeGreaterThan(0)
  })

  // ─── Critical rules that MUST exist ───

  test("has touch target rules (min 44px)", () => {
    expect(css).toContain("min-width: 44px")
    expect(css).toContain("min-height: 44px")
  })

  test("has safe area inset rules", () => {
    expect(css).toContain("safe-area-inset-left")
    expect(css).toContain("safe-area-inset-right")
  })

  test("has root viewport constraints", () => {
    expect(css).toContain("100dvh")
  })

  test("has prompt input font-size override (prevents iOS zoom)", () => {
    expect(css).toContain('[data-component="prompt-input"]')
    expect(css).toContain("font-size: 16px")
  })

  test("has mobile sidebar max-width constraint", () => {
    expect(css).toContain("85vw")
  })

  test("has terminal panel constraints", () => {
    expect(css).toContain("#terminal-panel")
    expect(css).toContain("min-height: 120px")
  })

  test("has diff view overflow rules", () => {
    expect(css).toContain('[data-slot="diff-view"]')
    expect(css).toContain("overflow-x: auto")
  })

  test("has dialog sizing rules", () => {
    expect(css).toContain('[data-slot="dialog-content"]')
    expect(css).toContain("calc(100vw - 32px)")
  })

  test("has settings dialog responsive rules", () => {
    expect(css).toContain(".settings-dialog")
    expect(css).toContain("flex-direction: column")
  })

  test("has momentum scrolling", () => {
    expect(css).toContain("-webkit-overflow-scrolling: touch")
  })

  test("has tap highlight override", () => {
    expect(css).toContain("-webkit-tap-highlight-color")
  })

  // ─── Dangerous patterns that MUST NOT exist on prompt-input ───

  test("does NOT override color on prompt-input contenteditable", () => {
    // Extract the prompt-input rule block
    const promptInputIdx = css.indexOf('[data-component="prompt-input"]')
    if (promptInputIdx === -1) return // handled by existence test above

    // Find the closing brace of this rule
    const ruleStart = css.indexOf("{", promptInputIdx)
    const ruleEnd = css.indexOf("}", ruleStart)
    const promptRule = css.slice(ruleStart, ruleEnd + 1)

    // These properties break Android WebView contenteditable rendering
    expect(promptRule).not.toContain("-webkit-text-fill-color")
    expect(promptRule).not.toContain("opacity:")

    // color is OK only as part of a comment
    const colorMatches = promptRule.match(/(?<!\/\*.*)\bcolor\s*:/g)
    expect(colorMatches).toBeNull()
  })

  test("does NOT apply user-select:none to body or root", () => {
    // user-select:none on body breaks contenteditable on Android WebView
    // It should only be applied to specific non-text elements
    const bodyUserSelect = css.match(/body\s*\{[^}]*user-select\s*:\s*none/i)
    expect(bodyUserSelect).toBeNull()
  })

  // ─── Mobile-specific feature CSS ───

  test("has session dock mobile rules", () => {
    expect(css).toContain('[data-component="session-dock"]')
  })

  test("has message timeline mobile padding", () => {
    expect(css).toContain('[data-component="message-timeline"]')
  })

  test("has mobile side panel rules", () => {
    expect(css).toContain("mobile-side-panel")
  })
})
