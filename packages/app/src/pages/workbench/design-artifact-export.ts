/* SPDX-License-Identifier: MIT */

/**
 * Phase 9.5 — export d'un artefact (contenu déjà auto-suffisant : c'est
 * exactement ce que l'iframe de `ArtifactPreview` rend déjà, pas de pont
 * snapshot/sélection à retirer puisque ceux-ci ne sont jamais injectés
 * dans `entry.content` lui-même — `buildSrcdoc` les ajoute côté
 * `ArtifactPreview`, séparément, pour l'affichage seulement).
 *
 * Dérive le nom de fichier téléchargé à partir du nom de l'artefact —
 * pure, donc testable sans DOM. Le téléchargement lui-même (Blob + `<a
 * download>`) et l'impression (nouvelle fenêtre + `window.print()`) sont
 * des opérations DOM et restent dans le composant, non testées ici, même
 * convention que le reste de `pages/workbench`.
 */
export function deriveExportFilename(filename: string | undefined, extension: string): string {
  const base = (filename ?? "").replace(/\.[^./]+$/, "").trim()
  return `${base || "artifact"}.${extension}`
}
