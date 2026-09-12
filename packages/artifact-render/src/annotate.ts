/* SPDX-License-Identifier: MIT */

/**
 * P18 — Auto-annotation des éléments structurels d'un HTML.
 *
 * Avant injection du srcdoc dans l'iframe, on parse le HTML et on pose
 * un attribut `data-unifia-id="path-X-Y-Z..."` sur chaque élément
 * structurel qui n'en a pas déjà. L'id est dérivé du chemin dans
 * l'arbre (indices des enfants depuis `body`), ce qui le rend
 * déterministe et résistant à la ré-annotation.
 *
 * Cette fonction est PURE (string in, string out, sans DOM). Elle est
 * appliquée côté hôte au HTML avant `buildSrcdoc` pour que le
 * sélecteur de P19 (clic utilisateur) puisse identifier la cible de
 * façon stable.
 *
 * Sélecteur des éléments annotés (runbook P18 §« Spécification ») :
 *
 *   section, article, header, footer, nav, main, aside,
 *   h1, h2, h3, h4, h5, h6, button, a, [id],
 *   body > div[class], section > div[class], article > div[class],
 *   main > div[class], header > div[class], footer > div[class],
 *   nav > div[class], aside > div[class],
 *   et les mêmes variantes avec [id] au lieu de [class]
 *
 * Exclus : `script, style, template, noscript, iframe, object, embed`
 * (ainsi que leurs enfants : on n'annot jamais à l'intérieur d'un
 * `<script>` ou d'un `<style>`).
 */

/** Tags structurels (toujours annotés, à n'importe quelle profondeur). */
export const STRUCTURAL_TAGS = [
  "section",
  "article",
  "header",
  "footer",
  "nav",
  "main",
  "aside",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "button",
  "a",
] as const

/** Tags exclus — on n'annote jamais ces éléments ni leurs enfants. */
export const EXCLUDED_TAGS = [
  "script",
  "style",
  "template",
  "noscript",
  "iframe",
  "object",
  "embed",
] as const

/** Ancêtres sous lesquels un `> div[class|id]` est annoté. */
export const ANCESTOR_FOR_DIV = [
  "body",
  "section",
  "article",
  "main",
  "header",
  "footer",
  "nav",
  "aside",
] as const

const STRUCTURAL_SET = new Set<string>(STRUCTURAL_TAGS)
const EXCLUDED_SET = new Set<string>(EXCLUDED_TAGS)
const ANCESTOR_SET = new Set<string>(ANCESTOR_FOR_DIV)
const VOID_TAGS = new Set([
  "area",
  "base",
  "br",
  "col",
  "embed",
  "hr",
  "img",
  "input",
  "link",
  "meta",
  "param",
  "source",
  "track",
  "wbr",
])

/**
 * Calcule un id `path-X-Y-Z...` à partir d'une liste d'indices. Exposé
 * pour les tests et les consumers externes.
 */
export function computePathId(indices: readonly number[]): string {
  return `path-${indices.join("-")}`
}

/**
 * Pur : annote un HTML en posant `data-unifia-id` sur les éléments
 * structurels. Préserve les ids existants. Pure (string in, string
 * out), déterministe : le même input produit le même output.
 *
 * L'id est dérivé du chemin de l'élément dans l'arbre :
 * `path-X-Y-Z-...` où X, Y, Z sont les indices successifs des
 * ancêtres structurels annotés.
 *
 * Approche : regex streaming + état (stack des ancêtres structurels
 * avec leur index, profondeur d'exclusion).
 */
export function annotateSelectableElements(html: string): string {
  const result: string[] = []
  // Stack des ancêtres structurels (annotés) avec leur index dans leur parent
  const ancestorStack: { path: string }[] = []
  // Compteur d'enfant par profondeur d'ancêtre structurel
  const childCounts: number[] = [0]
  // Stack de TOUS les parents non auto-fermants (pour vérifier le parent direct d'un div)
  const parentStack: string[] = []
  let excludedDepth = 0
  let pos = 0
  const tagRegex = /<\/?([a-zA-Z][a-zA-Z0-9]*)(\s[^>]*?)?\s*(\/?)>/g
  let match: RegExpExecArray | null
  while ((match = tagRegex.exec(html)) !== null) {
    const [full, tag, attrs = "", trailing = ""] = match
    const start = match.index
    const isClosing = full.startsWith("</")
    const isSelfClosing = !isClosing && (trailing === "/" || VOID_TAGS.has(tag.toLowerCase()))

    result.push(html.slice(pos, start))

    if (isClosing) {
      const lowerTag = tag.toLowerCase()
      if (EXCLUDED_SET.has(lowerTag)) {
        if (excludedDepth > 0) excludedDepth -= 1
      } else {
        // Si on était dans un ancêtre structurel annoté, on pop
        if (ancestorStack.length > 0) ancestorStack.pop()
        if (childCounts.length > 1) childCounts.pop()
        // Pop du parent stack aussi
        if (parentStack.length > 0) parentStack.pop()
      }
      result.push(full)
    } else {
      const lowerTag = tag.toLowerCase()
      const isExcluded = EXCLUDED_SET.has(lowerTag)
      const isInExcludedZone = excludedDepth > 0
      const isStructural = STRUCTURAL_SET.has(lowerTag)
      const isDescendantDivCandidate = isDescendantDiv(lowerTag, attrs)
      // Le div est annoté ssi son parent direct (le plus récent tag
      // ouvert non auto-fermant) est dans ANCESTOR_FOR_DIV.
      const parentTag = parentStack.length > 0 ? parentStack[parentStack.length - 1] : null
      const isAncesterDiv = isDescendantDivCandidate && parentTag !== null && ANCESTOR_SET.has(parentTag)
      const hasExistingId = attrs ? /\bdata-unifia-id\s*=/.test(attrs) : false

      const shouldAnnotate =
        !isInExcludedZone &&
        !isExcluded &&
        !hasExistingId &&
        (isStructural || isAncesterDiv)

      let output = `<${tag}${attrs}${isSelfClosing ? " /" : ""}>`
      if (shouldAnnotate) {
        // Incrémenter le compteur d'enfant à la profondeur courante
        while (childCounts.length <= ancestorStack.length + 1) childCounts.push(0)
        const myIndex = childCounts[ancestorStack.length] ?? 0
        childCounts[ancestorStack.length] = myIndex + 1
        // Calculer le path : préfixe de l'ancêtre (s'il existe) + mon index
        const parentPath = ancestorStack.length > 0 ? ancestorStack[ancestorStack.length - 1]?.path : null
        const myPath = parentPath ? `${parentPath}-${myIndex}` : `path-${myIndex}`
        output = `<${tag}${attrs} data-unifia-id="${myPath}"${isSelfClosing ? " /" : ""}>`
        // Empiler pour les enfants (sauf auto-fermant)
        if (!isSelfClosing) ancestorStack.push({ path: myPath })
      } else if (!isSelfClosing && !isExcluded) {
        // Pas annoté, pas exclu : on doit quand même "entrer" dans
        // le tag pour que les childCounts soient corrects (sans
        // incrémenter, car on ne s'occupe pas des indices de ce
        // sous-arbre, sauf quand on annotera un enfant direct).
        // En fait on NE push pas : si l'élément courant n'est pas
        // annoté, ses enfants ne sont pas non plus annotés (pas dans
        // le selector, sauf s'ils matchent un tag structurel).
        // Mais pour les `body > div[class]`, le div est annoté
        // alors que body ne l'est pas. Le path du div = "path-0"
        // (index dans body). Si body n'est pas empilé, c'est ok.
      }

      if (isExcluded) excludedDepth += 1
      // Pousser le tag dans le parent stack pour que les enfants
      // puissent vérifier leur parent direct (sauf si auto-fermant).
      if (!isSelfClosing && !isExcluded) parentStack.push(lowerTag)
      result.push(output)
    }

    pos = start + full.length
  }
  result.push(html.slice(pos))
  return result.join("")
}

/**
 * Indique si le tag ouvrant est un `div` avec `class` ou `id` (utilisé
 * pour le sélecteur `<ancestor> > div[class|id]`).
 */
function isDescendantDiv(tag: string, attrs: string): boolean {
  if (tag.toLowerCase() !== "div") return false
  if (!attrs) return false
  return /class\s*=/.test(attrs) || /\bid\s*=/.test(attrs)
}
