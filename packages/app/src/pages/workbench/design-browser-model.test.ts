/* SPDX-License-Identifier: MIT */

import { describe, expect, test } from "bun:test"
import { normalizeBrowserAddress } from "@/pages/workbench/design-browser-model"

describe("normalizeBrowserAddress", () => {
  test("promotes a bare host to https", () => {
    expect(normalizeBrowserAddress("example.com")).toBe("https://example.com/")
  })
  test("keeps an explicit http scheme", () => {
    expect(normalizeBrowserAddress("http://example.com/path")).toBe("http://example.com/path")
  })
  test("keeps an explicit https scheme with query and port", () => {
    expect(normalizeBrowserAddress("https://example.com:8443/a?b=1")).toBe("https://example.com:8443/a?b=1")
  })
  test("trims surrounding whitespace", () => {
    expect(normalizeBrowserAddress("  example.com  ")).toBe("https://example.com/")
  })
  test("refuses empty and whitespace-only input", () => {
    expect(normalizeBrowserAddress("")).toBe("")
    expect(normalizeBrowserAddress("   ")).toBe("")
  })
  // The Rust command refuses anything but http(s); catching it here keeps the
  // refusal explainable instead of surfacing a Rust error string.
  test("refuses a non-http scheme rather than promoting it", () => {
    expect(normalizeBrowserAddress("file:///etc/passwd")).toBe("")
    expect(normalizeBrowserAddress("javascript://alert(1)")).toBe("")
    expect(normalizeBrowserAddress("data://text/html,x")).toBe("")
  })
  test("refuses a scheme that names no host", () => {
    expect(normalizeBrowserAddress("https://")).toBe("")
  })
})
