import { describe, expect, test } from "bun:test"
import { classifyExtension, detectBinarySignature, looksLikeBase64Blob } from "../../src/observability/field-classifier"

describe("field classifier", () => {
  test("classifies known extensions", () => {
    expect(classifyExtension("photo.PNG")).toMatchObject({ fileKind: "image", extension: "png" })
    expect(classifyExtension("report.pdf")).toMatchObject({ fileKind: "pdf" })
    expect(classifyExtension("archive.tar.gz")).toMatchObject({ fileKind: "archive", extension: "gz" })
    expect(classifyExtension("index.ts")).toMatchObject({ fileKind: "code" })
    expect(classifyExtension("notes.md")).toMatchObject({ fileKind: "markdown" })
    expect(classifyExtension("data.csv")).toMatchObject({ fileKind: "text", extension: "csv" })
  })

  test("returns unknown for missing or extensionless names", () => {
    expect(classifyExtension(undefined)).toEqual({ fileKind: "unknown" })
    expect(classifyExtension("Makefile")).toEqual({ fileKind: "unknown" })
  })

  test("detects binary signatures by magic bytes", () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0])
    expect(detectBinarySignature(png)).toEqual({ mime: "image/png", fileKind: "image" })

    const pdf = new TextEncoder().encode("%PDF-1.7 rest of file")
    expect(detectBinarySignature(pdf)).toEqual({ mime: "application/pdf", fileKind: "pdf" })

    const webp = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50])
    expect(detectBinarySignature(webp)).toEqual({ mime: "image/webp", fileKind: "image" })

    const plain = new TextEncoder().encode("just some text")
    expect(detectBinarySignature(plain)).toBeUndefined()
  })

  test("flags long base64-shaped text as a binary blob", () => {
    const blob = Buffer.from("x".repeat(600)).toString("base64")
    expect(looksLikeBase64Blob(blob)).toBe(true)
    expect(looksLikeBase64Blob("short")).toBe(false)
    expect(looksLikeBase64Blob("not base64 because it has spaces and punctuation!".repeat(10))).toBe(false)
  })
})
