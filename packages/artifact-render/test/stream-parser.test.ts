/* SPDX-License-Identifier: MIT */

import { describe, expect, test } from "bun:test"
import { createArtifactParser, type ArtifactEvent } from "../src/stream-parser"

function collect(gen: Generator<ArtifactEvent>): ArtifactEvent[] {
  const out: ArtifactEvent[] = []
  for (const e of gen) out.push(e)
  return out
}

describe("createArtifactParser", () => {
  test("cas 1 : balise ouvrante coupée entre deux feed() n'émet aucun text sur le fragment", () => {
    const p = createArtifactParser()
    const a = collect(p.feed("<arti"))
    // Pas de tag complet, pas d'artefact ; le hold-back doit retenir `<arti` jusqu'à la suite.
    expect(a).toEqual([])
    const b = collect(p.feed('fact identifier="a1" type="html" title="T">hello'))
    expect(b.some((e) => e.type === "text" && e.delta.includes("<arti"))).toBe(false)
    expect(b.find((e) => e.type === "artifact:start")).toEqual({
      type: "artifact:start",
      identifier: "a1",
      artifactType: "html",
      title: "T",
    })
  })

  test("cas 2 : balise fermante coupée est retenue, émet chunk partiel jusqu'au flush", () => {
    const p = createArtifactParser()
    collect(p.feed('<artifact identifier="a2" type="html" title="T">abcde'))
    // La balise fermante n'est pas encore arrivée. Un feed supplémentaire
    // contenant les premiers 9 chars de `</artifact>` ne doit pas émettre
    // de chunk qui les chevauche.
    const c = collect(p.feed("fghi</artif"))
    const allChunks = c.filter((e) => e.type === "artifact:chunk")
    for (const ev of allChunks) {
      if (ev.type === "artifact:chunk") {
        expect(ev.delta.includes("</artif")).toBe(false)
      }
    }
    // Complete the close tag.
    const d = collect(p.feed("act>"))
    expect(d.find((e) => e.type === "artifact:end")).toEqual({
      type: "artifact:end",
      identifier: "a2",
      fullContent: "abcdefghi",
    })
  })

  test("cas 3 : balise <artifact> à l'intérieur d'une fence markdown n'est pas reconnue", () => {
    const p = createArtifactParser()
    const events = collect(
      p.feed(
        'avant\n```html\n<artifact identifier="x" type="html" title="T">body</artifact>\n```\naprès',
      ),
    )
    // Aucune emission d'artefact — toute la fence est du texte.
    expect(events.some((e) => e.type === "artifact:start")).toBe(false)
    expect(events.some((e) => e.type === "artifact:end")).toBe(false)
    // Le texte englobant est présent.
    const text = events
      .filter((e) => e.type === "text")
      .map((e) => (e.type === "text" ? e.delta : ""))
      .join("")
    expect(text).toContain("avant")
    expect(text).toContain("après")
    expect(text).toContain("<artifact")
    expect(text).toContain("</artifact>")
  })

  test("cas 4 : fence ouverte sans fermeture à la fin du flux reste du texte", () => {
    const p = createArtifactParser()
    const events = collect(p.feed('début\n```html\n<artifact identifier="x" type="html" title="T">body'))
    expect(events.some((e) => e.type === "artifact:start")).toBe(false)
    expect(events.some((e) => e.type === "artifact:end")).toBe(false)
    // Puis un flush termine le flux sans rien créer d'artifact.
    const flushed = collect(p.flush())
    expect(flushed.some((e) => e.type === "artifact:start")).toBe(false)
  })

  test("cas 5 : un backtick simple non apparié en fin de tampon retient le flush", () => {
    const p = createArtifactParser()
    const a = collect(p.feed("hello `wor"))
    // Le backtick final peut encore démarrer un inline code span. Le
    // parseur retient le texte jusqu'à la décision finale.
    const emittedText = a
      .filter((e) => e.type === "text")
      .map((e) => (e.type === "text" ? e.delta : ""))
      .join("")
    expect(emittedText).not.toBe("hello `wor")
    // Un second feed ferme l'inline code span. Pas d'artefact.
    const b = collect(p.feed("d`"))
    expect(b.some((e) => e.type === "artifact:start")).toBe(false)
  })

  test("cas 6 : <artifactual> n'est pas une balise <artifact>", () => {
    const p = createArtifactParser()
    const events = collect(p.feed("du texte <artifactual>blabla</artifactual> plus"))
    expect(events.some((e) => e.type === "artifact:start")).toBe(false)
    expect(events.some((e) => e.type === "artifact:end")).toBe(false)
    const text = events
      .filter((e) => e.type === "text")
      .map((e) => (e.type === "text" ? e.delta : ""))
      .join("")
    expect(text).toContain("<artifactual>")
  })

  test("cas 7 : flush() sur un artefact non terminé émet artifact:end avec contenu partiel", () => {
    const p = createArtifactParser()
    collect(p.feed('<artifact identifier="a7" type="html" title="T">partiel'))
    const flushed = collect(p.flush())
    const end = flushed.find((e) => e.type === "artifact:end")
    expect(end).toEqual({
      type: "artifact:end",
      identifier: "a7",
      fullContent: "partiel",
    })
  })

  test("cas 8 : deux artefacts successifs sont émis dans l'ordre, sans fuite", () => {
    const p = createArtifactParser()
    const events = collect(
      p.feed(
        'intro\n<artifact identifier="a" type="html" title="A">aaa</artifact>\nlien\n<artifact identifier="b" type="html" title="B">bbb</artifact>\nfin',
      ),
    )
    const starts = events.filter((e) => e.type === "artifact:start")
    const ends = events.filter((e) => e.type === "artifact:end")
    expect(starts).toHaveLength(2)
    expect(ends).toHaveLength(2)
    expect((starts[0] as { identifier: string }).identifier).toBe("a")
    expect((starts[1] as { identifier: string }).identifier).toBe("b")
    expect((ends[0] as { fullContent: string }).fullContent).toBe("aaa")
    expect((ends[1] as { fullContent: string }).fullContent).toBe("bbb")
  })
})
