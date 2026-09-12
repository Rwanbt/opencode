/* SPDX-License-Identifier: MIT */

import type { ArtifactManifest, ArtifactRendererId } from "@unifia/contracts/artifact-manifest"

/**
 * Pick the renderer id for a given manifest.
 *
 * In v1, the renderer is a single field of the manifest itself —
 * `resolveRenderer` is the canonical entry point so a future revision
 * can layer rules on top (fallbacks, feature flags, A/B) without
 * rewriting every consumer. Today the function returns the
 * manifest's own field; that contract is what callers rely on.
 *
 * Pure: same input → same output, no side effects, no globals.
 */
export function resolveRenderer(manifest: ArtifactManifest): ArtifactRendererId {
  return manifest.renderer
}
