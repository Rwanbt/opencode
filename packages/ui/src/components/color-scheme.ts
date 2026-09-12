/* SPDX-License-Identifier: MIT */
import { createSignal, onCleanup, onMount } from "solid-js"

/**
 * The active colour scheme, as published by the theme preload script.
 *
 * `packages/app/public/oc-theme-preload.js` writes `data-color-scheme` onto
 * <html> before first paint and the settings UI rewrites it live, so a brand
 * asset picked once at mount would be stale the moment the user switches
 * themes — hence the observer rather than a plain read.
 */
export function readColorScheme(): "light" | "dark" {
  if (typeof document !== "object") return "light"
  return document.documentElement.dataset.colorScheme === "dark" ? "dark" : "light"
}

export function useColorScheme() {
  const [scheme, setScheme] = createSignal(readColorScheme())

  onMount(() => {
    const sync = () => setScheme(readColorScheme())
    const observer = new MutationObserver(sync)
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-color-scheme"],
    })
    sync()
    onCleanup(() => observer.disconnect())
  })

  return scheme
}
