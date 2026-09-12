/* SPDX-License-Identifier: MIT */

/**
 * Artifact manifest — the v1 contract declared in ADR-1039.
 *
 * Each artefact carries a manifest that names its kind, picks a
 * renderer, and points to the entry file. The manifest is the
 * single source of truth for "how should I display this" — a
 * renderer never inspects a file extension to decide, it consumes
 * the manifest.
 *
 * This module is a *contract*. The runtime (`@unifia/artifact-runtime`)
 * stores the manifest in the artefact's `metadata`; the render
 * package (`@unifia/artifact-render`) consumes it. The two packages
 * agree on the shape because they both depend on this file.
 */

export const MANIFEST_VERSION = 1 as const

export type ArtifactKind =
  | "html"
  | "deck"
  | "react-component"
  | "markdown-document"
  | "svg"
  | "image"
  | "video"
  | "audio"

export type ArtifactRendererId =
  | "html"
  | "deck-html"
  | "react-component"
  | "markdown"
  | "svg"
  | "media"

export type ArtifactManifest = {
  manifestVersion: typeof MANIFEST_VERSION
  kind: ArtifactKind
  renderer: ArtifactRendererId
  /** Path of the entry file, relative to the artefact version root, with no `..` or absolute prefix. */
  entry: string
  /** Names exported by the entry, when the renderer needs them. Empty array for `html` and `svg`. */
  exports: readonly string[]
}

const ARTIFACT_KINDS: ReadonlySet<ArtifactKind> = new Set<ArtifactKind>([
  "html",
  "deck",
  "react-component",
  "markdown-document",
  "svg",
  "image",
  "video",
  "audio",
])

const ARTIFACT_RENDERERS: ReadonlySet<ArtifactRendererId> = new Set<ArtifactRendererId>([
  "html",
  "deck-html",
  "react-component",
  "markdown",
  "svg",
  "media",
])

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string")
}

/**
 * Throws when the input is not a v1 manifest. A different
 * `manifestVersion` is not a "v1 with extra fields", it is an
 * unknown contract — refuse explicitly, never guess.
 */
export function parseArtifactManifest(value: unknown): ArtifactManifest {
  if (!isObject(value)) {
    throw new Error("artifact manifest: expected an object")
  }
  if (value.manifestVersion !== MANIFEST_VERSION) {
    throw new Error(
      `artifact manifest: unsupported manifestVersion ${JSON.stringify(value.manifestVersion)} (expected ${MANIFEST_VERSION})`,
    )
  }
  if (typeof value.kind !== "string" || !ARTIFACT_KINDS.has(value.kind as ArtifactKind)) {
    throw new Error(`artifact manifest: unknown kind ${JSON.stringify(value.kind)}`)
  }
  if (typeof value.renderer !== "string" || !ARTIFACT_RENDERERS.has(value.renderer as ArtifactRendererId)) {
    throw new Error(`artifact manifest: unknown renderer ${JSON.stringify(value.renderer)}`)
  }
  if (typeof value.entry !== "string") {
    throw new Error("artifact manifest: entry must be a string")
  }
  if (!isStringArray(value.exports)) {
    throw new Error("artifact manifest: exports must be an array of strings")
  }
  const entry = value.entry
  // Rule 3: relative path, no `..`, no absolute prefix.
  if (entry.length === 0) {
    throw new Error("artifact manifest: entry must not be empty")
  }
  if (entry.startsWith("/") || /^[a-zA-Z]:[\\/]/.test(entry)) {
    throw new Error(`artifact manifest: entry must be relative, got ${JSON.stringify(entry)}`)
  }
  // Reject parent traversal on the path itself (after normalisation).
  if (entry.includes("..")) {
    throw new Error(`artifact manifest: entry must not contain '..', got ${JSON.stringify(entry)}`)
  }
  return {
    manifestVersion: MANIFEST_VERSION,
    kind: value.kind as ArtifactKind,
    renderer: value.renderer as ArtifactRendererId,
    entry,
    exports: value.exports,
  }
}

/**
 * Deduce a manifest from the entry file extension, when no explicit
 * manifest is available. Returns `null` for extensions we do not
 * know — the caller can then refuse or fall back to a default.
 *
 * The mapping is deliberately narrow: an `.html` becomes `html`,
 * not `react-component`, even though a React app can produce an
 * `.html` extension. The renderer is overridable through an
 * explicit manifest, so the inference only seeds the first draft.
 */
export function inferManifest(entry: string): ArtifactManifest | null {
  // Find the extension: dot-separated tail, lowercased.
  const slash = entry.lastIndexOf("/")
  const base = slash >= 0 ? entry.slice(slash + 1) : entry
  const dot = base.lastIndexOf(".")
  if (dot <= 0) return null
  const ext = base.slice(dot + 1).toLowerCase()

  switch (ext) {
    case "html":
    case "htm":
      return {
        manifestVersion: MANIFEST_VERSION,
        kind: "html",
        renderer: "html",
        entry,
        exports: [],
      }
    case "md":
    case "markdown":
      return {
        manifestVersion: MANIFEST_VERSION,
        kind: "markdown-document",
        renderer: "markdown",
        entry,
        exports: [],
      }
    case "svg":
      return {
        manifestVersion: MANIFEST_VERSION,
        kind: "svg",
        renderer: "svg",
        entry,
        exports: [],
      }
    case "jsx":
    case "tsx":
      return {
        manifestVersion: MANIFEST_VERSION,
        kind: "react-component",
        renderer: "react-component",
        entry,
        exports: [],
      }
    case "mp4":
    case "webm":
    case "mov":
      return {
        manifestVersion: MANIFEST_VERSION,
        kind: "video",
        renderer: "media",
        entry,
        exports: [],
      }
    case "mp3":
    case "wav":
    case "ogg":
    case "flac":
      return {
        manifestVersion: MANIFEST_VERSION,
        kind: "audio",
        renderer: "media",
        entry,
        exports: [],
      }
    case "png":
    case "jpg":
    case "jpeg":
    case "gif":
    case "webp":
    case "avif":
      return {
        manifestVersion: MANIFEST_VERSION,
        kind: "image",
        renderer: "media",
        entry,
        exports: [],
      }
    default:
      return null
  }
}
