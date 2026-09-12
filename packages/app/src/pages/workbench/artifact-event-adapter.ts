/* SPDX-License-Identifier: MIT */

import type { ArtifactEvent as RenderArtifactEvent } from "@unifia/artifact-render"
import type { ArtifactEvent as StreamArtifactEvent } from "@/pages/workbench/use-artifact-stream"

/**
 * Phase 4 — Pont entre les deux contrats `ArtifactEvent` du projet.
 *
 * Le projet porte deux types **homonymes** `ArtifactEvent` qui se ressemblent
 * mais ne se parlent pas :
 *
 * 1. `@unifia/artifact-render` (parseur des balises `<artifact>` dans le
 *    flux markdown d'un agent) émet
 *    `{type:"artifact:start", identifier, artifactType, title}` puis
 *    `{type:"artifact:chunk", identifier, delta}` puis
 *    `{type:"artifact:end", identifier, fullContent}`. C'est la sortie
 *    « naturelle » d'un agent qui produit un document dans son texte.
 *
 * 2. `use-artifact-stream` (réducteur Solid qui alimente la surface Design)
 *    attend `{type:"artifact:start", artifactId, filename, kind, sessionId?}`
 *    puis `{type:"artifact:chunk", artifactId, chunk}` puis
 *    `{type:"artifact:end", artifactId, reason?}`. C'est la forme que le
 *    moteur de streaming peut ranger dans `byId: Map<id, StreamedArtifact>`.
 *
 * Sans adaptateur, le seul moyen de valider visuellement le moteur est
 * `pushDemoStream`, qui injecte des events à la main dans la forme du
 * consommateur — défaut que la démo masque en écrivant les events à la
 * main dans la forme du consommateur. L'adaptateur ferme la boucle :
 * un event de l'agent (forme 1) devient l'event que le moteur attend (forme 2).
 *
 * Trois cas notables :
 * - `text` (forme 1) : pas d'équivalent. Le texte est consommé par le
 *   rendu markdown du fil, pas par le moteur de streaming. L'adaptateur
 *   retourne `null` et le caller doit ignorer.
 * - `artifact:end.fullContent` (forme 1) : le moteur n'en a pas besoin,
 *   il accumule via les chunks. La perte est volontaire — le moteur
 *   reste simple (un Map d'entries, pas un store de "fin de flux").
 * - Le `sessionId` injecté en forme 2 permet à un consommateur de
 *   distinguer un flux agent du flux de démo. Valeur sentinelle
 *   `"adapter"` pour les events passés par ce pont.
 */

/** Sémantique de la conversion : voir le JSDoc du module. */
export function adaptRenderArtifactEvent(event: RenderArtifactEvent): StreamArtifactEvent | null {
  switch (event.type) {
    case "text":
      // Le texte est rendu dans le fil (WorkbenchThread), pas dans le
      // moteur de streaming. L'adaptateur ne le transmet pas : un drop
      // explicite vaut mieux qu'un event ignoré silencieusement.
      return null
    case "artifact:start":
      return {
        type: "artifact:start",
        artifactId: event.identifier,
        filename: event.title,
        kind: event.artifactType,
        sessionId: "adapter",
      }
    case "artifact:chunk":
      return {
        type: "artifact:chunk",
        artifactId: event.identifier,
        chunk: event.delta,
      }
    case "artifact:end":
      return {
        type: "artifact:end",
        artifactId: event.identifier,
        reason: "complete",
      }
  }
}

/**
 * Variante en lot : applique l'adaptateur à un iterable d'events et
 * retourne uniquement ceux qui passent. Pratique pour brancher un parser
 * (qui yield des events) sur le controller de streaming sans avoir à
 * filtrer manuellement les `null` à chaque tour de boucle.
 */
export function adaptRenderArtifactEvents(
  events: Iterable<RenderArtifactEvent>,
): StreamArtifactEvent[] {
  const adapted: StreamArtifactEvent[] = []
  for (const event of events) {
    const next = adaptRenderArtifactEvent(event)
    if (next) adapted.push(next)
  }
  return adapted
}
