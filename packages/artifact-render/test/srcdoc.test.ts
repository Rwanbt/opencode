/* SPDX-License-Identifier: MIT */

import { describe, expect, test } from "bun:test"
import {
  buildSrcdoc,
  EDIT_BRIDGE_SCRIPT,
  FOCUS_GUARD_SCRIPT,
  STORAGE_SHIM_SCRIPT,
} from "@unifia/artifact-render"

const STORAGE_PROBE = "try{var t='__unifia_probe__';localStorage.setItem(t,t);localStorage.removeItem(t);"
const FOCUS_PROBE = "var TRUST_MS=1000;"

describe("buildSrcdoc", () => {
  test("enveloppe un fragment dans une coquille minimale", () => {
    const out = buildSrcdoc("<p>hello</p>")
    expect(out.startsWith("<!doctype html>")).toBe(true)
    expect(out).toContain("<body>")
    expect(out).toContain("<p>hello</p>")
    expect(out).toContain(STORAGE_SHIM_SCRIPT)
    expect(out).toContain(FOCUS_GUARD_SCRIPT)
  })

  test("n'enveloppe pas deux fois un document complet commençant par <!doctype", () => {
    const full = "<!doctype html><html><head><title>t</title></head><body><p>hi</p></body></html>"
    const out = buildSrcdoc(full)
    // Une seule occurrence de <!doctype> (pas de ré-enveloppement)
    expect(out.match(/<!doctype/g)?.length).toBe(1)
    // Le contenu d'origine est préservé
    expect(out).toContain("<title>t</title>")
    expect(out).toContain("<p>hi</p>")
    // Mais le shim et le focus guard sont injectés
    expect(out).toContain(STORAGE_SHIM_SCRIPT)
    expect(out).toContain(FOCUS_GUARD_SCRIPT)
  })

  test("n'enveloppe pas deux fois un document complet commençant par <html", () => {
    const full = "<html><head><title>t</title></head><body><p>hi</p></body></html>"
    const out = buildSrcdoc(full)
    // Pas de ré-enveloppement : <!doctype> apparaît au plus une fois (ou zéro, si l'auteur ne l'a pas mis)
    const doctypeCount = out.match(/<!doctype/g)?.length ?? 0
    expect(doctypeCount).toBeLessThanOrEqual(1)
    expect(out).toContain("<title>t</title>")
    expect(out).toContain(STORAGE_SHIM_SCRIPT)
  })

  test("le shim est injecté juste après <head>, AVANT tout <script> d'auteur", () => {
    const full = "<!doctype html><html><head><script src=\"app.js\"></script></head><body></body></html>"
    const out = buildSrcdoc(full)
    const headOpenEnd = full.indexOf("<head>") + "<head>".length
    const shimIndex = out.indexOf(STORAGE_SHIM_SCRIPT)
    const authorScriptIndex = out.indexOf("<script src=\"app.js\">")
    expect(shimIndex).toBe(headOpenEnd)
    expect(authorScriptIndex).toBeGreaterThan(-1)
    expect(shimIndex).toBeLessThan(authorScriptIndex)
  })

  test("un </head> à l'intérieur d'un <script> est ignoré (injection juste après <head>)", () => {
    const full = "<!doctype html><html><head><script>var s = \"</head>\";</script></head><body></body></html>"
    const out = buildSrcdoc(full)
    // Le shim est injecté juste après l'ouverture de <head>, AVANT le script
    // qui contient le faux </head> ; le faux </head> est laissé tel quel
    const headOpenEnd = full.indexOf("<head>") + "<head>".length
    const shimIndex = out.indexOf(STORAGE_SHIM_SCRIPT)
    expect(shimIndex).toBe(headOpenEnd)
    // Le faux </head> à l'intérieur du script est préservé
    expect(out).toContain("var s = \"</head>\";")
  })

  test("storageShim: false retire le script de shim", () => {
    const out = buildSrcdoc("<p>x</p>", { storageShim: false })
    expect(out).not.toContain(STORAGE_PROBE)
    expect(out).not.toContain(STORAGE_SHIM_SCRIPT)
    expect(out).toContain(FOCUS_GUARD_SCRIPT)
  })

  test("focusGuard: false retire le script de focus guard", () => {
    const out = buildSrcdoc("<p>x</p>", { focusGuard: false })
    expect(out).not.toContain(FOCUS_PROBE)
    expect(out).not.toContain(FOCUS_GUARD_SCRIPT)
    expect(out).toContain(STORAGE_SHIM_SCRIPT)
  })

  test("les deux options à false produisent un document sans script d'injection", () => {
    const out = buildSrcdoc("<p>x</p>", { storageShim: false, focusGuard: false })
    expect(out).not.toContain(STORAGE_SHIM_SCRIPT)
    expect(out).not.toContain(FOCUS_GUARD_SCRIPT)
  })

  test("le contenu du fragment est préservé tel quel dans la coquille", () => {
    const out = buildSrcdoc("<div data-x='1'><span>keep me</span></div>")
    expect(out).toContain("<div data-x='1'><span>keep me</span></div>")
  })

  test("baseHref ajoute une balise <base> dans la coquille", () => {
    const out = buildSrcdoc("<p>x</p>", { baseHref: "https://example.test/folder/" })
    expect(out).toContain('<base href="https://example.test/folder/">')
  })

  test("déterminisme : deux appels identiques rendent des chaînes égales", () => {
    const a = buildSrcdoc("<p>x</p>")
    const b = buildSrcdoc("<p>x</p>")
    expect(a).toBe(b)
    const c = buildSrcdoc("<p>x</p>", { storageShim: false })
    const d = buildSrcdoc("<p>x</p>", { storageShim: false })
    expect(c).toBe(d)
  })

  test("editBridge: true injecte le pont d'édition manuelle (Phase 9.2)", () => {
    const out = buildSrcdoc("<p>x</p>", { editBridge: true })
    expect(out).toContain(EDIT_BRIDGE_SCRIPT)
  })

  test("editBridge est absent par défaut", () => {
    const out = buildSrcdoc("<p>x</p>")
    expect(out).not.toContain(EDIT_BRIDGE_SCRIPT)
  })

  test("fallback : insertion juste avant <body> quand il n'y a pas de <head>", () => {
    const full = "<!doctype html><html><body><p>no head</p></body></html>"
    const out = buildSrcdoc(full)
    // Le shim est inséré à la position qu'occupait <body> dans l'entrée
    const inputBodyIndex = full.indexOf("<body>")
    const shimIndex = out.indexOf(STORAGE_SHIM_SCRIPT)
    expect(shimIndex).toBe(inputBodyIndex)
    // Et <body> lui-même est poussé après le shim dans la sortie
    const outputBodyIndex = out.indexOf("<body>")
    expect(outputBodyIndex).toBeGreaterThan(shimIndex)
  })
})
