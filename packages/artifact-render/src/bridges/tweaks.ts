/* SPDX-License-Identifier: MIT */

/**
 * P28 — Tweaks bridge.
 *
 * The tweaks bridge is a passive listener that toggles a panel emitted
 * by the template. The bridge is injected **always**, not on option:
 * conditionning the injection would force a srcdoc reconstruction on
 * every toggle, producing a visible flicker.
 *
 * The module is DOM-free. `findTweaksPanel` and `toggleTweaksPanel`
 * operate on a minimal panel interface (a `hidden` attribute and
 * `setAttribute` / `removeAttribute` / `hasAttribute`).
 */

export const TWEAKS_PANEL_ATTRIBUTE = "data-unifia-tweaks" as const

export const TWEAKS_TOGGLE_MESSAGE_TYPE = "unifia:tweaks:toggle" as const

/** A minimal panel interface — DOM-free, compatible with HTMLElement. */
export interface TweaksPanel {
  hasAttribute(name: string): boolean
  setAttribute(name: string, value: string): void
  removeAttribute(name: string): void
}

export function findTweaksPanel(root: { querySelector(selector: string): TweaksPanel | null }): TweaksPanel | null {
  return root.querySelector(`[${TWEAKS_PANEL_ATTRIBUTE}]`)
}

export function toggleTweaksPanel(panel: TweaksPanel): boolean {
  const next = !panel.hasAttribute("hidden")
  if (next) panel.setAttribute("hidden", "")
  else panel.removeAttribute("hidden")
  return !next
}

/**
 * Renders the IIFE the host injects into the srcdoc. The script
 * listens for `unifia:tweaks:toggle` messages from the host and
 * calls the toggle against the panel it finds.
 */
export const TWEAKS_BRIDGE_SCRIPT = `
(function () {
  var ATTR = "data-unifia-tweaks";
  var MSG = "unifia:tweaks:toggle";
  function findPanel() {
    var el = document.querySelector("[" + ATTR + "]");
    return el instanceof HTMLElement ? el : null;
  }
  function toggle(panel) {
    var next = !panel.hasAttribute("hidden");
    if (next) panel.setAttribute("hidden", "");
    else panel.removeAttribute("hidden");
    return !next;
  }
  window.addEventListener("message", function (event) {
    var data = event.data;
    if (!data || typeof data !== "object") return;
    if (data.type !== MSG) return;
    var panel = findPanel();
    if (!panel) return;
    var visible = toggle(panel);
    if (typeof window.parent !== "undefined" && window.parent !== window) {
      window.parent.postMessage({ type: "unifia:tweaks:result", visible: visible, origin: "tweaks-bridge" }, "*");
    }
  });
})();
`
