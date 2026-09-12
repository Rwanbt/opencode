/* SPDX-License-Identifier: MIT */

import { createSignal, onCleanup, Show, type JSX } from "solid-js"
import { invoke } from "@tauri-apps/api/core"
import { normalizeBrowserAddress, type BrowserHistoryAction } from "@/pages/workbench/design-browser-model"

/**
 * Phase 14 — a browser tab drives a real Tauri WebView window, not an iframe:
 * an iframe inherits the host document's security boundary and is refused
 * outright by most sites' frame-ancestors policy.
 *
 * The tab owns its window. `onCleanup` closes it when the tab closes, and the
 * Rust side keeps at most DESIGN_BROWSER_CAP of them alive, so the WebView
 * count never grows with the number of URLs visited.
 *
 * The iframe below is the non-Tauri fallback (web/dev builds have no `invoke`
 * host). It stays empty until a native open actually fails, so the desktop
 * build never pays for a second document it does not use.
 */
export function DesignBrowserTab(): JSX.Element {
  const [address, setAddress] = createSignal("")
  const [fallbackUrl, setFallbackUrl] = createSignal("")
  const [label, setLabel] = createSignal<string>()
  const [error, setError] = createSignal<string>()

  const closeWindow = () => {
    const current = label()
    if (!current) return
    setLabel(undefined)
    void invoke("close_design_browser", { label: current }).catch(() => undefined)
  }
  onCleanup(closeWindow)

  const open = async (event: Event) => {
    event.preventDefault()
    const next = normalizeBrowserAddress(address())
    if (!next) {
      setError("Saisis une adresse http(s).")
      return
    }
    setAddress(next)
    setError(undefined)
    try {
      const opened = await invoke<string>("open_design_browser", { url: next })
      setLabel(opened)
      setFallbackUrl("")
    } catch (cause) {
      // No native host (web/dev build), or the window refused to build. The
      // inline frame is a genuine fallback only off the desktop: the packaged
      // app's CSP is `frame-src 'self' data:`, so a remote URL renders blank
      // there and widening it would let any artifact embed remote content.
      // Say so rather than leaving an unexplained empty panel.
      setLabel(undefined)
      setFallbackUrl(next)
      setError(`Fenêtre native indisponible (${cause instanceof Error ? cause.message : String(cause)}). Affichage intégré — bloqué par la politique de sécurité dans l'application packagée.`)
    }
  }

  const history = (action: BrowserHistoryAction) => {
    const current = label()
    if (!current) return
    void invoke("navigate_design_browser", { label: current, action }).catch((cause) => setError(String(cause)))
  }

  const buttonClass = "rounded border border-border-base px-2 py-1 text-12-regular disabled:opacity-50"

  return <div class="flex h-full min-h-0 flex-col" data-design-browser>
    <form class="flex shrink-0 items-center gap-2 border-b border-border-base p-2" onSubmit={open}>
      <button type="button" class={buttonClass} disabled={!label()} aria-label="Précédent" data-design-browser-back onClick={() => history("back")}>←</button>
      <button type="button" class={buttonClass} disabled={!label()} aria-label="Suivant" data-design-browser-forward onClick={() => history("forward")}>→</button>
      <button type="button" class={buttonClass} disabled={!label()} aria-label="Recharger" data-design-browser-reload onClick={() => history("reload")}>⟳</button>
      <input
        class="min-w-0 flex-1 rounded border border-border-base bg-background-base px-2 py-1 text-12-regular"
        aria-label="URL"
        placeholder="https://exemple.com"
        value={address()}
        onInput={(event) => setAddress(event.currentTarget.value)}
        data-design-browser-address
      />
      <button type="submit" class="rounded border border-border-base px-2 py-1 text-12-medium" data-design-browser-go>Go</button>
    </form>
    <Show when={error()}>{(message) => <p class="shrink-0 px-2 py-1 text-12-regular text-text-weak" data-design-browser-error>{message()}</p>}</Show>
    <Show
      when={fallbackUrl()}
      fallback={<div class="flex min-h-0 flex-1 items-center justify-center px-4 text-center text-12-regular text-text-weak" data-design-browser-native>
        {label() ? "La page est ouverte dans une fenêtre navigateur. Utilise les boutons ci-dessus pour la piloter." : "Saisis une adresse pour ouvrir une fenêtre navigateur."}
      </div>}
    >
      {(url) => <iframe class="min-h-0 flex-1 border-0" title="Browser" src={url()} referrerPolicy="no-referrer" data-design-browser-frame />}
    </Show>
  </div>
}
