/* SPDX-License-Identifier: MIT */

/**
 * P25 — Inline CSS, scripts, and images into a single self-contained HTML.
 *
 * The exported file must open in a browser with no network access. The
 * resolver is the only source of bytes; this module never reaches for
 * the filesystem itself. That keeps the function pure, testable on
 * fixtures, and easy to reason about.
 *
 * The inliner is intentionally limited:
 *   - relative `<link rel="stylesheet" href="...">` → inlined as a
 *     `<style>` block;
 *   - relative `<script src="...">` → inlined as a `<script>` block;
 *   - relative `<img src="...">` → rewritten to a `data:` URI;
 *   - `url(...)` references inside the inlined CSS are inlined to
 *     `data:` URIs when the resolver returns bytes;
 *   - absolute URLs are left untouched and reported in `missing`.
 */

export type AssetResolver = (relativePath: string) => Uint8Array | null

export type ExportStandaloneResult = {
  html: string
  inlined: readonly string[]
  missing: readonly string[]
}

const STYLESHEET_TAG = /<link\b[^>]*\brel=["']stylesheet["'][^>]*\bhref=["']([^"']+)["'][^>]*>/gi
const SCRIPT_TAG = /<script\b[^>]*\bsrc=["']([^"']+)["'][^>]*>\s*<\/script>/gi
const IMG_TAG = /<img\b[^>]*\bsrc=["']([^"']+)["'][^>]*>/gi
const URL_REFERENCE = /url\(\s*(['"]?)([^'")]+)\1\s*\)/gi

const IMAGE_MIME_BY_EXT: Readonly<Record<string, string>> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
}

const TEXT_MIME_BY_EXT: Readonly<Record<string, string>> = {
  ".css": "text/css",
  ".js": "application/javascript",
  ".mjs": "application/javascript",
  ".json": "application/json",
}

function isAbsoluteOrDataUrl(href: string): boolean {
  return /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(href)
}

function inferMime(relativePath: string, fallback: string): string {
  const dotIndex = relativePath.lastIndexOf(".")
  if (dotIndex < 0) return fallback
  const ext = relativePath.slice(dotIndex).toLowerCase()
  return IMAGE_MIME_BY_EXT[ext] ?? TEXT_MIME_BY_EXT[ext] ?? fallback
}

function bytesToBase64(bytes: Uint8Array): string {
  // Avoid pulling Buffer into the artifact-studio browser footprint.
  // btoa is available on both Bun and Node 16+.
  if (typeof btoa === "function") {
    let binary = ""
    for (let index = 0; index < bytes.length; index += 1) {
      binary += String.fromCharCode(bytes[index] ?? 0)
    }
    return btoa(binary)
  }
  return Buffer.from(bytes).toString("base64")
}

function buildDataUri(mime: string, bytes: Uint8Array): string {
  return `data:${mime};base64,${bytesToBase64(bytes)}`
}

/**
 * Inlines the relative assets reachable from `entryHtml` into a single
 * self-contained HTML string. The function is pure: same input always
 * produces the same output, and the resolver is the only source of
 * bytes.
 */
export function exportStandaloneHtml(entryHtml: string, resolve: AssetResolver): ExportStandaloneResult {
  const inlined = new Set<string>()
  const missing = new Set<string>()
  let html = entryHtml

  // 1. Stylesheets
  html = html.replace(STYLESHEET_TAG, (match, href: string) => {
    if (isAbsoluteOrDataUrl(href)) {
      missing.add(href)
      return match
    }
    const bytes = resolve(href)
    if (!bytes) {
      missing.add(href)
      return match
    }
    const css = new TextDecoder("utf-8").decode(bytes)
    const cssInlined = inlineCssUrls(css, resolve, inlined, missing)
    inlined.add(href)
    return `<style>${cssInlined}</style>`
  })

  // 2. Scripts
  html = html.replace(SCRIPT_TAG, (match, src: string) => {
    if (isAbsoluteOrDataUrl(src)) {
      missing.add(src)
      return match
    }
    const bytes = resolve(src)
    if (!bytes) {
      missing.add(src)
      return match
    }
    const source = new TextDecoder("utf-8").decode(bytes)
    inlined.add(src)
    return `<script>${source}</script>`
  })

  // 3. Images
  html = html.replace(IMG_TAG, (match, src: string) => {
    if (isAbsoluteOrDataUrl(src)) {
      missing.add(src)
      return match
    }
    const bytes = resolve(src)
    if (!bytes) {
      missing.add(src)
      return match
    }
    const mime = inferMime(src, "application/octet-stream")
    inlined.add(src)
    return match.replace(src, buildDataUri(mime, bytes))
  })

  return { html, inlined: [...inlined].sort(), missing: [...missing].sort() }
}

function inlineCssUrls(css: string, resolve: AssetResolver, inlined: Set<string>, missing: Set<string>): string {
  return css.replace(URL_REFERENCE, (match, quote: string, href: string) => {
    if (isAbsoluteOrDataUrl(href)) {
      missing.add(href)
      return match
    }
    const bytes = resolve(href)
    if (!bytes) {
      missing.add(href)
      return match
    }
    const mime = inferMime(href, "application/octet-stream")
    inlined.add(href)
    return `url(${quote}${buildDataUri(mime, bytes)}${quote})`
  })
}
