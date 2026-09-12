/* SPDX-License-Identifier: MIT */

import { describe, expect, test } from "bun:test"
import type { ArtifactManifest, ArtifactRendererId } from "@unifia/contracts/artifact-manifest"
import { resolveRenderer } from "../src/renderer-registry"

const base: ArtifactManifest = {
  manifestVersion: 1,
  kind: "html",
  renderer: "html",
  entry: "index.html",
  exports: [],
}

describe("resolveRenderer", () => {
  test("retourne le renderer déclaré dans le manifest", () => {
    expect(resolveRenderer(base)).toBe("html")
    expect(resolveRenderer({ ...base, kind: "react-component", renderer: "react-component" })).toBe(
      "react-component",
    )
    expect(resolveRenderer({ ...base, kind: "image", renderer: "media" })).toBe("media")
  })

  test("est déterministe : mêmes entrées → même sortie", () => {
    const m: ArtifactManifest = { ...base, renderer: "deck-html" }
    const a = resolveRenderer(m)
    const b = resolveRenderer(m)
    const c = resolveRenderer({ ...m })
    expect(a).toBe(b)
    expect(b).toBe(c)
    expect(a).toBe("deck-html" as ArtifactRendererId)
  })

  test("passe par tous les renderers déclarés sans erreur", () => {
    for (const renderer of [
      "html",
      "deck-html",
      "react-component",
      "markdown",
      "svg",
      "media",
    ] as const) {
      expect(resolveRenderer({ ...base, renderer })).toBe(renderer)
    }
  })

  test("ne mute pas le manifest passé en entrée", () => {
    const before: ArtifactManifest = { ...base, renderer: "markdown" }
    const snapshot = JSON.stringify(before)
    resolveRenderer(before)
    expect(JSON.stringify(before)).toBe(snapshot)
  })
})
