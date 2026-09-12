/* SPDX-License-Identifier: MIT */

/**
 * Phase 9.1 — modèle pur du dessin libre ("annoter/marquer") par-dessus
 * l'aperçu d'artefact. Un trait est une polyligne de points en
 * coordonnées locales à l'iframe (mêmes unités que `CommentTargetRect`,
 * P18/8.1) — c'est ce qui permet à l'overlay de dessin d'hériter la mise
 * à l'échelle CSS du wrapper transformé au lieu de recalculer les
 * positions au resize, exactement comme les épingles de commentaire.
 *
 * Module pur sur le modèle exact de `design-comments.ts` : toutes les
 * fonctions prennent un `AnnotationState` et en retournent un nouveau,
 * aucune dépendance DOM/canvas.
 */

export type AnnotationPoint = { x: number; y: number }

export type AnnotationStroke = {
  id: string
  points: readonly AnnotationPoint[]
}

export type AnnotationState = { strokes: readonly AnnotationStroke[] }

export const EMPTY_ANNOTATION_STATE: AnnotationState = { strokes: [] }

/** Un trait dégénéré (0 point — un pointerdown suivi immédiatement d'un pointerup sans mouvement) n'ajoute rien. */
export function addStroke(state: AnnotationState, stroke: AnnotationStroke): AnnotationState {
  if (stroke.points.length === 0) return state
  return { strokes: [...state.strokes, stroke] }
}

export function clearStrokes(state: AnnotationState): AnnotationState {
  if (state.strokes.length === 0) return state
  return EMPTY_ANNOTATION_STATE
}

/** Retire le dernier trait ajouté (Ctrl+Z du crayon, pas d'historique au-delà d'un niveau). */
export function undoStroke(state: AnnotationState): AnnotationState {
  if (state.strokes.length === 0) return state
  return { strokes: state.strokes.slice(0, -1) }
}

/** Même schéma que `newCommentId` (design-comments.ts) : préfixe reconnu + horodatage/aléa en base36. */
export function newStrokeId(now: number = Date.now(), rand: number = Math.random()): string {
  const ts = now.toString(36)
  const r = Math.floor(rand * 1e9).toString(36)
  return `s-${ts}-${r}`
}
