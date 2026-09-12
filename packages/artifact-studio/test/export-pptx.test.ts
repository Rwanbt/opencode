/* SPDX-License-Identifier: MIT */

import { describe, expect, test } from "bun:test"
import { readStoredZip } from "@unifia/document-packs/zip"
import { previewArtifact } from "../src/index"
import { buildArtifactArchive, ExecutablePartError, readArtifactArchive } from "../src/export-zip"
import { buildPptxBytes, buildPptxBytesAndPreview, buildPptxEntries } from "../src/export-pptx"

const enc = new TextEncoder()

describe("buildPptxBytes", () => {
  test("the produced PPTX round-trips through previewArtifact", () => {
    const bytes = buildPptxBytes([{ title: "Hello" }, { title: "World", body: "second slide" }])
    const preview = previewArtifact("pptx", bytes)
    expect(preview.parts).toContain("ppt/slides/slide1.xml")
    expect(preview.parts).toContain("ppt/slides/slide2.xml")
    expect(preview.text).toContain("Hello")
    expect(preview.text).toContain("World")
    expect(preview.text).toContain("second slide")
  })

  test("the produced PPTX has no executable parts", () => {
    const bytes = buildPptxBytes([{ title: "x" }])
    const entries = readStoredZip(bytes)
    const names = entries.map((e) => e.name)
    expect(names.some((n) => n.endsWith(".bin"))).toBe(false)
    expect(names.some((n) => n.includes("vbaProject"))).toBe(false)
  })

  test("buildPptxEntries exposes the same entries as buildPptxBytes", () => {
    const a = buildPptxEntries([{ title: "A" }, { title: "B" }])
    const b = readStoredZip(buildPptxBytes([{ title: "A" }, { title: "B" }]))
    expect(a.map((e) => e.name).sort()).toEqual(b.map((e) => e.name).sort())
  })

  test("buildPptxBytesAndPreview returns the preview alongside the bytes", () => {
    const { bytes, preview } = buildPptxBytesAndPreview([{ title: "x" }])
    expect(bytes.byteLength).toBeGreaterThan(0)
    expect(preview.text).toContain("x")
  })
})

describe("buildArtifactArchive", () => {
  test("the archive preserves relative paths", () => {
    const archive = buildArtifactArchive([
      { name: "design/index.html", content: enc.encode("<!doctype html>") },
      { name: "design/style.css", content: enc.encode("body { }") },
    ])
    const read = readArtifactArchive(archive)
    const names = read.map((e) => e.name).sort()
    expect(names).toEqual(["design/index.html", "design/style.css"])
  })

  test("executable parts are refused with ExecutablePartError", () => {
    expect(() =>
      buildArtifactArchive([{ name: "vbaProject.bin", content: enc.encode("evil") }])
    ).toThrow(ExecutablePartError)
    expect(() =>
      buildArtifactArchive([{ name: "design/Macros/bad.bin", content: enc.encode("evil") }])
    ).toThrow(ExecutablePartError)
  })

  test("readArtifactArchive mirrors the entries", () => {
    const entries = [
      { name: "a.html", content: enc.encode("<html>") },
      { name: "b.txt", content: enc.encode("hi") },
    ]
    const read = readArtifactArchive(buildArtifactArchive(entries))
    const map = new Map(read.map((e) => [e.name, new TextDecoder().decode(e.content)]))
    expect(map.get("a.html")).toBe("<html>")
    expect(map.get("b.txt")).toBe("hi")
  })

  test("an empty archive round-trips to an empty list", () => {
    const read = readArtifactArchive(buildArtifactArchive([]))
    expect(read).toEqual([])
  })
})
