/* SPDX-License-Identifier: MIT */

/**
 * P31 — Media provider adapter.
 *
 * The media runtime does not hard-code any provider. Each provider
 * (Kokoro TTS, Parakeet STT, an image generator, etc.) is described
 * by an object that implements `MediaProvider`. The runtime asks
 * the adapter to call the provider for a job, the provider returns
 * a `MediaArtifact`, and the runtime wraps that into a regular
 * `ArtifactStore` record with provenance.
 *
 * The adapter is the single place where a new provider gets wired.
 * The runtime is the only caller.
 */

import { readFile } from "node:fs/promises"

export type MediaKind = "image" | "video" | "audio"

export type MediaJob = {
  /** A short identifier the provider uses to log the job. */
  jobId: string
  /** The kind of media to produce. */
  kind: MediaKind
  /** Free-form prompt or script for the provider. */
  prompt: string
}

export type MediaArtifact = {
  jobId: string
  kind: MediaKind
  /** Bytes of the produced media. */
  bytes: Uint8Array
  /** MIME type, used by the artifact-studio ingestion. */
  mime: string
  /** Provenance payload recorded in the artifact metadata. */
  provenance: {
    sourceTool: string
    capabilityPack: string
    /** Provider-specific extras (model name, prompt hash, etc.). */
    extras?: Readonly<Record<string, string>>
  }
}

export type MediaProvider = {
  /** The provider's stable identifier. */
  id: string
  /** Kinds this provider supports. */
  supports: readonly MediaKind[]
  /** Produces a media artifact for the given job. Pure I/O, no side effects. */
  generate(job: MediaJob): Promise<MediaArtifact>
}

/** A registry of providers keyed by id. */
export type MediaProviderRegistry = {
  register(provider: MediaProvider): void
  unregister(id: string): void
  get(id: string): MediaProvider | undefined
  list(): readonly MediaProvider[]
}

/** In-memory registry. Pure data structure. */
export function createMediaProviderRegistry(): MediaProviderRegistry {
  const providers = new Map<string, MediaProvider>()
  return {
    register(provider) {
      if (providers.has(provider.id)) throw new Error(`media provider already registered: ${provider.id}`)
      providers.set(provider.id, provider)
    },
    unregister(id) {
      providers.delete(id)
    },
    get(id) {
      return providers.get(id)
    },
    list() {
      return [...providers.values()]
    },
  }
}

/**
 * Returns the list of providers that can serve the given job. The
 * list is sorted by provider id for determinism.
 */
export function providersForKind(registry: MediaProviderRegistry, kind: MediaKind): readonly MediaProvider[] {
  return registry.list()
    .filter((provider) => provider.supports.includes(kind))
    .sort((left, right) => left.id.localeCompare(right.id))
}

/**
 * Filesystem-backed provider: reads a file from a known directory
 * and returns it as the produced media. Useful for tests and for
 * shipping pre-rendered assets the user has not yet requested.
 */
export function createFilesystemMediaProvider(options: { id: string; kind: MediaKind; root: string; mime: string }): MediaProvider {
  return {
    id: options.id,
    supports: [options.kind],
    async generate(job) {
      const path = `${options.root}/${job.jobId}.${extensionFor(options.mime)}`
      const bytes = await readFile(path)
      return {
        jobId: job.jobId,
        kind: options.kind,
        bytes,
        mime: options.mime,
        provenance: { sourceTool: options.id, capabilityPack: "media-runtime" },
      }
    },
  }
}

const MIME_EXTENSIONS: Readonly<Record<string, string>> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/svg+xml": "svg",
  "audio/mpeg": "mp3",
  "audio/wav": "wav",
  "audio/ogg": "ogg",
  "video/mp4": "mp4",
  "video/webm": "webm",
}

function extensionForInternal(mime: string): string {
  return MIME_EXTENSIONS[mime] ?? "bin"
}

/** Returns a file extension for the given MIME type. */
export function extensionFor(mime: string): string {
  return extensionForInternal(mime)
}

/** Refuses an undeclared provider id. Throws. */
export function requireProvider(registry: MediaProviderRegistry, id: string): MediaProvider {
  const provider = registry.get(id)
  if (!provider) throw new Error(`unknown media provider: ${id}`)
  return provider
}
