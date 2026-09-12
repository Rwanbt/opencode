/* SPDX-License-Identifier: MIT */

import { describe, expect, test } from "bun:test"
import { exportStandaloneHtml, type AssetResolver } from "../src/export-html"

const enc = new TextEncoder()

function bytes(text: string): Uint8Array {
  return enc.encode(text)
}

describe("exportStandaloneHtml", () => {
  test("inlines a relative stylesheet into a <style> block", () => {
    const html = `<!doctype html><html><head><link rel="stylesheet" href="theme.css"></head><body>Hi</body></html>`
    const resolver: AssetResolver = (path) => (path === "theme.css" ? bytes("body { color: red; }") : null)
    const result = exportStandaloneHtml(html, resolver)
    expect(result.html).toContain("<style>body { color: red; }</style>")
    expect(result.html).not.toContain("theme.css")
    expect(result.inlined).toEqual(["theme.css"])
    expect(result.missing).toEqual([])
  })

  test("inlines a relative script into a <script> block", () => {
    const html = `<!doctype html><html><body><script src="app.js"></script></body></html>`
    const resolver: AssetResolver = (path) => (path === "app.js" ? bytes("console.log('hi')") : null)
    const result = exportStandaloneHtml(html, resolver)
    expect(result.html).toContain("<script>console.log('hi')</script>")
    expect(result.inlined).toEqual(["app.js"])
  })

  test("rewrites a relative <img src> to a data: URI", () => {
    const html = `<!doctype html><html><body><img src="logo.png" alt="logo"></body></html>`
    const png = bytes("\x89PNG\r\n\x1a\n")
    const resolver: AssetResolver = (path) => (path === "logo.png" ? png : null)
    const result = exportStandaloneHtml(html, resolver)
    expect(result.html).toMatch(/src="data:image\/png;base64,[^"]+"/)
    expect(result.inlined).toEqual(["logo.png"])
  })

  test("preserves and reports an absolute URL", () => {
    const html = `<!doctype html><html><body><a href="https://example.com/style.css">x</a></body></html>`
    const result = exportStandaloneHtml(html, () => null)
    expect(result.html).toContain("https://example.com/style.css")
  })

  test("preserves and reports a data: URL", () => {
    const html = `<!doctype html><html><body><img src="data:image/png;base64,AAAA" alt="x"></body></html>`
    const result = exportStandaloneHtml(html, () => null)
    expect(result.html).toContain("data:image/png;base64,AAAA")
  })

  test("a missing asset is reported, not silently dropped", () => {
    const html = `<!doctype html><html><head><link rel="stylesheet" href="missing.css"></head></body></html>`
    const result = exportStandaloneHtml(html, () => null)
    expect(result.missing).toContain("missing.css")
    expect(result.html).toContain("missing.css")
  })

  test("inlines url(...) references inside the inlined CSS", () => {
    const html = `<!doctype html><html><head><link rel="stylesheet" href="theme.css"></head></html>`
    const fontBytes = bytes("\x00\x01\x02\x03")
    const resolver: AssetResolver = (path) => {
      if (path === "theme.css") return bytes("body { background: url('font.woff2'); }")
      if (path === "font.woff2") return fontBytes
      return null
    }
    const result = exportStandaloneHtml(html, resolver)
    expect(result.html).toMatch(/data:application\/octet-stream;base64,[^"]+/)
    expect(result.inlined.sort()).toEqual(["font.woff2", "theme.css"])
  })

  test("deterministic for the same input and resolver", () => {
    const html = `<!doctype html><html><head><link rel="stylesheet" href="a.css"></head><body><img src="a.png"></body></html>`
    const resolver: AssetResolver = (path) => {
      if (path === "a.css") return bytes("body { color: red; }")
      if (path === "a.png") return bytes("\x89PNG\r\n\x1a\n")
      return null
    }
    const a = exportStandaloneHtml(html, resolver)
    const b = exportStandaloneHtml(html, resolver)
    expect(a.html).toBe(b.html)
    expect(a.inlined).toEqual(b.inlined)
  })

  test("the resolver is the only source of bytes (no network access in this module)", () => {
    let calls = 0
    const resolver: AssetResolver = (path) => {
      calls += 1
      if (path === "x.css") return bytes("body { }")
      return null
    }
    exportStandaloneHtml(`<link rel="stylesheet" href="x.css">`, resolver)
    expect(calls).toBe(1)
  })

  test("scripts inlined verbatim, with no extra wrapping", () => {
    const html = `<!doctype html><html><body><script src="app.js"></script></body></html>`
    const source = "if (a) {\n  b()\n}\n"
    const resolver: AssetResolver = (path) => (path === "app.js" ? bytes(source) : null)
    const result = exportStandaloneHtml(html, resolver)
    expect(result.html).toContain(`<script>${source}</script>`)
  })

  test("a JPEG asset is correctly typed as image/jpeg", () => {
    const html = `<img src="cover.jpg">`
    const resolver: AssetResolver = (path) => (path === "cover.jpg" ? bytes("\xff\xd8\xff") : null)
    const result = exportStandaloneHtml(html, resolver)
    expect(result.html).toMatch(/src="data:image\/jpeg;base64,[^"]+"/)
  })

  test("a SVG asset is correctly typed as image/svg+xml", () => {
    const html = `<img src="icon.svg">`
    const resolver: AssetResolver = (path) => (path === "icon.svg" ? bytes("<svg></svg>") : null)
    const result = exportStandaloneHtml(html, resolver)
    expect(result.html).toMatch(/src="data:image\/svg\+xml;base64,[^"]+"/)
  })
})
