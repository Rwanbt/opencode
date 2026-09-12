/* SPDX-License-Identifier: MIT */

/**
 * Minimal XML helpers for OOXML parts.
 *
 * SCOPE, stated so nobody mistakes this for an XML parser: it handles the two
 * shapes OOXML actually uses for the parts touched here — simple elements with
 * attributes (`<Override .../>`, `<Relationship .../>`) and text-bearing leaf
 * elements (`<w:t>`, `<a:t>`, `<t>`). It does not handle namespaces
 * generically, CDATA, comments, or nested elements of the same name. Anything
 * beyond that must not be routed through here.
 */

/**
 * Removes elements named `tagName` whose attribute text fails `keep`.
 *
 * The tag match requires a delimiter after the name so `<Relationship` does not
 * also match a hypothetical `<RelationshipGroup`.
 */
export function filterElements(xml: string, tagName: string, keep: (attributes: string) => boolean): string {
  const open = `<${tagName}`
  let result = ""
  let cursor = 0
  for (;;) {
    const start = xml.indexOf(open, cursor)
    if (start < 0) return result + xml.slice(cursor)
    const delimiter = xml[start + open.length]
    if (delimiter !== " " && delimiter !== "/" && delimiter !== ">") {
      result += xml.slice(cursor, start + open.length)
      cursor = start + open.length
      continue
    }
    const end = xml.indexOf(">", start)
    if (end < 0) return result + xml.slice(cursor)
    result += xml.slice(cursor, start)
    if (keep(xml.slice(start + open.length, end))) result += xml.slice(start, end + 1)
    cursor = end + 1
  }
}

/** Reads an attribute value from an element's attribute text. */
export function attribute(attributes: string, name: string): string | undefined {
  for (const quote of ['"', "'"]) {
    const marker = `${name}=${quote}`
    const start = attributes.indexOf(marker)
    if (start < 0) continue
    const end = attributes.indexOf(quote, start + marker.length)
    if (end > 0) return attributes.slice(start + marker.length, end)
  }
  return undefined
}

const ENTITIES: Readonly<Record<string, string>> = { "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&apos;": "'" }

export function decodeEntities(value: string): string {
  return value.replace(/&(amp|lt|gt|quot|apos);/g, (entity) => ENTITIES[entity] ?? entity)
}

/** Collects the text of every `<tagName>…</tagName>` leaf, in document order. */
export function textOf(xml: string, tagName: string): string[] {
  const open = `<${tagName}`
  const close = `</${tagName}>`
  const values: string[] = []
  let cursor = 0
  for (;;) {
    const start = xml.indexOf(open, cursor)
    if (start < 0) return values
    const delimiter = xml[start + open.length]
    if (delimiter !== " " && delimiter !== "/" && delimiter !== ">") {
      cursor = start + open.length
      continue
    }
    const contentStart = xml.indexOf(">", start)
    if (contentStart < 0) return values
    // A self-closing element carries no text.
    if (xml[contentStart - 1] === "/") {
      cursor = contentStart + 1
      continue
    }
    const contentEnd = xml.indexOf(close, contentStart)
    if (contentEnd < 0) return values
    values.push(decodeEntities(xml.slice(contentStart + 1, contentEnd)))
    cursor = contentEnd + close.length
  }
}
