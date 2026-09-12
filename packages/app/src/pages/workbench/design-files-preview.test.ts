/* SPDX-License-Identifier: MIT */

import { describe, expect, test } from "bun:test"
import {
  collectRelativeAssetTargets,
  decodeWorkspaceFile,
  encodeBase64,
  inlineRelativeAssets,
  isExternalAssetUrl,
  isRenderable,
  resolveRelativeAssetPath,
} from "./design-files-preview"

describe("isExternalAssetUrl", () => {
  test("absolute http(s) URLs are external", () => {
    expect(isExternalAssetUrl("https://example.com/a.css")).toBe(true)
    expect(isExternalAssetUrl("http://example.com/a.css")).toBe(true)
  })
  test("protocol-relative URLs are external", () => {
    expect(isExternalAssetUrl("//cdn.example.com/a.css")).toBe(true)
  })
  test("data URIs and anchors are external", () => {
    expect(isExternalAssetUrl("data:text/css;base64,abcd")).toBe(true)
    expect(isExternalAssetUrl("#inline")).toBe(true)
  })
  test("same-workspace relative paths are not external", () => {
    expect(isExternalAssetUrl("styles/tailwind-compiled.css")).toBe(false)
    expect(isExternalAssetUrl("./app.js")).toBe(false)
    expect(isExternalAssetUrl("../shared/base.css")).toBe(false)
  })
})

describe("resolveRelativeAssetPath", () => {
  test("resolves against the file's own directory, not the workspace root", () => {
    expect(resolveRelativeAssetPath("pages/index.html", "styles/base.css")).toBe("pages/styles/base.css")
  })
  test("root-level file resolves siblings with no leading slash", () => {
    expect(resolveRelativeAssetPath("index.html", "app.js")).toBe("app.js")
  })
  test("collapses .. segments", () => {
    expect(resolveRelativeAssetPath("pages/sub/index.html", "../shared/base.css")).toBe("pages/shared/base.css")
  })
  test("a leading slash is treated as workspace-root-relative", () => {
    expect(resolveRelativeAssetPath("pages/sub/index.html", "/styles/base.css")).toBe("styles/base.css")
  })
})

describe("collectRelativeAssetTargets", () => {
  test("finds relative stylesheet and script targets, resolved against the file's directory", () => {
    const html = `<!doctype html><html><head>
      <link rel="stylesheet" href="styles/base.css">
      <link rel="stylesheet" href="https://cdn.example.com/reset.css">
      <script src="app.js"></script>
      <script src="https://cdn.example.com/lib.js"></script>
    </head><body></body></html>`
    const targets = collectRelativeAssetTargets(html, "pages/index.html")
    expect(targets).toEqual([
      { path: "pages/styles/base.css", kind: "style" },
      { path: "pages/app.js", kind: "script" },
    ])
  })
  test("returns nothing for a document with no local assets", () => {
    const html = `<!doctype html><html><head></head><body><p>hi</p></body></html>`
    expect(collectRelativeAssetTargets(html, "index.html")).toEqual([])
  })
})

describe("inlineRelativeAssets", () => {
  test("replaces a relative stylesheet link with an inline <style>", () => {
    const html = `<!doctype html><html><head><link rel="stylesheet" href="styles/base.css"></head><body></body></html>`
    const result = inlineRelativeAssets(html, "index.html", new Map([["styles/base.css", "body{color:red}"]]))
    expect(result).toContain("<style>body{color:red}</style>")
    expect(result).not.toContain("<link")
  })
  test("replaces a relative script src with an inline <script>", () => {
    const html = `<!doctype html><html><head></head><body><script src="app.js"></script></body></html>`
    const result = inlineRelativeAssets(html, "index.html", new Map([["app.js", "console.log(1)"]]))
    expect(result).toContain("<script>console.log(1)</script>")
  })
  test("leaves an external stylesheet untouched", () => {
    const html = `<!doctype html><html><head><link rel="stylesheet" href="https://cdn.example.com/reset.css"></head><body></body></html>`
    const result = inlineRelativeAssets(html, "index.html", new Map())
    expect(result).toContain('href="https://cdn.example.com/reset.css"')
  })
  test("a missing fetch result leaves the original tag rather than dropping it silently", () => {
    const html = `<!doctype html><html><head><link rel="stylesheet" href="styles/missing.css"></head><body></body></html>`
    const result = inlineRelativeAssets(html, "index.html", new Map())
    expect(result).toContain('href="styles/missing.css"')
  })
})

describe("isRenderable", () => {
  test("html, htm and svg are renderable", () => {
    expect(isRenderable("index.html")).toBe(true)
    expect(isRenderable("legacy.htm")).toBe(true)
    expect(isRenderable("icon.svg")).toBe(true)
  })
  test("is case-insensitive on the extension", () => {
    expect(isRenderable("INDEX.HTML")).toBe(true)
  })
  test("source and config files are not renderable", () => {
    expect(isRenderable("app.ts")).toBe(false)
    expect(isRenderable("styles/base.css")).toBe(false)
    expect(isRenderable("README.md")).toBe(false)
  })
  test("a path with no extension is not renderable", () => {
    expect(isRenderable("Makefile")).toBe(false)
  })
})

describe("decodeWorkspaceFile", () => {
  test("passes utf-8 content through unchanged", () => {
    expect(decodeWorkspaceFile({ content: "hello", encoding: "utf-8" })).toBe("hello")
  })
  test("decodes base64 content", () => {
    expect(decodeWorkspaceFile({ content: btoa("hello"), encoding: "base64" })).toBe("hello")
  })
})

describe("encodeBase64", () => {
  test("round-trips through decodeWorkspaceFile", () => {
    const bytes = new TextEncoder().encode("hello, upload")
    const encoded = encodeBase64(bytes)
    expect(decodeWorkspaceFile({ content: encoded, encoding: "base64" })).toBe("hello, upload")
  })
  test("handles an empty buffer", () => {
    expect(encodeBase64(new Uint8Array(0))).toBe("")
  })
  test("handles a buffer larger than one chunk without overflowing the call stack", () => {
    const bytes = new Uint8Array(200_000).fill(65) // 'A', well past BASE64_CHUNK_SIZE
    const encoded = encodeBase64(bytes)
    const decoded = decodeWorkspaceFile({ content: encoded, encoding: "base64" })
    expect(decoded.length).toBe(200_000)
    expect(decoded.startsWith("AAAA")).toBe(true)
  })
})
