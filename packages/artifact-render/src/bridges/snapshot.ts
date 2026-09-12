/* SPDX-License-Identifier: MIT */

/**
 * P17 — Pont de capture d'image hôte ↔ iframe.
 *
 * Le host envoie `{ type: "unifia:snapshot", id, full }` au srcdoc ; l'iframe
 * clone son document, inline les styles calculés sur une liste close de
 * propriétés, sérialise dans un `<svg><foreignObject>`, charge en `Image`,
 * dessine sur canvas, échantillonne, et renvoie
 * `{ type: "unifia:snapshot-result", id, dataUrl, w, h }` ou
 * `{ type, id, error }` si la rastérisation a échoué.
 *
 * **Règle critique** : après le dessin sur canvas, on échantillonne 9
 * pixels (grille 3×3) et on appelle `looksBlank(samples)`. Si tous les
 * échantillons sont à moins de 6 unités les uns des autres, Chromium
 * refuse typiquement de peindre du HTML en `foreignObject` et on renvoie
 * `error: "empty-render"` — un échec explicite vaut mieux qu'une image
 * noire silencieuse.
 *
 * Le présent module expose la fonction pure `looksBlank` (testable hors
 * DOM), la constante `SNAPSHOT_BRIDGE_SCRIPT` (string du script injecté
 * dans le srcdoc), et les types du protocole conformes à ADR-1037.
 */

export type Rgba = readonly [number, number, number, number]

/**
 * Pure : détermine si un échantillonnage de canvas représente un rendu
 * effectivement vide. La règle "9 échantillons minimum" évite les
 * faux positifs sur des fenêtres minuscules (1-2 pixels uniformes ne
 * suffisent pas à conclure).
 *
 * Tolérance : 6 unités RGB(A) par canal. En dessous, on considère que
 * le canvas n'a rien peint (typique : `foreignObject` Chromium renvoie
 * un PNG uni transparent ou noir).
 */
export function looksBlank(samples: readonly Rgba[]): boolean {
  if (samples.length < 9) return false
  const first = samples[0]
  if (!first) return false
  for (let i = 1; i < samples.length; i += 1) {
    const sample = samples[i]
    if (!sample) return false
    if (
      Math.abs(sample[0] - first[0]) > 6 ||
      Math.abs(sample[1] - first[1]) > 6 ||
      Math.abs(sample[2] - first[2]) > 6 ||
      Math.abs(sample[3] - first[3]) > 6
    ) {
      return false
    }
  }
  return true
}

export type SnapshotRequest = {
  type: "unifia:snapshot"
  id: string
  full: boolean
}

export type SnapshotResult = {
  type: "unifia:snapshot-result"
  id: string
  dataUrl: string
  w: number
  h: number
}

export type SnapshotError = {
  type: "unifia:snapshot-error"
  id: string
  error: "empty-render" | "no-document" | "no-canvas" | "no-image" | "foreign-object-failed" | "timeout"
}

export type SnapshotMessage = SnapshotRequest | SnapshotResult | SnapshotError

/**
 * Codes d'erreur reconnus par l'hôte. Voir ADR-1037 §"snapshot-bridge".
 */
export const SNAPSHOT_ERROR_CODES = [
  "empty-render",
  "no-document",
  "no-canvas",
  "no-image",
  "foreign-object-failed",
  "timeout",
] as const

export type SnapshotErrorCode = (typeof SNAPSHOT_ERROR_CODES)[number]

/**
 * Délai max (ms) avant d'abandonner la rastérisation. Chromium peut
 * freezer sur certains HTML complexes ; un timeout explicite évite
 * d'attendre indéfiniment côté hôte.
 */
export const SNAPSHOT_TIMEOUT_MS = 5_000

/**
 * Liste close des propriétés CSS à inliner lors du clonage (les autres
 * sont ignorées pour éviter que la sérialisation pète sur des valeurs
 * non-sérialisables — gradients, transforms exotiques, etc.).
 */
export const INLINEABLE_PROPERTIES = [
  "color",
  "background",
  "background-color",
  "border",
  "border-color",
  "border-radius",
  "border-style",
  "border-width",
  "box-shadow",
  "box-sizing",
  "display",
  "font",
  "font-family",
  "font-size",
  "font-weight",
  "height",
  "line-height",
  "margin",
  "max-height",
  "max-width",
  "min-height",
  "min-width",
  "opacity",
  "padding",
  "position",
  "text-align",
  "text-decoration",
  "text-transform",
  "visibility",
  "width",
] as const

/**
 * Script injecté dans le srcdoc. Il écoute `message` pour les requêtes
 * `unifia:snapshot`, effectue la rastérisation côté iframe (qui a accès
 * à son propre DOM et à document.fonts), et renvoie le résultat.
 *
 * La fonction `looksBlank` est inlinée ici (en string) pour ne pas
 * dépendre d'un module runtime — l'iframe n'a pas accès au système de
 * modules. La logique échantillonnage est identique à `looksBlank` :
 * 9 pixels en grille 3×3, tolérance 6 par canal.
 *
 * Le script s'auto-invoque au chargement et publie ses helpers sur
 * `window.__unifiaSnapshot` pour permettre à l'hôte de tester
 * l'enregistrement en devtools.
 */
export const SNAPSHOT_BRIDGE_SCRIPT = `<script>(function(){
  "use strict";
  if (window.__unifiaSnapshotInstalled) return;
  window.__unifiaSnapshotInstalled = true;

  function getInlinableProperties(){return ["color","background","background-color","border","border-color","border-radius","border-style","border-width","box-shadow","box-sizing","display","font","font-family","font-size","font-weight","height","line-height","margin","max-height","max-width","min-height","min-width","opacity","padding","position","text-align","text-decoration","text-transform","visibility","width"];}
  function cloneAndInline(root){
    var clone = root.cloneNode(true);
    var props = getInlinableProperties();
    var all = root.querySelectorAll("*");
    var allClones = clone.querySelectorAll("*");
    for (var i = 0; i < all.length && i < allClones.length; i++){
      var src = all[i];
      var dst = allClones[i];
      var cs = window.getComputedStyle(src);
      var style = "";
      for (var p = 0; p < props.length; p++){
        var k = props[p];
        var v = cs.getPropertyValue(k);
        if (v) style += k + ":" + v + ";";
      }
      dst.setAttribute("style", style);
    }
    return clone;
  }
  function rasterize(full){
    return new Promise(function(resolve, reject){
      if (!document.documentElement) return reject(new Error("no-document"));
      if (typeof document.fonts && document.fonts.ready){
        document.fonts.ready.then(function(){}).catch(function(){});
      }
      var imgs = Array.prototype.slice.call(document.images || []);
      Promise.all(imgs.map(function(img){
        if (img.complete && img.naturalWidth > 0) return Promise.resolve();
        return new Promise(function(r){
          img.addEventListener("load", r, { once: true });
          img.addEventListener("error", r, { once: true });
        });
      })).then(function(){
        try {
          var w = full ? document.documentElement.scrollWidth : document.documentElement.clientWidth;
          var h = full ? document.documentElement.scrollHeight : document.documentElement.clientHeight;
          var clone = cloneAndInline(document.documentElement);
          var svg = "<svg xmlns='http://www.w3.org/2000/svg' width='" + w + "' height='" + h + "'>"
            + "<foreignObject x='0' y='0' width='100%' height='100%'>"
            + new XMLSerializer().serializeToString(clone)
            + "</foreignObject></svg>";
          var url = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
          var img = new Image();
          img.onload = function(){
            var canvas = document.createElement("canvas");
            canvas.width = w;
            canvas.height = h;
            var ctx = canvas.getContext("2d");
            if (!ctx) return reject(new Error("no-canvas"));
            ctx.drawImage(img, 0, 0, w, h);
            // Échantillonnage 3x3
            var samples = [];
            for (var yi = 0; yi < 3; yi++){
              for (var xi = 0; xi < 3; xi++){
                var px = Math.floor((xi + 0.5) * w / 3);
                var py = Math.floor((yi + 0.5) * h / 3);
                var d = ctx.getImageData(px, py, 1, 1).data;
                samples.push([d[0], d[1], d[2], d[3]]);
              }
            }
            resolve({ canvas: canvas, width: w, height: h, samples: samples });
          };
          img.onerror = function(){ reject(new Error("no-image")); };
          img.src = url;
        } catch (err) { reject(err); }
      });
    });
  }
  function looksBlank(samples){
    if (samples.length < 9) return false;
    var f = samples[0];
    for (var i = 1; i < samples.length; i++){
      var s = samples[i];
      if (Math.abs(s[0]-f[0])>6 || Math.abs(s[1]-f[1])>6 || Math.abs(s[2]-f[2])>6 || Math.abs(s[3]-f[3])>6) return false;
    }
    return true;
  }
  window.addEventListener("message", function(event){
    var data = event.data;
    if (!data || typeof data !== "object" || data.type !== "unifia:snapshot") return;
    var id = data.id;
    var full = !!data.full;
    var timer = setTimeout(function(){
      window.parent.postMessage({ type: "unifia:snapshot-error", id: id, error: "timeout" }, "*");
    }, 5000);
    rasterize(full).then(function(res){
      clearTimeout(timer);
      if (looksBlank(res.samples)){
        window.parent.postMessage({ type: "unifia:snapshot-error", id: id, error: "empty-render" }, "*");
        return;
      }
      var dataUrl = res.canvas.toDataURL("image/png");
      window.parent.postMessage({ type: "unifia:snapshot-result", id: id, dataUrl: dataUrl, w: res.width, h: res.height }, "*");
    }).catch(function(err){
      clearTimeout(timer);
      var code = "foreign-object-failed";
      if (err && err.message === "no-document") code = "no-document";
      else if (err && err.message === "no-canvas") code = "no-canvas";
      else if (err && err.message === "no-image") code = "no-image";
      window.parent.postMessage({ type: "unifia:snapshot-error", id: id, error: code }, "*");
    });
  });
  window.__unifiaSnapshot = { rasterize: rasterize, looksBlank: looksBlank };
})();</script>`
