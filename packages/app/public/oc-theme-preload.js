;(function () {
  var key = "opencode-theme-id"
  var themeId = localStorage.getItem(key) || "oc-2"

  if (themeId === "oc-1") {
    themeId = "oc-2"
    localStorage.setItem(key, themeId)
    localStorage.removeItem("opencode-theme-css-light")
    localStorage.removeItem("opencode-theme-css-dark")
  }

  var scheme = localStorage.getItem("opencode-color-scheme") || "system"
  var isDark = scheme === "dark" || (scheme === "system" && matchMedia("(prefers-color-scheme: dark)").matches)
  var mode = isDark ? "dark" : "light"

  document.documentElement.dataset.theme = themeId
  document.documentElement.dataset.colorScheme = mode

  if (themeId === "oc-2") return

  var cached = localStorage.getItem("opencode-theme-css-" + mode)
  if (!cached) return

  // Setting a runtime <style> element's textContent is silently dropped by
  // Android WebView's CSP (same failure mode fixed for syntax highlighting in
  // code-mirror.tsx/pierre — the element lands in the DOM but the declaration
  // never applies). Writing each custom property directly onto <html>'s own
  // style attribute via the CSSOM survives it instead, on every platform.
  var tokens
  try {
    tokens = JSON.parse(cached)
  } catch (e) {
    // Pre-existing cache from before this file switched formats (CSS text,
    // not JSON): ignore it. The real theme context re-applies moments later
    // once the app boots, this only affects the first paint of one upgrade.
    return
  }

  var root = document.documentElement.style
  for (var key in tokens) {
    if (Object.prototype.hasOwnProperty.call(tokens, key)) {
      root.setProperty("--" + key, tokens[key])
    }
  }
  root.setProperty("color-scheme", mode)
  root.setProperty("--text-mix-blend-mode", isDark ? "plus-lighter" : "multiply")
})()
