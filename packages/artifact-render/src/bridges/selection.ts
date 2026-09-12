/* SPDX-License-Identifier: MIT */

/**
 * P18 — Pont de sélection d'élément (host ↔ iframe).
 *
 * Le host peut activer/désactiver le mode "picker" via
 * `{ type: "unifia:select-mode", enabled: boolean, tool: "picker" }`.
 * Quand activé, l'iframe :
 * - dessine un contour sur l'élément survolé
 * - au clic, envoie `{ type: "unifia:select-target", elementId, rect }`
 *   puis **empêche** l'événement de se propager (le document ne réagit
 *   pas au clic).
 *
 * Le pont est injecté avec le mode initial déjà armé. Sans ce
 * pré-armement, il existe une fenêtre après chaque reconstruction du
 * `srcDoc` où le message de l'hôte arrive avant l'installation du
 * listener, et les clics sont ignorés (cf. runbook P18 §"Protocole").
 */

export type SelectModeRequest = {
  type: "unifia:select-mode"
  enabled: boolean
  tool: "picker"
}

export type SelectTargetMessage = {
  type: "unifia:select-target"
  elementId: string
  rect: { x: number; y: number; width: number; height: number }
}

export type SelectionMessage = SelectModeRequest | SelectTargetMessage

/**
 * Script injecté dans le srcdoc. S'auto-installe au chargement :
 * - publie `window.__unifiaSelection` pour debug
 * - écoute les requêtes `unifia:select-mode` du parent
 * - track les éléments avec `data-unifia-id` (cf. annotate.ts) et
 *   envoie le rect au clic quand le mode est armé.
 *
 * La fonction `findAnnotatedAncestor` remonte au plus proche ancêtre
 * portant un `data-unifia-id` (c'est l'élément qui sera sélectionné ;
 * on ne sélectionne jamais un texte nu).
 */
export const SELECTION_BRIDGE_SCRIPT = `<script>(function(){
  "use strict";
  if (window.__unifiaSelectionInstalled) return;
  window.__unifiaSelectionInstalled = true;

  var pickerArmed = false;
  var overlay = null;
  var lastHovered = null;

  function ensureOverlay(){
    if (overlay) return overlay;
    var el = document.createElement("div");
    el.setAttribute("data-unifia-selection-overlay", "true");
    el.style.cssText = "position:fixed;pointer-events:none;border:2px solid #3b82f6;background:rgba(59,130,246,0.08);z-index:2147483647;transition:all 0.05s ease-out;display:none;box-sizing:border-box;";
    (document.body || document.documentElement).appendChild(el);
    overlay = el;
    return el;
  }

  function findAnnotatedAncestor(target){
    var el = target;
    while (el && el !== document.documentElement) {
      if (el.nodeType === 1 && el.hasAttribute && el.hasAttribute("data-unifia-id")) return el;
      el = el.parentNode;
    }
    return null;
  }

  function updateOverlay(el){
    var o = ensureOverlay();
    if (!el) { o.style.display = "none"; return; }
    var rect = el.getBoundingClientRect();
    o.style.left = rect.left + "px";
    o.style.top = rect.top + "px";
    o.style.width = rect.width + "px";
    o.style.height = rect.height + "px";
    o.style.display = "block";
  }

  function arm(){
    if (pickerArmed) return;
    pickerArmed = true;
    document.addEventListener("mouseover", function(e){
      if (!pickerArmed) return;
      var el = findAnnotatedAncestor(e.target);
      lastHovered = el;
      updateOverlay(el);
    }, true);
    document.addEventListener("mouseout", function(){
      if (!pickerArmed) return;
      lastHovered = null;
      updateOverlay(null);
    }, true);
    document.addEventListener("click", function(e){
      if (!pickerArmed) return;
      var el = findAnnotatedAncestor(e.target);
      if (!el) return;
      e.preventDefault();
      e.stopPropagation();
      var r = el.getBoundingClientRect();
      var id = el.getAttribute("data-unifia-id");
      if (!id) return;
      window.parent.postMessage({
        type: "unifia:select-target",
        elementId: id,
        rect: { x: r.left, y: r.top, width: r.width, height: r.height }
      }, "*");
    }, true);
  }

  function disarm(){
    pickerArmed = false;
    if (overlay) overlay.style.display = "none";
    lastHovered = null;
  }

  // Pré-armement : on installe le listener tout de suite, dans
  // l'optique "le host peut envoyer select-mode avant que l'iframe
  // soit prêt" — voir runbook P18 §"Pont de sélection d'élément".
  arm();

  window.addEventListener("message", function(event){
    var data = event.data;
    if (!data || typeof data !== "object" || data.type !== "unifia:select-mode") return;
    if (data.enabled) arm(); else disarm();
  });

  window.__unifiaSelection = { arm: arm, disarm: disarm, pickerArmed: function(){ return pickerArmed; } };
})();</script>`
