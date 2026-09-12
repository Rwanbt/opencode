/* SPDX-License-Identifier: MIT */

import { createEffect, type JSX } from "solid-js"
import { newStrokeId, type AnnotationPoint, type AnnotationStroke } from "@unifia/workbench-shell"

/**
 * Phase 9.1 — dessin libre par-dessus l'aperçu d'artefact.
 *
 * Rendu par `ArtifactPreview` comme enfant de `data-design-preview-frame`
 * (le wrapper déjà mis à l'échelle par `transform: scale(...)`), même
 * position que la couche d'épingles (8.1) et pour la même raison : le
 * canvas a pour attributs `width`/`height` (résolution de dessin) les
 * dimensions du preset de viewport — mêmes unités que `AnnotationPoint` —
 * donc `event.offsetX`/`offsetY` d'un pointer event sur ce canvas
 * retombent déjà dans ce même repère local à l'iframe (le navigateur
 * fait remonter la position visuelle à travers la chaîne de transform
 * CSS pour calculer les coordonnées locales à la cible). Un
 * redimensionnement de fenêtre ne change que `scale()` côté CSS ; ni les
 * points déjà tracés ni la logique de capture n'ont besoin d'en savoir
 * quoi que ce soit.
 *
 * `pointer-events` bascule entre `none` (mode inactif — le canvas est
 * invisible à la souris, les épingles et l'iframe en dessous restent
 * cliquables) et `auto` (outil armé). `currentColor` (posé via la classe
 * `text-primary`) évite toute couleur littérale dans le trait — le
 * garde `check-workbench-color-literals.mjs` interdit les hex/rgb/classes
 * Tailwind de couleur dans `pages/workbench/`, et Canvas 2D résout
 * `currentColor` contre le style calculé de l'élément.
 */

const STROKE_WIDTH = 3

function paintStroke(ctx: CanvasRenderingContext2D, points: readonly AnnotationPoint[]): void {
  const [first, ...rest] = points
  if (!first) return
  ctx.beginPath()
  ctx.moveTo(first.x, first.y)
  for (const point of rest) ctx.lineTo(point.x, point.y)
  ctx.stroke()
}

export function AnnotationOverlay(props: {
  active: boolean
  width: number
  height: number
  strokes: readonly AnnotationStroke[]
  onStrokeComplete: (stroke: AnnotationStroke) => void
}): JSX.Element {
  let canvas: HTMLCanvasElement | undefined
  // Not a signal on purpose: a Solid store update per pointermove for a
  // fast drag would fire far more fine-grained reactivity than needed.
  // `redrawTick` below is the single reactive trigger for "please repaint",
  // bumped once per pointer event instead.
  let liveStroke: AnnotationPoint[] = []

  function redraw(): void {
    const ctx = canvas?.getContext("2d")
    if (!ctx || !canvas) return
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    ctx.lineCap = "round"
    ctx.lineJoin = "round"
    ctx.lineWidth = STROKE_WIDTH
    ctx.strokeStyle = "currentColor"
    for (const stroke of props.strokes) paintStroke(ctx, stroke.points)
    if (liveStroke.length > 0) paintStroke(ctx, liveStroke)
  }

  createEffect(() => {
    // Tracked deps: a new artifact (size change) or a persisted stroke
    // list change must repaint. `liveStroke` mutations are pushed via
    // the pointer handlers calling `redraw()` directly (see below) since
    // they happen many times per second and don't need to round-trip
    // through Solid's reactivity to stay correct.
    void props.strokes
    void props.width
    void props.height
    redraw()
  })

  function pointFromEvent(event: PointerEvent): AnnotationPoint {
    return { x: event.offsetX, y: event.offsetY }
  }

  function onPointerDown(event: PointerEvent): void {
    if (!props.active) return
    canvas?.setPointerCapture(event.pointerId)
    liveStroke = [pointFromEvent(event)]
    redraw()
  }

  function onPointerMove(event: PointerEvent): void {
    if (!props.active || liveStroke.length === 0) return
    liveStroke = [...liveStroke, pointFromEvent(event)]
    redraw()
  }

  function onPointerUp(event: PointerEvent): void {
    if (!props.active || liveStroke.length === 0) return
    const points = liveStroke
    liveStroke = []
    canvas?.releasePointerCapture(event.pointerId)
    props.onStrokeComplete({ id: newStrokeId(), points })
  }

  return (
    <canvas
      ref={canvas}
      width={props.width}
      height={props.height}
      class="absolute inset-0 size-full text-primary"
      classList={{ "pointer-events-none": !props.active, "pointer-events-auto": props.active }}
      data-design-annotation-overlay
      data-design-annotation-active={props.active}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    />
  )
}
