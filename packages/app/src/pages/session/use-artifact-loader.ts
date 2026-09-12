/* SPDX-License-Identifier: MIT */

import { createEffect, createSignal } from "solid-js"
import { useWorkspaceWorkbench } from "@/context/workbench/provider"

/** Document currently loaded via `?artifact=...` query param. */
export type ArtifactDocument = { filename: string; content: string }

/**
 * Side-effect hook that resolves an artifact id from the page URL into
 * a decoded document. Returns reactive signals for the document and
 * the most recent load error.
 *
 * Originally lifted from `session.tsx:98-112` as part of the P1-5
 * split plan (ADR-037, Vague 1). Kept stable so the orchestrator
 * does not have to know about byte decoding or transport errors.
 */
export function useArtifactLoader(getArtifactId: () => string | undefined): {
  artifactDocument: () => ArtifactDocument | undefined
  artifactError: () => string | undefined
} {
  const workbench = useWorkspaceWorkbench()
  const [artifactDocument, setArtifactDocument] = createSignal<ArtifactDocument | undefined>()
  const [artifactError, setArtifactError] = createSignal<string | undefined>()

  createEffect(() => {
    const artifactId = getArtifactId()
    const connection = workbench.connection()
    if (!artifactId || !connection) {
      setArtifactDocument(undefined)
      return
    }
    setArtifactError(undefined)
    void connection.client
      .getArtifact(connection.workspaceId, artifactId)
      .then((result) => {
        const bytes = Uint8Array.from(atob(result.content), (value) => value.charCodeAt(0))
        setArtifactDocument({
          filename: result.artifact.filename,
          content: new TextDecoder().decode(bytes),
        })
      })
      .catch((error) => setArtifactError(error instanceof Error ? error.message : "Artifact could not be loaded"))
  })

  return { artifactDocument, artifactError }
}
