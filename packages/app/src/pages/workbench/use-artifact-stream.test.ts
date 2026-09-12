/* SPDX-License-Identifier: MIT */

import { describe, expect, test } from "bun:test"
import {
  EMPTY_STREAM_STATE,
  reduceArtifactStream,
  setStreamConnectionError,
  activeStreamedArtifact,
  type StreamState,
  type ArtifactEvent,
} from "@/pages/workbench/use-artifact-stream"

function start(id: string, filename = "artifact.html", kind = "html", sessionId = "sess-1"): ArtifactEvent {
  return { type: "artifact:start", artifactId: id, filename, kind, sessionId }
}
function chunk(id: string, text: string): ArtifactEvent {
  return { type: "artifact:chunk", artifactId: id, chunk: text }
}
function end(id: string, reason: "complete" | "aborted" = "complete"): ArtifactEvent {
  return { type: "artifact:end", artifactId: id, reason }
}
function error(id: string, message: string): ArtifactEvent {
  return { type: "artifact:error", artifactId: id, message }
}

function reduceAll(events: readonly ArtifactEvent[], state: StreamState = EMPTY_STREAM_STATE): StreamState {
  return events.reduce((s, e) => reduceArtifactStream(s, e), state)
}

describe("reduceArtifactStream — start", () => {
  test("artifact:start crée une entry vide et l'active", () => {
    const next = reduceArtifactStream(EMPTY_STREAM_STATE, start("a-1"))
    expect(next.byId.size).toBe(1)
    const entry = next.byId.get("a-1")
    expect(entry).toBeDefined()
    expect(entry?.content).toBe("")
    expect(entry?.complete).toBe(false)
    expect(entry?.error).toBeUndefined()
    expect(entry?.filename).toBe("artifact.html")
    expect(entry?.kind).toBe("html")
    expect(next.activeId).toBe("a-1")
    expect(next.connectionError).toBeUndefined()
  })

  test("artifact:start efface une connectionError préalable", () => {
    const broken: StreamState = { ...EMPTY_STREAM_STATE, connectionError: "SSE coupé" }
    const next = reduceArtifactStream(broken, start("a-2"))
    expect(next.connectionError).toBeUndefined()
  })

  test("artifact:start sur un id existant reset content mais préserve les autres", () => {
    const populated = reduceAll([
      start("a-3"),
      chunk("a-3", "hello"),
      chunk("a-3", " world"),
    ], EMPTY_STREAM_STATE)
    const next = reduceArtifactStream(populated, start("a-3", "renamed.html", "html"))
    expect(next.byId.get("a-3")?.content).toBe("")
    expect(next.byId.get("a-3")?.filename).toBe("renamed.html")
    expect(next.activeId).toBe("a-3")
  })
})

describe("reduceArtifactStream — chunks", () => {
  test("trois chunks successifs produisent un contenu concaténé", () => {
    const next = reduceAll([
      start("c-1"),
      chunk("c-1", "<h1>"),
      chunk("c-1", "Hello "),
      chunk("c-1", "world</h1>"),
    ])
    expect(next.byId.get("c-1")?.content).toBe("<h1>Hello world</h1>")
    expect(next.byId.get("c-1")?.complete).toBe(false)
  })

  test("un chunk pour un id inconnu est ignoré silencieusement", () => {
    const next = reduceArtifactStream(EMPTY_STREAM_STATE, chunk("unknown", "boom"))
    expect(next.byId.size).toBe(0)
    expect(next.activeId).toBeUndefined()
  })

  test("l'updatedAt avance à chaque chunk", () => {
    const a = reduceArtifactStream(EMPTY_STREAM_STATE, start("c-2"))
    const b = reduceArtifactStream(a, chunk("c-2", "x"))
    const c = reduceArtifactStream(b, chunk("c-2", "y"))
    expect((b.byId.get("c-2")?.updatedAt ?? 0) >= (a.byId.get("c-2")?.updatedAt ?? 0)).toBe(true)
    expect((c.byId.get("c-2")?.updatedAt ?? 0) >= (b.byId.get("c-2")?.updatedAt ?? 0)).toBe(true)
  })
})

describe("reduceArtifactStream — end", () => {
  test("artifact:end marque complete: true et préserve le contenu", () => {
    const next = reduceAll([
      start("e-1"),
      chunk("e-1", "<p>x</p>"),
      end("e-1"),
    ])
    expect(next.byId.get("e-1")?.complete).toBe(true)
    expect(next.byId.get("e-1")?.content).toBe("<p>x</p>")
  })

  test("artifact:end sur id inconnu est ignoré", () => {
    const next = reduceArtifactStream(EMPTY_STREAM_STATE, end("unknown"))
    expect(next.byId.size).toBe(0)
    expect(next.activeId).toBeUndefined()
  })

  test("artifact:end avec reason 'aborted' marque quand même complete: true (le consumer inspecte le reason)", () => {
    const next = reduceAll([
      start("e-2"),
      chunk("e-2", "incomplet"),
      end("e-2", "aborted"),
    ])
    expect(next.byId.get("e-2")?.complete).toBe(true)
  })
})

describe("reduceArtifactStream — isolation entre ids", () => {
  test("un artifact:start d'un autre id n'écrase pas le précédent", () => {
    const after = reduceAll([
      start("a", "a.html"),
      chunk("a", "<p>A</p>"),
      start("b", "b.html"),
      chunk("b", "<p>B</p>"),
    ])
    // Les deux entries coexistent
    expect(after.byId.size).toBe(2)
    expect(after.byId.get("a")?.content).toBe("<p>A</p>")
    expect(after.byId.get("b")?.content).toBe("<p>B</p>")
    // b est actif (dérnier start)
    expect(after.activeId).toBe("b")
    // On peut continuer à chunk a sans casser b
    const more = reduceArtifactStream(after, chunk("a", " plus"))
    expect(more.byId.get("a")?.content).toBe("<p>A</p> plus")
    expect(more.byId.get("b")?.content).toBe("<p>B</p>")
    expect(more.activeId).toBe("b")
  })

  test("finir 'a' ne touche pas 'b' (chacun a son cycle de vie)", () => {
    const after = reduceAll([
      start("a", "a.html"),
      chunk("a", "AAA"),
      start("b", "b.html"),
      chunk("b", "BBB"),
      end("a"),
    ])
    expect(after.byId.get("a")?.complete).toBe(true)
    expect(after.byId.get("b")?.complete).toBe(false)
  })
})

describe("reduceArtifactStream — errors", () => {
  test("artifact:error sur id connu pose l'error et préserve le contenu", () => {
    const after = reduceAll([
      start("er-1"),
      chunk("er-1", "incomplet…"),
      error("er-1", "stream coupé"),
    ])
    expect(after.byId.get("er-1")?.error).toBe("stream coupé")
    expect(after.byId.get("er-1")?.content).toBe("incomplet…")
  })

  test("artifact:error sur id inconnu pose connectionError global", () => {
    const after = reduceArtifactStream(EMPTY_STREAM_STATE, error("ghost", "agent mort"))
    expect(after.connectionError).toBe("agent mort")
    expect(after.byId.size).toBe(0)
  })
})

describe("setStreamConnectionError", () => {
  test("pose l'erreur de connexion", () => {
    const next = setStreamConnectionError(EMPTY_STREAM_STATE, "SSE down")
    expect(next.connectionError).toBe("SSE down")
  })

  test("undefined efface l'erreur", () => {
    const broken: StreamState = { ...EMPTY_STREAM_STATE, connectionError: "old" }
    expect(setStreamConnectionError(broken, undefined).connectionError).toBeUndefined()
  })
})

describe("activeStreamedArtifact", () => {
  test("retourne l'entry active", () => {
    const state = reduceAll([start("x"), chunk("x", "hello")])
    const active = activeStreamedArtifact(state)
    expect(active?.artifactId).toBe("x")
    expect(active?.content).toBe("hello")
  })

  test("retourne undefined si pas d'activeId", () => {
    expect(activeStreamedArtifact(EMPTY_STREAM_STATE)).toBeUndefined()
  })

  test("retourne undefined si l'activeId pointe sur un id absent du byId", () => {
    const state: StreamState = { byId: new Map(), activeId: "ghost", connectionError: undefined }
    expect(activeStreamedArtifact(state)).toBeUndefined()
  })
})

describe("reduceArtifactStream — immutabilité", () => {
  test("ne mute pas l'état d'entrée", () => {
    const before = reduceAll([start("im-1"), chunk("im-1", "x")])
    const snapshotById = new Map(before.byId)
    const snapshotActive = before.activeId
    const after = reduceArtifactStream(before, chunk("im-1", "y"))
    expect(before.byId).toEqual(snapshotById)
    expect(before.activeId).toBe(snapshotActive)
    expect(after.byId.get("im-1")?.content).toBe("xy")
  })
})
