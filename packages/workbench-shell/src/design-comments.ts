/* SPDX-License-Identifier: MIT */

/**
 * P19 — Modèle pur des commentaires Design.
 *
 * Un commentaire est une note attachée à un élément identifié par son
 * `data-unifia-id` (cf. P18). Trois statuts :
 * - "open"     : créé mais pas encore envoyé à l'agent (P20 s'en chargera)
 * - "sent"     : envoyé à l'agent ; immuable (P20)
 * - "resolved" : l'agent a appliqué la modif ; conservé pour traçabilité
 *
 * Le module est PUR : toutes les fonctions prennent un `CommentState`
 * et en retournent un nouveau. Aucune dépendance DOM, aucune I/O. La
 * persistance (P19 §"Persistance") est déléguée à un store IndexedDB
 * câblé en aval (cf. design-draft.ts pour le pattern).
 *
 * Règles (testées dans design-comments.test.ts) :
 * - `addComment` : ajoute sans mutation ; refuse un doublon d'id
 * - `updateComment` : refuse si status === "sent" (immutable post-envoi)
 * - `removeComment` : retire, ordre préservé
 * - `commentsForElement` : filtre par elementId, ordre stable (createdAt, id)
 * - `openComments` : filtre par status === "open", ordre stable
 */

export type CommentStatus = "open" | "sent" | "resolved"

/** Rect de l'élément ciblé au moment du pick, en coordonnées locales à l'iframe (mêmes unités que `PreviewRect`, P18). */
export type CommentTargetRect = { x: number; y: number; width: number; height: number }

export type DesignComment = {
  id: string
  artifactId: string
  elementId: string
  note: string
  status: CommentStatus
  /** ISO 8601 (createdAt sert de tie-breaker pour l'ordre stable). */
  createdAt: string
  /**
   * P19+ (Phase 8.1) — capturé au pick, pas re-dérivé. `undefined` pour un
   * commentaire créé avant cette phase, ou si le pick n'a exceptionnellement
   * pas fourni de rect : l'épingle correspondante ne s'affiche simplement
   * pas (dégradation silencieuse, pas une erreur).
   */
  rect?: CommentTargetRect
}

export type CommentState = {
  comments: readonly DesignComment[]
}

export const EMPTY_COMMENT_STATE: CommentState = { comments: [] }

/**
 * Compare deux commentaires par (createdAt, id) — utilisé partout
 * où on doit garantir un ordre stable.
 */
function compareComments(a: DesignComment, b: DesignComment): number {
  if (a.createdAt < b.createdAt) return -1
  if (a.createdAt > b.createdAt) return 1
  if (a.id < b.id) return -1
  if (a.id > b.id) return 1
  return 0
}

/**
 * Ajoute un commentaire à la fin du tableau (l'ordre est ensuite
 * stabilisé par sortByStable). Si un commentaire avec le même `id`
 * existe déjà, retourne l'état inchangé — la collision d'id est
 * une erreur du caller, pas un cas à masquer.
 */
export function addComment(state: CommentState, comment: DesignComment): CommentState {
  if (state.comments.some((c) => c.id === comment.id)) return state
  return { comments: sortByStable([...state.comments, comment]) }
}

/**
 * Met à jour la note d'un commentaire. Refuse si le commentaire est
 * en `sent` (immutable après envoi) ou s'il n'existe pas — retourne
 * l'état inchangé dans les deux cas.
 */
export function updateComment(state: CommentState, id: string, note: string): CommentState {
  const target = state.comments.find((c) => c.id === id)
  if (!target) return state
  if (target.status === "sent") return state
  const next = state.comments.map((c) => (c.id === id ? { ...c, note } : c))
  return { comments: sortByStable(next) }
}

/**
 * Retire un commentaire. Si l'id n'existe pas, retourne l'état inchangé.
 */
export function removeComment(state: CommentState, id: string): CommentState {
  if (!state.comments.some((c) => c.id === id)) return state
  return { comments: state.comments.filter((c) => c.id !== id) }
}

/**
 * Liste les commentaires d'un élément, dans l'ordre (createdAt, id).
 */
export function commentsForElement(state: CommentState, elementId: string): readonly DesignComment[] {
  return sortByStable(state.comments.filter((c) => c.elementId === elementId))
}

/**
 * Liste les commentaires encore "open" (pas envoyés, pas résolus),
 * dans l'ordre (createdAt, id).
 */
export function openComments(state: CommentState): readonly DesignComment[] {
  return sortByStable(state.comments.filter((c) => c.status === "open"))
}

/**
 * Marque un commentaire comme "sent" (transition open → sent).
 * Refuse si l'id n'existe pas, ou si le statut n'est pas "open".
 * Une fois `sent`, le commentaire est immutable.
 */
export function markSent(state: CommentState, id: string): CommentState {
  const target = state.comments.find((c) => c.id === id)
  if (!target) return state
  if (target.status !== "open") return state
  const next = state.comments.map((c) => (c.id === id ? { ...c, status: "sent" as CommentStatus } : c))
  return { comments: next }
}

/**
 * Marque un commentaire "resolved" — utilisé par P20 quand l'agent a
 * confirmé l'application de la modification.
 */
export function markResolved(state: CommentState, id: string): CommentState {
  const target = state.comments.find((c) => c.id === id)
  if (!target) return state
  if (target.status === "sent") return state
  const next = state.comments.map((c) => (c.id === id ? { ...c, status: "resolved" as CommentStatus } : c))
  return { comments: next }
}

function sortByStable(comments: readonly DesignComment[]): DesignComment[] {
  return [...comments].sort(compareComments)
}

/**
 * Génère un id unique pour un commentaire. Tiré de crypto.randomUUID()
 * quand dispo (modern browsers, Bun), fallback sur timestamp+random
 * sinon. Pure : pas d'I/O, deterministic pour un même univers.
 */
export function newCommentId(now: number = Date.now(), rand: number = Math.random()): string {
  const ts = now.toString(36)
  const r = Math.floor(rand * 1e9).toString(36)
  return `c-${ts}-${r}`
}

/**
 * Phase 8.1 — centre d'un rect, en coordonnées locales à l'iframe. C'est
 * la position d'épingle : le pin overlay la rend comme enfant du wrapper
 * déjà mis à l'échelle par `ArtifactPreview` (`transform: scale(...)`),
 * donc la conversion vers des pixels écran est déléguée au CSS — cette
 * fonction n'a besoin de rien connaître de `scale()` ou du redimensionnement
 * de la fenêtre pour rester correcte après l'un ou l'autre.
 */
export function pinCenter(rect: CommentTargetRect): { x: number; y: number } {
  return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 }
}

/** Épingles pour les commentaires ouverts qui portent un rect — un commentaire créé avant cette phase (ou sans rect pour une autre raison) n'en a simplement pas. */
export function commentPins(state: CommentState): readonly { id: string; rect: CommentTargetRect }[] {
  return openComments(state)
    .filter((comment): comment is DesignComment & { rect: CommentTargetRect } => comment.rect !== undefined)
    .map((comment) => ({ id: comment.id, rect: comment.rect }))
}
