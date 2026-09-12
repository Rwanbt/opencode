/* SPDX-License-Identifier: MIT */

import { describe, expect, test } from "bun:test"
import { createArtifactParser } from "@unifia/artifact-render"
import type { ArtifactEvent as RenderArtifactEvent } from "@unifia/artifact-render"
import { EMPTY_STREAM_STATE, reduceArtifactStream, type ArtifactEvent as StreamArtifactEvent } from "@/pages/workbench/use-artifact-stream"
import { adaptRenderArtifactEvent, adaptRenderArtifactEvents } from "@/pages/workbench/artifact-event-adapter"

describe("adaptRenderArtifactEvent", () => {
  test("droppe un event 'text' (rendu dans le fil, pas dans le moteur de streaming)", () => {
    const event: RenderArtifactEvent = { type: "text", delta: "Bonjour le monde" }
    expect(adaptRenderArtifactEvent(event)).toBeNull()
  })

  test("convertit un 'artifact:start' en gardant identifier/title/type, et pose sessionId='adapter'", () => {
    const event: RenderArtifactEvent = {
      type: "artifact:start",
      identifier: "a-1",
      artifactType: "html",
      title: "landing.html",
    }
    const adapted = adaptRenderArtifactEvent(event)
    expect(adapted).toEqual({
      type: "artifact:start",
      artifactId: "a-1",
      filename: "landing.html",
      kind: "html",
      sessionId: "adapter",
    })
  })

  test("convertit un 'artifact:chunk' en mappant identifier et delta", () => {
    const event: RenderArtifactEvent = { type: "artifact:chunk", identifier: "a-1", delta: "<h1>Hi</h1>" }
    const adapted = adaptRenderArtifactEvent(event)
    expect(adapted).toEqual({
      type: "artifact:chunk",
      artifactId: "a-1",
      chunk: "<h1>Hi</h1>",
    })
  })

  test("convertit un 'artifact:end' en posant reason='complete' (fullContent n'est pas transmis)", () => {
    const event: RenderArtifactEvent = { type: "artifact:end", identifier: "a-1", fullContent: "<h1>Hi</h1>" }
    const adapted = adaptRenderArtifactEvent(event)
    expect(adapted).toEqual({
      type: "artifact:end",
      artifactId: "a-1",
      reason: "complete",
    })
  })

  test("ne mute jamais l'event d'entrée (les deux types restent indépendants)", () => {
    const event: RenderArtifactEvent = { type: "artifact:chunk", identifier: "a-1", delta: "x" }
    adaptRenderArtifactEvent(event)
    expect(event).toEqual({ type: "artifact:chunk", identifier: "a-1", delta: "x" })
  })

  test("la forme adaptée satisfait le type StreamArtifactEvent (régression de typage couverte par la compilation)", () => {
    // Ce test existe pour rendre la garantie de typage lisible au prochain
    // lecteur. La vraie vérification est `tsgo --noEmit` (porte de phase 4).
    const start: RenderArtifactEvent = { type: "artifact:start", identifier: "x", artifactType: "html", title: "x.html" }
    const adapted = adaptRenderArtifactEvent(start) as StreamArtifactEvent
    expect(adapted.type).toBe("artifact:start")
  })
})

describe("adaptRenderArtifactEvents (lot)", () => {
  test("applique l'adaptateur à un iterable et ne conserve que les events non-null", () => {
    const events: RenderArtifactEvent[] = [
      { type: "text", delta: "Avant" },
      { type: "artifact:start", identifier: "a-1", artifactType: "html", title: "a-1.html" },
      { type: "artifact:chunk", identifier: "a-1", delta: "<p>Bonjour</p>" },
      { type: "text", delta: "Après" },
      { type: "artifact:end", identifier: "a-1", fullContent: "<p>Bonjour</p>" },
    ]
    const adapted = adaptRenderArtifactEvents(events)
    expect(adapted.map((e) => e.type)).toEqual([
      "artifact:start",
      "artifact:chunk",
      "artifact:end",
    ])
  })

  test("l'itérable d'entrée peut être un Generator (cas d'usage: parser artifact-render)", () => {
    function* gen(): Generator<RenderArtifactEvent> {
      yield { type: "text", delta: "Avant" }
      yield { type: "artifact:start", identifier: "a-1", artifactType: "html", title: "a-1.html" }
      yield { type: "artifact:chunk", identifier: "a-1", delta: "<p>X</p>" }
      yield { type: "artifact:end", identifier: "a-1", fullContent: "<p>X</p>" }
    }
    const adapted = adaptRenderArtifactEvents(gen())
    expect(adapted).toHaveLength(3)
    expect(adapted[0]).toMatchObject({ type: "artifact:start", artifactId: "a-1" })
    expect(adapted[1]).toMatchObject({ type: "artifact:chunk", chunk: "<p>X</p>" })
    expect(adapted[2]).toMatchObject({ type: "artifact:end", reason: "complete" })
  })

  test("un lot vide retourne un tableau vide (pas d'exception)", () => {
    expect(adaptRenderArtifactEvents([])).toEqual([])
  })
})

/**
 * Test d'intégration : on prend la sortie de `createArtifactParser` (le
 * parseur des balises `<artifact>` dans le flux markdown d'un agent), on
 * l'adapte via `adaptRenderArtifactEvents`, puis on réduit via
 * `reduceArtifactStream`. L'état final doit contenir l'artefact complet.
 *
 * C'est la chaîne que l'agent "design-agent" utilisera une fois branché.
 * Avant la phase 4, la chaîne n'existait pas : seul `pushDemoStream`
 * injectait des events à la main dans la forme du consommateur.
 */
describe("adaptRenderArtifactEvents → reduceArtifactStream (intégration)", () => {
  test("un flux markdown complet (start, chunks, end) devient une entry complète dans le state", () => {
    const parser = createArtifactParser()
    const generator = parser.feed(
      '<artifact identifier="a-1" type="html" title="a-1.html"><h1>Bonjour</h1></artifact>',
    )
    const renderEvents: RenderArtifactEvent[] = Array.from(generator)
    // Aussi drainer le flush au cas où.
    for (const event of parser.flush()) renderEvents.push(event)

    const streamEvents: StreamArtifactEvent[] = adaptRenderArtifactEvents(renderEvents)
    // Vérifier qu'on a au moins un start, des chunks, et un end.
    expect(streamEvents.some((e) => e.type === "artifact:start")).toBe(true)
    expect(streamEvents.some((e) => e.type === "artifact:chunk")).toBe(true)
    expect(streamEvents.some((e) => e.type === "artifact:end")).toBe(true)

    // Réduire : on doit obtenir un artefact complet dans le state.
    const finalState = streamEvents.reduce(reduceArtifactStream, EMPTY_STREAM_STATE)
    const entry = finalState.byId.get("a-1")
    expect(entry).toBeDefined()
    expect(entry?.complete).toBe(true)
    expect(entry?.content).toBe("<h1>Bonjour</h1>")
    expect(entry?.filename).toBe("a-1.html")
    expect(entry?.kind).toBe("html")
  })

  test("le texte autour des balises <artifact> est droppé (rendu dans le fil, pas dans le moteur de streaming)", () => {
    const parser = createArtifactParser()
    const generator = parser.feed(
      "Texte avant\n<artifact identifier=\"a-1\" type=\"text\" title=\"a.txt\">hi</artifact>\nTexte après",
    )
    const renderEvents: RenderArtifactEvent[] = Array.from(generator)
    for (const event of parser.flush()) renderEvents.push(event)

    // Au moins un event de type "text" doit être présent dans le flux
    // source — c'est ce que l'agent émet quand il parle autour d'un
    // artefact. L'adaptateur le droppe ; le state final ne contient
    // que l'artefact.
    expect(renderEvents.some((e) => e.type === "text")).toBe(true)

    const streamEvents = adaptRenderArtifactEvents(renderEvents)
    // Le state final ne contient que l'artefact, pas de texte.
    const finalState = streamEvents.reduce(reduceArtifactStream, EMPTY_STREAM_STATE)
    expect(finalState.byId.size).toBe(1)
    expect(finalState.byId.get("a-1")?.content).toBe("hi")
  })
})
