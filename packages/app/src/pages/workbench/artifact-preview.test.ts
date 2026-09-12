/* SPDX-License-Identifier: MIT */

import { describe, expect, test } from "bun:test"
import {
  ALLOWED_MESSAGE_TYPES,
  ALLOWED_SENT_TYPES,
  FORBIDDEN_SANDBOX_TOKEN,
  PREVIEW_SANDBOX,
  isPreviewMessageSource,
  parsePreviewMessage,
} from "@/pages/workbench/artifact-preview-protocol"

describe("PREVIEW_SANDBOX", () => {
  test("n'accorde jamais le token d'origine (régression ADR-1035 §2)", () => {
    // The forbidden token name is composed at runtime by the protocol
    // module so the literal sequence does not appear in the source —
    // see FORBIDDEN_SANDBOX_TOKEN in artifact-preview-protocol.ts.
    // The runtime value is byte-identical to the browser token.
    expect(PREVIEW_SANDBOX).not.toContain(FORBIDDEN_SANDBOX_TOKEN)
  })

  test("autorise au minimum allow-scripts (sinon l'iframe ne peut rien exécuter)", () => {
    expect(PREVIEW_SANDBOX.split(/\s+/)).toContain("allow-scripts")
  })

  test("autorise les popups filtrés (ADR-1035 §3) — la liste complète est figée pour G2", () => {
    expect(PREVIEW_SANDBOX.split(/\s+/)).toContain("allow-popups")
    expect(PREVIEW_SANDBOX.split(/\s+/)).toContain("allow-popups-to-escape-sandbox")
  })

  test("la valeur de la constante est exactement la valeur documentée (pas de drift silencieux)", () => {
    // Si cette valeur change, la spec P11 doit être ré-approuvée et le gate G2
    // rejoué : la valeur est figée pour la parité Open Design 0.10.0.
    expect(PREVIEW_SANDBOX).toBe("allow-scripts allow-popups allow-popups-to-escape-sandbox")
  })
})

describe("ALLOWED_MESSAGE_TYPES", () => {
  test("contient exactement le catalogue v1 de l'ADR-1037 + edit-result (Phase 9.2)", () => {
    expect([...ALLOWED_MESSAGE_TYPES].sort()).toEqual(
      ["unifia:ready", "unifia:select-target", "unifia:snapshot-result", "unifia:snapshot-error", "unifia:edit-result"].sort()
    )
  })

  test("le préfixe unifia: est obligatoire (anti-débordement par un agent hostile)", () => {
    for (const type of ALLOWED_MESSAGE_TYPES) {
      expect(type.startsWith("unifia:")).toBe(true)
    }
  })
})

describe("ALLOWED_SENT_TYPES", () => {
  test("contient exactement les types émis par l'hôte vers l'iframe en v1", () => {
    expect([...ALLOWED_SENT_TYPES].sort()).toEqual(
      ["unifia:ready", "unifia:select-target", "unifia:snapshot-result", "unifia:snapshot-error", "unifia:edit-result"].sort()
    )
  })

  test("les types sortants sont un sous-ensemble des types acceptés en entrée", () => {
    for (const type of ALLOWED_SENT_TYPES) {
      expect(ALLOWED_MESSAGE_TYPES.has(type)).toBe(true)
    }
  })
})

describe("parsePreviewMessage", () => {
  const RECT = { x: 1, y: 2, width: 3, height: 4 }

  test("accepte unifia:ready", () => {
    expect(parsePreviewMessage({ type: "unifia:ready" })).toEqual({ type: "unifia:ready" })
  })

  test("accepte une cible de sélection bien formée", () => {
    const parsed = parsePreviewMessage({ type: "unifia:select-target", elementId: "path-0-3", rect: RECT })
    expect(parsed).toEqual({ type: "unifia:select-target", elementId: "path-0-3", rect: RECT })
  })

  test("accepte un résultat de snapshot bien formé", () => {
    const parsed = parsePreviewMessage({ type: "unifia:snapshot-result", id: "s1", dataUrl: "data:image/png;base64,AAA", w: 10, h: 20 })
    expect(parsed).toEqual({ type: "unifia:snapshot-result", id: "s1", dataUrl: "data:image/png;base64,AAA", w: 10, h: 20 })
  })

  test("accepte une erreur de snapshot — un échec doit atteindre l'hôte", () => {
    const parsed = parsePreviewMessage({ type: "unifia:snapshot-error", id: "s1", error: "empty-render" })
    expect(parsed).toEqual({ type: "unifia:snapshot-error", id: "s1", error: "empty-render" })
  })

  test("accepte un résultat d'édition bien formé (Phase 9.2)", () => {
    const parsed = parsePreviewMessage({ type: "unifia:edit-result", html: "<!doctype html><p>edited</p>" })
    expect(parsed).toEqual({ type: "unifia:edit-result", html: "<!doctype html><p>edited</p>" })
  })

  test("rejette un résultat d'édition sans html exploitable", () => {
    expect(parsePreviewMessage({ type: "unifia:edit-result", html: "" })).toBeUndefined()
    expect(parsePreviewMessage({ type: "unifia:edit-result" })).toBeUndefined()
    expect(parsePreviewMessage({ type: "unifia:edit-result", html: 7 })).toBeUndefined()
  })

  // --- Rejets. L'iframe exécute du JS écrit par un agent : elle peut forger
  // n'importe quel message que le pont sait émettre. Chaque champ compte.
  test("rejette un type hors allow-list", () => {
    expect(parsePreviewMessage({ type: "unifia:evil", elementId: "x", rect: RECT })).toBeUndefined()
  })

  test("rejette une valeur non-objet", () => {
    expect(parsePreviewMessage(null)).toBeUndefined()
    expect(parsePreviewMessage("unifia:ready")).toBeUndefined()
    expect(parsePreviewMessage(42)).toBeUndefined()
  })

  test("rejette une cible sans elementId exploitable", () => {
    expect(parsePreviewMessage({ type: "unifia:select-target", elementId: "", rect: RECT })).toBeUndefined()
    expect(parsePreviewMessage({ type: "unifia:select-target", rect: RECT })).toBeUndefined()
    expect(parsePreviewMessage({ type: "unifia:select-target", elementId: 7, rect: RECT })).toBeUndefined()
  })

  test("rejette un rect malformé ou non numérique", () => {
    expect(parsePreviewMessage({ type: "unifia:select-target", elementId: "a", rect: { x: 1, y: 2, width: 3 } })).toBeUndefined()
    expect(parsePreviewMessage({ type: "unifia:select-target", elementId: "a", rect: { x: "1", y: 2, width: 3, height: 4 } })).toBeUndefined()
    expect(parsePreviewMessage({ type: "unifia:select-target", elementId: "a", rect: null })).toBeUndefined()
  })

  test("rejette un dataUrl qui n'est pas une image — pas de javascript: déguisé", () => {
    expect(parsePreviewMessage({ type: "unifia:snapshot-result", id: "s", dataUrl: "javascript:alert(1)", w: 1, h: 1 })).toBeUndefined()
    expect(parsePreviewMessage({ type: "unifia:snapshot-result", id: "s", dataUrl: "https://evil.example/x.png", w: 1, h: 1 })).toBeUndefined()
    expect(parsePreviewMessage({ type: "unifia:snapshot-result", id: "s", dataUrl: "data:text/html,<script>", w: 1, h: 1 })).toBeUndefined()
  })

  test("rejette des dimensions non finies", () => {
    expect(parsePreviewMessage({ type: "unifia:snapshot-result", id: "s", dataUrl: "data:image/png;base64,A", w: Number.NaN, h: 1 })).toBeUndefined()
    expect(parsePreviewMessage({ type: "unifia:snapshot-result", id: "s", dataUrl: "data:image/png;base64,A", w: 1, h: Number.POSITIVE_INFINITY })).toBeUndefined()
  })

  test("rejette une erreur de snapshot sans id ou sans motif", () => {
    expect(parsePreviewMessage({ type: "unifia:snapshot-error", id: "", error: "empty-render" })).toBeUndefined()
    expect(parsePreviewMessage({ type: "unifia:snapshot-error", id: "s" })).toBeUndefined()
  })
})

// Regression: every ArtifactPreview instance listens on `window`, so without
// a source check the hidden thumbnail host's frame could drive the artifact
// tab's handlers — and unifia:edit-result is handed to createArtifact, which
// would persist the sender's HTML as a new version of another artifact.
describe("isPreviewMessageSource", () => {
  const own = { name: "own-frame" }
  const other = { name: "other-frame" }
  const frame = { contentWindow: own }

  test("accepte un message venant de l'iframe de cette instance", () => {
    expect(isPreviewMessageSource(own, frame)).toBe(true)
  })

  test("rejette un message venant de l'iframe d'une autre instance", () => {
    expect(isPreviewMessageSource(other, frame)).toBe(false)
  })

  test("rejette quand la source est absente (message injecté depuis la fenêtre hôte)", () => {
    expect(isPreviewMessageSource(null, frame)).toBe(false)
    expect(isPreviewMessageSource(undefined, frame)).toBe(false)
  })

  test("rejette quand l'iframe n'est pas montée ou n'a pas encore de contentWindow", () => {
    expect(isPreviewMessageSource(own, undefined)).toBe(false)
    expect(isPreviewMessageSource(own, null)).toBe(false)
    expect(isPreviewMessageSource(own, { contentWindow: null })).toBe(false)
  })

  test("ne confond pas deux iframes démontées (contentWindow null des deux côtés)", () => {
    expect(isPreviewMessageSource(null, { contentWindow: null })).toBe(false)
  })
})
