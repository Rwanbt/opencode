import { describe, expect, test } from "bun:test"
import {
  normalizeMimeType,
  fileExtension,
  mediaKindFromPath,
  isBinaryContent,
  dataUrlFromMediaValue,
  svgTextFromValue,
  hasMediaValue,
} from "./media"

describe("normalizeMimeType", () => {
  test("strips parameters and lowercases", () => {
    expect(normalizeMimeType("Image/PNG; charset=utf-8")).toBe("image/png")
    expect(normalizeMimeType("text/plain")).toBe("text/plain")
  })

  test("canonicalizes legacy audio mime types", () => {
    expect(normalizeMimeType("audio/x-aac")).toBe("audio/aac")
    expect(normalizeMimeType("audio/x-m4a")).toBe("audio/mp4")
  })

  test("returns undefined for empty or missing input", () => {
    expect(normalizeMimeType(undefined)).toBeUndefined()
    expect(normalizeMimeType("")).toBeUndefined()
    expect(normalizeMimeType("   ")).toBeUndefined()
  })
})

describe("fileExtension", () => {
  test("returns the lowercased extension", () => {
    expect(fileExtension("photo.PNG")).toBe("png")
    expect(fileExtension("/a/b/c.tar.gz")).toBe("gz")
  })

  test("returns empty string when there is no extension", () => {
    expect(fileExtension("README")).toBe("")
    expect(fileExtension(undefined)).toBe("")
  })
})

describe("mediaKindFromPath", () => {
  test("classifies svg, image and audio", () => {
    expect(mediaKindFromPath("logo.svg")).toBe("svg")
    expect(mediaKindFromPath("pic.jpeg")).toBe("image")
    expect(mediaKindFromPath("track.flac")).toBe("audio")
  })

  test("returns undefined for unknown or extensionless paths", () => {
    expect(mediaKindFromPath("notes.txt")).toBeUndefined()
    expect(mediaKindFromPath("Makefile")).toBeUndefined()
  })
})

describe("isBinaryContent", () => {
  test("detects the binary record type", () => {
    expect(isBinaryContent({ type: "binary" })).toBe(true)
    expect(isBinaryContent({ type: "text" })).toBe(false)
    expect(isBinaryContent("a string")).toBe(false)
    expect(isBinaryContent(null)).toBe(false)
  })
})

describe("dataUrlFromMediaValue", () => {
  test("passes through valid string data URLs by kind", () => {
    expect(dataUrlFromMediaValue("data:image/png;base64,AAAA", "image")).toBe("data:image/png;base64,AAAA")
    expect(dataUrlFromMediaValue("data:image/svg+xml,<svg/>", "svg")).toBe("data:image/svg+xml,<svg/>")
  })

  test("rejects a string data URL whose kind does not match", () => {
    expect(dataUrlFromMediaValue("data:image/png;base64,AAAA", "svg")).toBeUndefined()
    expect(dataUrlFromMediaValue("data:audio/mp3;base64,AAAA", "image")).toBeUndefined()
  })

  test("rewrites legacy audio data URLs", () => {
    expect(dataUrlFromMediaValue("data:audio/x-aac;base64,AAAA", "audio")).toBe("data:audio/aac;base64,AAAA")
    expect(dataUrlFromMediaValue("data:audio/x-m4a;base64,AAAA", "audio")).toBe("data:audio/mp4;base64,AAAA")
  })

  test("builds a data URL from a base64 record", () => {
    expect(
      dataUrlFromMediaValue({ content: "AAAA", encoding: "base64", mimeType: "image/png" }, "image"),
    ).toBe("data:image/png;base64,AAAA")
  })

  test("encodes a non-base64 svg record as utf-8", () => {
    expect(dataUrlFromMediaValue({ content: "<svg/>", mimeType: "image/svg+xml" }, "svg")).toBe(
      "data:image/svg+xml;charset=utf-8,%3Csvg%2F%3E",
    )
  })

  test("rejects a record whose mime type contradicts the kind", () => {
    expect(
      dataUrlFromMediaValue({ content: "AAAA", encoding: "base64", mimeType: "audio/mp3" }, "image"),
    ).toBeUndefined()
  })

  test("returns undefined for empty values", () => {
    expect(dataUrlFromMediaValue(undefined, "image")).toBeUndefined()
    expect(dataUrlFromMediaValue({ mimeType: "image/png" }, "image")).toBeUndefined()
  })
})

describe("svgTextFromValue", () => {
  test("returns inline svg markup verbatim", () => {
    expect(svgTextFromValue({ content: "<svg></svg>", mimeType: "image/svg+xml" })).toBe("<svg></svg>")
  })

  test("decodes base64-encoded svg", () => {
    const encoded = Buffer.from("<svg>x</svg>", "utf-8").toString("base64")
    expect(svgTextFromValue({ content: encoded, encoding: "base64", mimeType: "image/svg+xml" })).toBe("<svg>x</svg>")
  })

  test("returns undefined for non-svg mime types", () => {
    expect(svgTextFromValue({ content: "<svg/>", mimeType: "image/png" })).toBeUndefined()
  })
})

describe("hasMediaValue", () => {
  test("true for non-empty strings and records with content", () => {
    expect(hasMediaValue("x")).toBe(true)
    expect(hasMediaValue({ content: "abc" })).toBe(true)
  })

  test("false for empty strings, empty content and non-records", () => {
    expect(hasMediaValue("")).toBe(false)
    expect(hasMediaValue({ content: "" })).toBe(false)
    expect(hasMediaValue(null)).toBe(false)
    expect(hasMediaValue(undefined)).toBe(false)
  })
})
