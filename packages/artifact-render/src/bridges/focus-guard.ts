/* SPDX-License-Identifier: MIT */

/**
 * Focus guard injected into the artifact iframe's <head>.
 *
 * Why: the artifact is untrusted code rendered in a sandboxed iframe.
 * When the user clicks anywhere inside the iframe, the iframe captures
 * the keyboard focus and the host can no longer reach the artifact via
 * its own keyboard shortcuts (Escape, etc.). Worse, scripts inside the
 * iframe can call `element.focus()` on body or its descendants to keep
 * the focus stolen, which is hostile UX.
 *
 * This guard wraps `HTMLElement.prototype.focus` and `window.focus` so
 * they only do anything inside a one-second trust window after a real
 * `pointerdown` or `keydown` from the user. Outside that window, focus
 * calls become no-ops; the user's last explicit gesture always wins.
 *
 * The script is exported as a string constant rather than injected from
 * a file at build time so the package stays pure and the test can
 * assert on its presence/absence byte-for-byte.
 */
export const FOCUS_GUARD_SCRIPT = `<script>(function(){
  var TRUST_MS=1000;
  var lastTrusted=0;
  function trust(){lastTrusted=Date.now();}
  document.addEventListener('pointerdown',trust,true);
  document.addEventListener('keydown',trust,true);
  var orig=HTMLElement.prototype.focus;
  HTMLElement.prototype.focus=function(){
    if(Date.now()-lastTrusted>TRUST_MS)return undefined;
    return orig.apply(this,arguments);
  };
  window.focus=function(){
    if(Date.now()-lastTrusted>TRUST_MS)return undefined;
  };
})();</script>`
