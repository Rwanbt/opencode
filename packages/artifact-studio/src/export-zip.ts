/* SPDX-License-Identifier: MIT */

/**
 * P27 — Archive an artifact (entry + assets) into a single ZIP.
 *
 * The output is a stored-ZIP that round-trips through
 * `readStoredZip` of `@unifia/document-packs/zip`. The function
 * preserves relative paths; the consumer of the ZIP sees the
 * same layout they wrote on disk.
 *
 * Executable parts are rejected. Refusing is the point: a ZIP that
 * includes `vbaProject.bin` is not the same thing as "the artifact",
 * and we do not want to give a future consumer an executable to
 * stumble onto.
 */

import { createStoredZipFromBytes, readStoredZip } from "@unifia/document-packs/zip"

export const EXECUTABLE_NAME_PATTERNS: readonly RegExp[] = [/\.bin$/i, /vbaProject/i, /\/Macros\//i]

export class ExecutablePartError extends Error {
  constructor(public readonly name: string) {
    super(`refused to archive executable part: ${name}`)
    this.name = "ExecutablePartError"
  }
}

export type ArtifactArchiveEntry = {
  name: string
  content: Uint8Array
}

function isExecutableName(name: string): boolean {
  return EXECUTABLE_NAME_PATTERNS.some((pattern) => pattern.test(name))
}

/** Builds the bytes of a stored-ZIP archive of the given entries. */
export function buildArtifactArchive(entries: readonly ArtifactArchiveEntry[]): Uint8Array {
  for (const entry of entries) {
    if (isExecutableName(entry.name)) throw new ExecutablePartError(entry.name)
  }
  return createStoredZipFromBytes(entries)
}

/** Reads the archive back as a list of entries. */
export function readArtifactArchive(bytes: Uint8Array): readonly ArtifactArchiveEntry[] {
  return readStoredZip(bytes)
}
