/* SPDX-License-Identifier: MIT */

/**
 * P16 — Viewports pour la barre d'outils Design.
 *
 * Le rendu se fait à largeur réelle du viewport cible (1440 / 768 / 390)
 * puis mis à l'échelle par `transform: scale()` quand la zone disponible
 * est plus petite. `fitScale` ne dépasse JAMAIS 1 — on ne grossit pas un
 * petit viewport pour "remplir" la zone, ça dégraderait la lisibilité.
 *
 * Le zoom utilisateur (50/75/100/125/150/200) est appliqué APRÈS fitScale,
 * via la multiplication dans le consumer (toolbar ou preview).
 */

export type ViewportId = "desktop" | "tablet" | "mobile"

export type ViewportPreset = {
  readonly id: ViewportId
  readonly width: number
  readonly height: number
  readonly label: string
}

export const VIEWPORT_PRESETS: readonly ViewportPreset[] = [
  { id: "desktop", width: 1440, height: 900, label: "Desktop · 1440×900" },
  { id: "tablet", width: 768, height: 1024, label: "Tablet · 768×1024" },
  { id: "mobile", width: 390, height: 844, label: "Mobile · 390×844" },
]

export const VIEWPORT_IDS: readonly ViewportId[] = VIEWPORT_PRESETS.map((v) => v.id)

export const ZOOM_PRESETS: readonly number[] = [50, 75, 100, 125, 150, 200]

export const DEFAULT_VIEWPORT: ViewportId = "desktop"
export const DEFAULT_ZOOM = 100

export function findViewport(id: ViewportId): ViewportPreset {
  // VIEWPORT_PRESETS est statique et contient toujours les 3 ids ; on évite
  // le throw ici en fallback sur desktop (sécurise les futurs ajouts).
  return VIEWPORT_PRESETS.find((v) => v.id === id) ?? (VIEWPORT_PRESETS[0] as ViewportPreset)
}

/**
 * Échelle à appliquer pour qu'un viewport tienne dans la zone disponible.
 * Plafonnée à 1 : on ne grossit jamais un viewport (sinon un mobile sur
 * un grand écran devient flou/démesuré). Retourne `Infinity` si l'argument
 * est invalide (canvas ≤ 0) — c'est故意的 pour détecter un consumer bug
 * en dev (un canvas de 0 ne devrait jamais arriver en pratique).
 */
export function fitScale(viewport: ViewportId, canvasWidth: number, canvasHeight: number): number {
  if (!Number.isFinite(canvasWidth) || !Number.isFinite(canvasHeight)) return 1
  if (canvasWidth <= 0 || canvasHeight <= 0) return 1
  const preset = findViewport(viewport)
  const scaleW = canvasWidth / preset.width
  const scaleH = canvasHeight / preset.height
  return Math.min(1, scaleW, scaleH)
}

/**
 * Échelle effective : fitScale plafonné × zoom utilisateur.
 * `zoom` est en pourcentage (50 = 0.5). On l'accepte en % et on le divise.
 * Retourne un nombre ≥ 0 (pas de plafond ici — le consumer peut clamp
 * différemment selon l'UX voulue).
 */
export function effectiveScale(viewport: ViewportId, canvasWidth: number, canvasHeight: number, zoomPercent: number): number {
  const fit = fitScale(viewport, canvasWidth, canvasHeight)
  const zoom = Number.isFinite(zoomPercent) && zoomPercent > 0 ? zoomPercent / 100 : 1
  return fit * zoom
}
