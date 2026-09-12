/* SPDX-License-Identifier: MIT */

import type { WorkspaceFileRead } from "@unifia/workbench-shell"

/**
 * True for a URL that already resolves on its own — absolute http(s),
 * protocol-relative, an inline data: URI, or a same-page anchor.
 * Everything else is a same-workspace relative path, and `srcdoc` has no
 * base URL to resolve those against: this is exactly why a previewed
 * `index.html` loaded raw into `ArtifactPreview` rendered unstyled — its
 * `<link rel="stylesheet" href="styles/…">` tags pointed at nothing.
 */
export function isExternalAssetUrl(href: string): boolean {
  return /^([a-z]+:)?\/\//i.test(href) || href.startsWith("data:") || href.startsWith("#")
}

/**
 * Resolves `href` against the directory containing `basePath`, collapsing
 * `.`/`..` segments. Workspace paths are POSIX-style regardless of host
 * OS, so this never touches `path.win32` semantics.
 */
export function resolveRelativeAssetPath(basePath: string, href: string): string {
  const dir = basePath.includes("/") ? basePath.slice(0, basePath.lastIndexOf("/")) : ""
  const combined = href.startsWith("/") ? href.slice(1) : dir ? `${dir}/${href}` : href
  const segments: string[] = []
  for (const segment of combined.split("/")) {
    if (segment === "" || segment === ".") continue
    if (segment === "..") segments.pop()
    else segments.push(segment)
  }
  return segments.join("/")
}

export type RelativeAssetTarget = { path: string; kind: "style" | "script" }

/**
 * Finds every relative `<link rel="stylesheet" href>` and `<script src>`
 * in `html` — the tags that need inlining before the document can render
 * correctly inside a sandboxed `srcdoc` iframe with no base URL.
 */
export function collectRelativeAssetTargets(html: string, basePath: string): RelativeAssetTarget[] {
  const doc = new DOMParser().parseFromString(html, "text/html")
  const targets: RelativeAssetTarget[] = []
  for (const link of Array.from(doc.querySelectorAll('link[rel="stylesheet"][href]'))) {
    const href = link.getAttribute("href") ?? ""
    if (href && !isExternalAssetUrl(href)) targets.push({ path: resolveRelativeAssetPath(basePath, href), kind: "style" })
  }
  for (const script of Array.from(doc.querySelectorAll("script[src]"))) {
    const src = script.getAttribute("src") ?? ""
    if (src && !isExternalAssetUrl(src)) targets.push({ path: resolveRelativeAssetPath(basePath, src), kind: "script" })
  }
  return targets
}

/**
 * Replaces every relative `<link rel="stylesheet">` / `<script src>` with
 * an inline `<style>`/`<script>` holding the matching fetched content. A
 * target missing from `contentByPath` (broken reference, failed fetch) is
 * left as its original tag — a dead `<link>` degrades the same way it
 * would in a real browser, rather than silently vanishing.
 */
export function inlineRelativeAssets(html: string, basePath: string, contentByPath: ReadonlyMap<string, string>): string {
  const doc = new DOMParser().parseFromString(html, "text/html")

  function replace(el: Element, href: string, kind: "style" | "script") {
    if (!href || isExternalAssetUrl(href)) return
    const content = contentByPath.get(resolveRelativeAssetPath(basePath, href))
    if (content === undefined) return
    const replacement = doc.createElement(kind)
    replacement.textContent = content
    el.replaceWith(replacement)
  }

  for (const link of Array.from(doc.querySelectorAll('link[rel="stylesheet"][href]'))) {
    replace(link, link.getAttribute("href") ?? "", "style")
  }
  for (const script of Array.from(doc.querySelectorAll("script[src]"))) {
    replace(script, script.getAttribute("src") ?? "", "script")
  }
  return `<!doctype html>${doc.documentElement?.outerHTML ?? html}`
}

/**
 * Extensions `ArtifactPreview`'s iframe can actually render standalone.
 * SVG works too (it's valid srcdoc content), everything else — markdown,
 * source code, config — only ever makes sense as text, so callers don't
 * even offer an "Aperçu" toggle for those. Shared between the file tab's
 * own preview and the file-list thumbnail generator (Phase 7.2) — one
 * definition of "renderable", not two that could drift apart.
 */
const RENDERABLE_EXTENSIONS = new Set(["html", "htm", "svg"])

export function isRenderable(path: string): boolean {
  const extension = path.split(".").at(-1)?.toLowerCase()
  return !!extension && RENDERABLE_EXTENSIONS.has(extension)
}

export function decodeWorkspaceFile(file: Pick<WorkspaceFileRead, "content" | "encoding">): string {
  if (file.encoding === "utf-8") return file.content
  return new TextDecoder().decode(Uint8Array.from(atob(file.content), (char) => char.charCodeAt(0)))
}

const BASE64_CHUNK_SIZE = 0x8000

/**
 * Inverse of the base64 branch of `decodeWorkspaceFile` — used to upload
 * an arbitrary (possibly binary) file as base64 text over JSON. Builds
 * the intermediate binary string in chunks rather than
 * `String.fromCharCode(...bytes)` on the whole buffer at once: that
 * spreads the array as call arguments, which overflows the call stack
 * on anything beyond a few tens of thousands of bytes — an image upload
 * would hit that ceiling easily.
 */
export function encodeBase64(bytes: Uint8Array): string {
  let binary = ""
  for (let offset = 0; offset < bytes.length; offset += BASE64_CHUNK_SIZE) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + BASE64_CHUNK_SIZE))
  }
  return btoa(binary)
}
