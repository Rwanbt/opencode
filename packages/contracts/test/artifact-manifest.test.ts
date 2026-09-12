/* SPDX-License-Identifier: MIT */

import { describe, expect, test } from "bun:test"
import {
  inferManifest,
  MANIFEST_VERSION,
  parseArtifactManifest,
  type ArtifactManifest,
} from "../src/artifact-manifest"

const valid: ArtifactManifest = {
  manifestVersion: MANIFEST_VERSION,
  kind: "html",
  renderer: "html",
  entry: "index.html",
  exports: [],
}

describe("parseArtifactManifest", () => {
  test("accepte un manifest v1 minimal et le retourne tel quel", () => {
    const parsed = parseArtifactManifest({ ...valid })
    expect(parsed).toEqual(valid)
  })

  test("accepte tous les kinds et tous les renderers déclarés", () => {
    for (const kind of ["html", "deck", "react-component", "markdown-document", "svg", "image", "video", "audio"] as const) {
      const m = { ...valid, kind }
      expect(() => parseArtifactManifest(m)).not.toThrow()
    }
    for (const renderer of ["html", "deck-html", "react-component", "markdown", "svg", "media"] as const) {
      const m = { ...valid, renderer }
      expect(() => parseArtifactManifest(m)).not.toThrow()
    }
  })

  test("rejette un manifestVersion différent de 1 (règle 1)", () => {
    expect(() => parseArtifactManifest({ ...valid, manifestVersion: 2 })).toThrow(/unsupported manifestVersion/)
    expect(() => parseArtifactManifest({ ...valid, manifestVersion: "v1" })).toThrow(/unsupported manifestVersion/)
    expect(() => parseArtifactManifest({ ...valid, manifestVersion: undefined })).toThrow(/unsupported manifestVersion/)
  })

  test("rejette un kind hors de l'union close (règle 2)", () => {
    expect(() => parseArtifactManifest({ ...valid, kind: "docx" })).toThrow(/unknown kind/)
    expect(() => parseArtifactManifest({ ...valid, kind: "" })).toThrow(/unknown kind/)
    expect(() => parseArtifactManifest({ ...valid, kind: 42 })).toThrow(/unknown kind/)
  })

  test("rejette un renderer hors de l'union close (règle 2)", () => {
    expect(() => parseArtifactManifest({ ...valid, renderer: "pdf" })).toThrow(/unknown renderer/)
    expect(() => parseArtifactManifest({ ...valid, renderer: null })).toThrow(/unknown renderer/)
  })

  test("rejette un entry qui contient '..' (règle 3)", () => {
    expect(() => parseArtifactManifest({ ...valid, entry: "../etc/passwd" })).toThrow(/\.\./)
    expect(() => parseArtifactManifest({ ...valid, entry: "foo/../../bar" })).toThrow(/\.\./)
  })

  test("rejette un entry absolu (règle 3)", () => {
    expect(() => parseArtifactManifest({ ...valid, entry: "/etc/passwd" })).toThrow(/relative/)
    expect(() => parseArtifactManifest({ ...valid, entry: "C:/Windows/system32" })).toThrow(/relative/)
  })

  test("rejette un entry vide (règle 3)", () => {
    expect(() => parseArtifactManifest({ ...valid, entry: "" })).toThrow(/empty/)
  })

  test("rejette un exports qui n'est pas un tableau de chaînes", () => {
    expect(() => parseArtifactManifest({ ...valid, exports: "x" })).toThrow(/exports/)
    expect(() => parseArtifactManifest({ ...valid, exports: [1, 2] })).toThrow(/exports/)
    expect(() => parseArtifactManifest({ ...valid, exports: null })).toThrow(/exports/)
  })

  test("rejette une valeur qui n'est pas un objet", () => {
    expect(() => parseArtifactManifest(null)).toThrow(/object/)
    expect(() => parseArtifactManifest("manifest")).toThrow(/object/)
    expect(() => parseArtifactManifest([])).toThrow(/object/)
  })
})

describe("inferManifest", () => {
  test("renvoie null pour les extensions inconnues", () => {
    expect(inferManifest("data.xyz")).toBeNull()
    expect(inferManifest("README")).toBeNull()
    expect(inferManifest("Makefile")).toBeNull()
  })

  test("mappe les extensions web classiques vers le bon kind", () => {
    expect(inferManifest("index.html")?.kind).toBe("html")
    expect(inferManifest("page.htm")?.kind).toBe("html")
    expect(inferManifest("readme.md")?.kind).toBe("markdown-document")
    expect(inferManifest("doc.markdown")?.kind).toBe("markdown-document")
    expect(inferManifest("logo.svg")?.kind).toBe("svg")
    expect(inferManifest("App.tsx")?.kind).toBe("react-component")
    expect(inferManifest("Card.jsx")?.kind).toBe("react-component")
  })

  test("mappe les extensions média vers renderer 'media'", () => {
    for (const ext of ["mp4", "webm", "mov", "mp3", "wav", "ogg", "png", "jpg", "gif", "webp", "avif"]) {
      const m = inferManifest(`file.${ext}`)
      expect(m?.renderer).toBe("media")
      expect(m?.manifestVersion).toBe(1)
    }
  })

  test("le renderer par défaut suit le kind quand c'est non-média", () => {
    expect(inferManifest("page.html")?.renderer).toBe("html")
    expect(inferManifest("readme.md")?.renderer).toBe("markdown")
    expect(inferManifest("App.tsx")?.renderer).toBe("react-component")
  })

  test("préserve l'entry tel quel (utile pour les chemins en sous-dossier)", () => {
    expect(inferManifest("sub/folder/page.html")?.entry).toBe("sub/folder/page.html")
    expect(inferManifest("page.html")?.entry).toBe("page.html")
  })

  test("gère la casse des extensions (.HTML, .SVG)", () => {
    expect(inferManifest("INDEX.HTML")?.kind).toBe("html")
    expect(inferManifest("Logo.SVG")?.kind).toBe("svg")
  })
})
