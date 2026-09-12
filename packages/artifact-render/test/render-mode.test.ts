/* SPDX-License-Identifier: MIT */

import { describe, expect, test } from "bun:test"
import {
  htmlNeedsFocusGuard,
  htmlNeedsStorageShim,
  shouldUrlLoad,
  type RenderDecision,
} from "../src/render-mode"

const baseDecision: RenderDecision = { mode: "preview", needsBridge: false, forceInline: false }

describe("shouldUrlLoad", () => {
  test("cas nominal : preview sans bridge ni forceInline -> URL", () => {
    expect(shouldUrlLoad(baseDecision)).toBe(true)
  })

  test("mode = 'source' -> srcDoc (URL interdite, le bridge n'est pas présent)", () => {
    expect(shouldUrlLoad({ ...baseDecision, mode: "source" })).toBe(false)
  })

  test("needsBridge = true -> srcDoc (l'hôte ne peut pas injecter via URL)", () => {
    expect(shouldUrlLoad({ ...baseDecision, needsBridge: true })).toBe(false)
  })

  test("forceInline = true -> srcDoc (opt-in utilisateur respecté)", () => {
    expect(shouldUrlLoad({ ...baseDecision, forceInline: true })).toBe(false)
  })
})

describe("htmlNeedsStorageShim", () => {
  test("cas négatif : HTML statique simple ne déclenche pas le shim", () => {
    const html = "<h1>Titre</h1><p>Texte statique sans script.</p>"
    expect(htmlNeedsStorageShim(html)).toBe(false)
  })

  test("script externe <script src=...> -> shim (par prudence, corps non lisible)", () => {
    const html = '<script src="https://cdn.example.com/lib.js"></script>'
    expect(htmlNeedsStorageShim(html)).toBe(true)
  })

  test("script externe <script src=...> sans guillemets -> shim", () => {
    const html = "<script src=lib.js></script>"
    expect(htmlNeedsStorageShim(html)).toBe(true)
  })

  test("<script type=\"text/babel\"> -> shim (Babel transpile en localStorage)", () => {
    const html = '<script type="text/babel">const x = 1</script>'
    expect(htmlNeedsStorageShim(html)).toBe(true)
  })

  test("<script type='text/babel'> (simples quotes) -> shim", () => {
    const html = "<script type='text/babel'>const x = 1</script>"
    expect(htmlNeedsStorageShim(html)).toBe(true)
  })

  test("mot localStorage en clair -> shim", () => {
    const html = "<script>localStorage.setItem('k','v')</script>"
    expect(htmlNeedsStorageShim(html)).toBe(true)
  })

  test("mot sessionStorage en clair -> shim", () => {
    const html = "<script>sessionStorage.clear()</script>"
    expect(htmlNeedsStorageShim(html)).toBe(true)
  })

  test("faux positif assumé : 'localStorageManager' dans un commentaire déclenche le shim", () => {
    // On accepte ce faux positif volontairement : un faux positif coûte un
    // shim script (~600 octets) et un srcDoc légèrement plus lent, alors
    // qu'un faux négatif ferait crasher l'artefact au premier localStorage
    // en SecurityError (origine opaque de la sandbox). C'est un trade-off
    // explicite de la spec P12, pas un bug.
    const html = "<!-- helper: see localStorageManager.ts -->"
    expect(htmlNeedsStorageShim(html)).toBe(true)
  })
})

describe("htmlNeedsFocusGuard", () => {
  test("cas négatif : HTML statique simple ne déclenche pas le focus guard", () => {
    const html = "<h1>Titre</h1><p>Texte statique sans script.</p>"
    expect(htmlNeedsFocusGuard(html)).toBe(false)
  })

  test("script externe <script src=...> -> focus guard (par prudence)", () => {
    const html = '<script src="https://cdn.example.com/lib.js"></script>'
    expect(htmlNeedsFocusGuard(html)).toBe(true)
  })

  test("attribut autofocus sans valeur -> focus guard", () => {
    const html = "<input type=\"text\" autofocus>"
    expect(htmlNeedsFocusGuard(html)).toBe(true)
  })

  test("attribut autofocus avec valeur -> focus guard", () => {
    const html = "<input type=\"text\" autofocus=\"true\">"
    expect(htmlNeedsFocusGuard(html)).toBe(true)
  })

  test("appel .focus( dans un script -> focus guard", () => {
    const html = "<script>document.getElementById('x').focus()</script>"
    expect(htmlNeedsFocusGuard(html)).toBe(true)
  })

  test("faux positif assumé : 'autofocus' dans un commentaire déclenche le focus guard", () => {
    // Même logique que pour localStorageManager : on préfère un faux
    // positif (re-focus déclenché pour rien) à un faux négatif
    // (artefact dont le focus initial ne marche pas).
    const html = "<!-- TODO: remove autofocus from <input> -->"
    expect(htmlNeedsFocusGuard(html)).toBe(true)
  })

  test("négatif ciblé : 'onfocus=' attribut HTML ne doit pas être confondu avec .focus(", () => {
    // Le point manquant garantit que .focus( ne capture pas l'attribut
    // HTML onfocus=. C'est la limite documentée de la regex.
    const html = '<input type="text" onfocus="this.select()">'
    expect(htmlNeedsFocusGuard(html)).toBe(false)
  })
})
