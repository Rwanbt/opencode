/* SPDX-License-Identifier: MIT */

/**
 * Phase 9.2 — Pont d'édition manuelle (host ↔ iframe).
 *
 * Le host arme/désarme via `{ type: "unifia:edit-mode", enabled: boolean }`
 * — même forme que `unifia:select-mode` (P18, selection.ts). Armé, un
 * clic sur un élément portant `data-unifia-id` (posé par l'auto-annotation
 * P18) l'arme en `contenteditable="true"` et lui donne le focus, au lieu
 * de juste rapporter son rect comme le fait la sélection.
 *
 * Au blur de l'élément édité, le pont retire `contenteditable`, sérialise
 * le document ENTIER (pas juste l'élément — un changement peut toucher
 * des attributs ou une structure au-delà du texte visible) et le renvoie
 * via `{ type: "unifia:edit-result", html }`. Le host décide quoi en
 * faire (P9.2 : `createArtifact` comme nouvelle version).
 *
 * Un seul élément éditable à la fois : cliquer un second élément pendant
 * qu'un autre est en édition ferme d'abord le premier (même flush que le
 * blur) avant d'armer le second — jamais deux `contenteditable="true"`
 * simultanés, qui produiraient deux `edit-result` divergents pour le
 * même document.
 */

export type EditModeRequest = {
  type: "unifia:edit-mode"
  enabled: boolean
}

export type EditResultMessage = {
  type: "unifia:edit-result"
  html: string
}

export type EditMessage = EditModeRequest | EditResultMessage

export const EDIT_BRIDGE_SCRIPT = `<script>(function(){
  "use strict";
  if (window.__unifiaEditInstalled) return;
  window.__unifiaEditInstalled = true;

  var editArmed = false;
  var activeElement = null;

  function findAnnotatedAncestor(target){
    var el = target;
    while (el && el !== document.documentElement) {
      if (el.nodeType === 1 && el.hasAttribute && el.hasAttribute("data-unifia-id")) return el;
      el = el.parentNode;
    }
    return null;
  }

  function reportDocument(){
    window.parent.postMessage({
      type: "unifia:edit-result",
      html: "<!doctype html>" + document.documentElement.outerHTML
    }, "*");
  }

  function stopEditing(el){
    if (!el) return;
    el.removeEventListener("blur", onBlur, true);
    el.removeAttribute("contenteditable");
    reportDocument();
    if (activeElement === el) activeElement = null;
  }

  function onBlur(){
    stopEditing(activeElement);
  }

  function onClick(e){
    if (!editArmed) return;
    var el = findAnnotatedAncestor(e.target);
    if (!el) return;
    e.preventDefault();
    e.stopPropagation();
    if (activeElement && activeElement !== el) stopEditing(activeElement);
    if (activeElement === el) return;
    activeElement = el;
    el.setAttribute("contenteditable", "true");
    el.addEventListener("blur", onBlur, true);
    el.focus();
  }

  function arm(){
    if (editArmed) return;
    editArmed = true;
    document.addEventListener("click", onClick, true);
  }

  function disarm(){
    editArmed = false;
    document.removeEventListener("click", onClick, true);
    if (activeElement) stopEditing(activeElement);
  }

  window.addEventListener("message", function(event){
    var data = event.data;
    if (!data || typeof data !== "object" || data.type !== "unifia:edit-mode") return;
    if (data.enabled) arm(); else disarm();
  });

  window.__unifiaEdit = { arm: arm, disarm: disarm, editArmed: function(){ return editArmed; } };
})();</script>`
