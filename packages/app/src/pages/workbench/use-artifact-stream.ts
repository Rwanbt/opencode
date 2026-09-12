/* SPDX-License-Identifier: MIT */

import { createSignal, onCleanup } from "solid-js"

/**
 * P15 — Moteur de streaming des artefacts produits par l'agent Design.
 *
 * Le hook branche le parseur P13 sur le flux de l'agent : `artifact:start`
 * ouvre une entrée, `artifact:chunk` accumule le contenu, `artifact:end`
 * marque l'entrée comme complète. Un debounce de 100 ms évite que l'UI
 * soit reconstruite à chaque token d'un flux rapide (sinon l'iframe clignote).
 *
 * Le câblage effectif chat/agent → events sera ajouté quand un agent
 * "design-agent" émettra ces events (hors scope P15). Le présent module
 * fournit le moteur, le contrat de events, et l'API Solid ; les consumers
 * l'invoquent via `controller.push(event)`.
 */

export type ArtifactEvent =
  | { type: "artifact:start"; artifactId: string; filename: string; kind: string; sessionId?: string }
  | { type: "artifact:chunk"; artifactId: string; chunk: string }
  | { type: "artifact:end"; artifactId: string; reason?: "complete" | "aborted" }
  | { type: "artifact:error"; artifactId: string; message: string }

export type StreamedArtifact = {
  artifactId: string
  filename: string
  kind: string
  content: string
  complete: boolean
  error: string | undefined
  updatedAt: number
}

export type StreamState = {
  byId: ReadonlyMap<string, StreamedArtifact>
  /** Identifiant de l'artefact en cours de streaming, ou undefined. */
  activeId: string | undefined
  /** Erreur de connexion (ex: SSE coupé) — distincte d'une erreur par artefact. */
  connectionError: string | undefined
}

export const EMPTY_STREAM_STATE: StreamState = {
  byId: new Map(),
  activeId: undefined,
  connectionError: undefined,
}

function nowMs(): number {
  return Date.now()
}

/**
 * Reducer pur des events de streaming. Extrait en fonction top-level pour
 * rester testable hors contexte Solid ; tous les consumers (incluant le hook
 * ci-dessous) passent par cette fonction.
 *
 * Règles :
 * - `artifact:start` crée une nouvelle entrée avec `content: ""`, l'active,
 *   et efface l'erreur de connexion (le nouveau flux est sain tant qu'il dure).
 * - `artifact:chunk` concatène au contenu de l'entry existante. Si l'id est
 *   inconnu, l'event est ignoré (pas d'event avant start = drop silencieux).
 * - `artifact:end` marque l'entry comme `complete: true`. L'event est ignoré
 *   si l'id est inconnu.
 * - `artifact:error` sur un id connu : pose `error` sur l'entry, garde le
 *   contenu déjà reçu. Sur id inconnu : pose `connectionError` global.
 * - Un `artifact:start` pour un id différent ne touche JAMAIS l'entry d'un
 *   autre id en cours de streaming (chacun a son accumulation).
 */
export function reduceArtifactStream(state: StreamState, event: ArtifactEvent): StreamState {
  if (event.type === "artifact:start") {
    const next = new Map(state.byId)
    next.set(event.artifactId, {
      artifactId: event.artifactId,
      filename: event.filename,
      kind: event.kind,
      content: "",
      complete: false,
      error: undefined,
      updatedAt: nowMs(),
    })
    return { byId: next, activeId: event.artifactId, connectionError: undefined }
  }
  if (event.type === "artifact:chunk") {
    const existing = state.byId.get(event.artifactId)
    if (!existing) return state
    const next = new Map(state.byId)
    next.set(event.artifactId, {
      ...existing,
      content: existing.content + event.chunk,
      updatedAt: nowMs(),
    })
    return { ...state, byId: next }
  }
  if (event.type === "artifact:end") {
    const existing = state.byId.get(event.artifactId)
    if (!existing) return state
    const next = new Map(state.byId)
    next.set(event.artifactId, { ...existing, complete: true, updatedAt: nowMs() })
    return { ...state, byId: next }
  }
  // artifact:error
  const existing = state.byId.get(event.artifactId)
  if (!existing) {
    return { ...state, connectionError: event.message }
  }
  const next = new Map(state.byId)
  next.set(event.artifactId, { ...existing, error: event.message, updatedAt: nowMs() })
  return { ...state, byId: next }
}

/** Pose (ou efface) l'erreur de connexion sans changer les entries. */
export function setStreamConnectionError(state: StreamState, message: string | undefined): StreamState {
  return { ...state, connectionError: message }
}

export const DEFAULT_DEBOUNCE_MS = 100

export type ArtifactStreamController = {
  /** État "vrai" — mis à jour immédiatement à chaque event. */
  state: () => StreamState
  /**
   * État debouncé — ce que l'UI doit observer pour éviter les reconstructions
   * à chaque token. Suit `state` avec un délai de `debounceMs` (100 ms par
   * défaut, cf. spec P15 §« Spécification exacte » alinéa 1).
   */
  renderState: () => StreamState
  /** Pousse un event dans le reducer. Flush immédiat du state vrai, debounce du renderState. */
  push: (event: ArtifactEvent) => void
  /** Pose l'erreur de connexion (ex: SSE coupé). Suit le même debounce. */
  setConnectionError: (message: string | undefined) => void
  /** Remet le controller à zéro (utilisé en cas de reset de session). */
  reset: () => void
}

export function createArtifactStreamController(options: { debounceMs?: number } = {}): ArtifactStreamController {
  const debounceMs = options.debounceMs ?? DEFAULT_DEBOUNCE_MS
  const [state, setState] = createSignal<StreamState>(EMPTY_STREAM_STATE)
  const [renderState, setRenderState] = createSignal<StreamState>(EMPTY_STREAM_STATE)
  let timer: ReturnType<typeof setTimeout> | undefined

  function flushRenderState(): void {
    if (timer) { clearTimeout(timer); timer = undefined }
    setRenderState(state())
  }

  function scheduleRenderFlush(): void {
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => {
      timer = undefined
      setRenderState(state())
    }, debounceMs)
  }

  function push(event: ArtifactEvent): void {
    setState((current) => reduceArtifactStream(current, event))
    scheduleRenderFlush()
  }

  function setConnectionError(message: string | undefined): void {
    setState((current) => setStreamConnectionError(current, message))
    scheduleRenderFlush()
  }

  function reset(): void {
    flushRenderState()
    setState(EMPTY_STREAM_STATE)
  }

  onCleanup(() => { if (timer) clearTimeout(timer) })

  return { state, renderState, push, setConnectionError, reset }
}

/** Helper de commodité : récupère l'entry active (ou undefined). */
export function activeStreamedArtifact(state: StreamState): StreamedArtifact | undefined {
  if (!state.activeId) return undefined
  return state.byId.get(state.activeId)
}
