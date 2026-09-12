/* SPDX-License-Identifier: MIT */

import { describe, expect, test } from "bun:test"
import { deriveExportFilename } from "@/pages/workbench/design-artifact-export"

describe("deriveExportFilename", () => {
  test("replaces the source extension with the requested one", () => {
    expect(deriveExportFilename("design-preview.svg", "html")).toBe("design-preview.html")
  })
  test("handles a filename with no extension", () => {
    expect(deriveExportFilename("artifact", "pdf")).toBe("artifact.pdf")
  })
  test("handles multiple dots, stripping only the last extension", () => {
    expect(deriveExportFilename("landing.page.v2.html", "pdf")).toBe("landing.page.v2.pdf")
  })
  test("falls back to 'artifact' for an undefined or empty filename", () => {
    expect(deriveExportFilename(undefined, "html")).toBe("artifact.html")
    expect(deriveExportFilename("", "html")).toBe("artifact.html")
    expect(deriveExportFilename("   ", "html")).toBe("artifact.html")
  })
})
