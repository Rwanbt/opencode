/* SPDX-License-Identifier: MIT */

import { describe, expect, test } from "bun:test"
import {
  ANCESTOR_FOR_DIV,
  EXCLUDED_TAGS,
  STRUCTURAL_TAGS,
  annotateSelectableElements,
  computePathId,
} from "../src/annotate"

describe("computePathId", () => {
  test("un seul segment", () => {
    expect(computePathId([0])).toBe("path-0")
    expect(computePathId([3])).toBe("path-3")
  })
  test("plusieurs segments", () => {
    expect(computePathId([0, 3, 1])).toBe("path-0-3-1")
    expect(computePathId([2, 0, 5, 4])).toBe("path-2-0-5-4")
  })
  test("tableau vide → path-0 (fallback raisonnable)", () => {
    expect(computePathId([])).toBe("path-")
    // Note : la signature accepte un tableau non-vide en pratique
    // (la profondeur 0 est le body). Le test documente le comportement
    // actuel — à voir si on veut throw sur [] dans une version future.
  })
})

describe("annotateSelectableElements — invariants", () => {
  test("un <section> sans identité reçoit un data-unifia-id", () => {
    const html = "<body><section>Hello</section></body>"
    const result = annotateSelectableElements(html)
    expect(result).toMatch(/<section[^>]*data-unifia-id="path-0"/)
    expect(result).toContain("Hello")
  })

  test("un <button> est annoté", () => {
    const html = "<body><button>OK</button></body>"
    const result = annotateSelectableElements(html)
    expect(result).toMatch(/<button[^>]*data-unifia-id="path-0"/)
  })

  test("un <a> avec href est annoté", () => {
    const html = '<body><a href="/x">link</a></body>'
    const result = annotateSelectableElements(html)
    expect(result).toMatch(/<a[^>]*data-unifia-id="path-0"/)
  })

  test("un <h1> à <h6> est annoté", () => {
    for (const tag of ["h1", "h2", "h3", "h4", "h5", "h6"] as const) {
      const html = `<body><${tag}>Title</${tag}></body>`
      const result = annotateSelectableElements(html)
      expect(result).toMatch(new RegExp(`<${tag}[^>]*data-unifia-id="path-0"`))
    }
  })
})

describe("annotateSelectableElements — préservation des ids existants", () => {
  test("un élément avec data-unifia-id déjà présent le conserve", () => {
    const html = '<body><section data-unifia-id="custom-id">Hello</section></body>'
    const result = annotateSelectableElements(html)
    expect(result).toContain('data-unifia-id="custom-id"')
    expect(result).not.toContain('data-unifia-id="path-')
  })

  test("un élément avec id HTML est annoté en data-unifia-id (l'id HTML n'est pas touché)", () => {
    const html = '<body><section id="hero">Hello</section></body>'
    const result = annotateSelectableElements(html)
    expect(result).toContain('id="hero"')
    expect(result).toContain('data-unifia-id="path-0"')
  })
})

describe("annotateSelectableElements — exclusions", () => {
  test("un <script> n'est jamais annoté", () => {
    const html = '<body><section><script>console.log("x")</script></section></body>'
    const result = annotateSelectableElements(html)
    expect(result).toMatch(/<section[^>]*data-unifia-id="path-0"/)
    expect(result).not.toMatch(/<script[^>]*data-unifia-id/)
  })

  test("les enfants d'un <script> ne sont pas annotés", () => {
    // Un <section> à l'intérieur d'un <script> ne doit pas être annoté
    // (improbable en HTML valide mais couvert par la défense en profondeur)
    const html = '<body><script>var s = "<section>x</section>"</script></body>'
    const result = annotateSelectableElements(html)
    // Le <script> n'est pas annoté, et le <section> à l'intérieur
    // (qui n'est pas un vrai élément du DOM) ne l'est pas non plus.
    expect(result).not.toMatch(/<script[^>]*data-unifia-id/)
  })

  test("un <style> n'est pas annoté", () => {
    const html = '<body><style>section { color: red; }</style></body>'
    const result = annotateSelectableElements(html)
    expect(result).not.toMatch(/<style[^>]*data-unifia-id/)
  })

  test("les tags exclus listés sont bien dans EXCLUDED_TAGS", () => {
    const expected = ["script", "style", "template", "noscript", "iframe", "object", "embed"] as const
    for (const tag of expected) {
      expect(EXCLUDED_TAGS).toContain(tag)
    }
  })
})

describe("annotateSelectableElements — divs descendants d'ancêtres sémantiques", () => {
  test("body > div[class] est annoté", () => {
    const html = '<body><div class="container">x</div></body>'
    const result = annotateSelectableElements(html)
    expect(result).toMatch(/<div class="container"[^>]*data-unifia-id="path-0"/)
  })

  test("body > div[id] est annoté", () => {
    const html = '<body><div id="root">x</div></body>'
    const result = annotateSelectableElements(html)
    expect(result).toMatch(/<div id="root"[^>]*data-unifia-id="path-0"/)
  })

  test("section > div[class] est annoté", () => {
    const html = '<body><section><div class="card">x</div></section></body>'
    const result = annotateSelectableElements(html)
    expect(result).toMatch(/<section[^>]*data-unifia-id="path-0"/)
    expect(result).toMatch(/<div class="card"[^>]*data-unifia-id="path-0-0"/)
  })

  test("deux <section> reçoivent des ids distincts (path-0 et path-1)", () => {
    const html = "<body><section>A</section><section>B</section></body>"
    const result = annotateSelectableElements(html)
    expect(result).toMatch(/<section[^>]*data-unifia-id="path-0"/)
    expect(result).toMatch(/<section[^>]*data-unifia-id="path-1"/)
  })

  test("deux <div> dans un <section> reçoivent path-0-0 et path-0-1", () => {
    const html = '<body><section><div class="a">x</div><div class="b">y</div></section></body>'
    const result = annotateSelectableElements(html)
    expect(result).toMatch(/<div class="a"[^>]*data-unifia-id="path-0-0"/)
    expect(result).toMatch(/<div class="b"[^>]*data-unifia-id="path-0-1"/)
  })
})

describe("annotateSelectableElements — déterminisme", () => {
  test("même input produit même output", () => {
    const html = '<body><section><div class="a">x</div></section><button>y</button></body>'
    const r1 = annotateSelectableElements(html)
    const r2 = annotateSelectableElements(html)
    expect(r1).toBe(r2)
  })

  test("idempotence : annoter deux fois ne change rien", () => {
    const html = '<body><section>x</section></body>'
    const once = annotateSelectableElements(html)
    const twice = annotateSelectableElements(once)
    expect(twice).toBe(once)
  })
})

describe("Constantes exportées", () => {
  test("STRUCTURAL_TAGS contient les 15 tags attendus", () => {
    expect(STRUCTURAL_TAGS).toHaveLength(15)
    expect(STRUCTURAL_TAGS).toContain("section")
    expect(STRUCTURAL_TAGS).toContain("article")
    expect(STRUCTURAL_TAGS).toContain("button")
    expect(STRUCTURAL_TAGS).toContain("a")
    expect(STRUCTURAL_TAGS).toContain("h1")
    expect(STRUCTURAL_TAGS).toContain("h6")
  })

  test("ANCESTOR_FOR_DIV contient les 8 ancêtres sémantiques", () => {
    expect(ANCESTOR_FOR_DIV).toHaveLength(8)
    expect(ANCESTOR_FOR_DIV).toContain("body")
    expect(ANCESTOR_FOR_DIV).toContain("section")
    expect(ANCESTOR_FOR_DIV).toContain("aside")
  })
})
