import { beforeEach, describe, expect, test } from "bun:test"

const src = await Bun.file(new URL("../public/oc-theme-preload.js", import.meta.url)).text()

const run = () => Function(src)()

beforeEach(() => {
  document.head.innerHTML = ""
  document.documentElement.removeAttribute("data-theme")
  document.documentElement.removeAttribute("data-color-scheme")
  document.documentElement.removeAttribute("style")
  localStorage.clear()
  Object.defineProperty(window, "matchMedia", {
    value: () =>
      ({
        matches: false,
      }) as MediaQueryList,
    configurable: true,
  })
})

describe("theme preload", () => {
  test("migrates legacy oc-1 to oc-2 before mount", () => {
    localStorage.setItem("opencode-theme-id", "oc-1")
    localStorage.setItem("opencode-theme-css-light", JSON.stringify({ "background-base": "#fff" }))
    localStorage.setItem("opencode-theme-css-dark", JSON.stringify({ "background-base": "#000" }))

    run()

    expect(document.documentElement.dataset.theme).toBe("oc-2")
    expect(document.documentElement.dataset.colorScheme).toBe("light")
    expect(localStorage.getItem("opencode-theme-id")).toBe("oc-2")
    expect(localStorage.getItem("opencode-theme-css-light")).toBeNull()
    expect(localStorage.getItem("opencode-theme-css-dark")).toBeNull()
    expect(document.getElementById("oc-theme-preload")).toBeNull()
  })

  // Applying the cached theme via a runtime <style> element's textContent is
  // exactly the pattern Android WebView's CSP silently drops for CodeMirror
  // and the read-only viewer (see code-mirror.tsx, pierre/index.ts). This
  // writes each custom property directly onto <html>'s own style attribute
  // via the CSSOM instead, which survives it on every platform.
  test("applies cached tokens as inline custom properties for non-default themes", () => {
    localStorage.setItem("opencode-theme-id", "nightowl")
    localStorage.setItem("opencode-theme-css-light", JSON.stringify({ "background-base": "#fff", "text-base": "#111" }))

    run()

    expect(document.documentElement.dataset.theme).toBe("nightowl")
    expect(document.documentElement.style.getPropertyValue("--background-base")).toBe("#fff")
    expect(document.documentElement.style.getPropertyValue("--text-base")).toBe("#111")
    expect(document.documentElement.style.getPropertyValue("color-scheme")).toBe("light")
    // No runtime <style> element — the whole point of the fix.
    expect(document.getElementById("oc-theme-preload")).toBeNull()
  })

  test("ignores a pre-existing non-JSON cache from before this format change", () => {
    localStorage.setItem("opencode-theme-id", "nightowl")
    localStorage.setItem("opencode-theme-css-light", "--background-base:#fff;")

    expect(run).not.toThrow()
    expect(document.documentElement.dataset.theme).toBe("nightowl")
    expect(document.documentElement.style.getPropertyValue("--background-base")).toBe("")
  })
})
