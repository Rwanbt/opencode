/* SPDX-License-Identifier: MIT */

import path from "node:path"
import { Filesystem } from "../util/filesystem"

export type RootResolver = (file: string) => Promise<string | undefined>

/**
 * A root resolver, optionally carrying the strict variant of itself.
 *
 * WHY the strict form travels WITH the resolver instead of being a second
 * field on `Info`: 29 of the 36 server definitions declare their root as a
 * bare `NearestRoot([...])` call. Attaching `.strict` to what that factory
 * returns gives every one of them a strict variant without editing a single
 * definition, and keeps the two forms impossible to desynchronise — they are
 * built from the same patterns, in the same place.
 *
 * A resolver WITHOUT `.strict` (the hand-written composite roots) is a
 * resolver that cannot prove a marker exists. `LSP.warmup` treats that as
 * "no evidence" and does not pre-spawn, which is always safe: warmup is an
 * optimisation, skipping it costs latency, never correctness.
 */
export type RootFunction = RootResolver & { strict?: RootResolver }

// Pure root resolution (carte B10).
// Walks up from `file` looking for the first `includePatterns` match, stopping
// at the directory returned by `getStopDir`. If `excludePatterns` matches first,
// returns undefined. Falls back to `getStopDir()` if no include match is found.
//
// `getStopDir` is a thunk (not a string) so the legacy wrapper can pass
// `() => Instance.directory` without forcing the global read at call time of
// `NearestRoot(...)` itself — preserving the original lazy semantics of the
// pre-refactor function.
//
// `options.strict` (B11): when true, the function returns `undefined` instead of
// `stopDir` when no include match is found. This is the foundation for the strict
// warmup mode: a server whose root resolution returns `undefined` is not spawned.
export const NearestRoot = (
  includePatterns: string[],
  getStopDir: () => string,
  excludePatterns?: string[],
  options?: { strict?: boolean },
): RootFunction => {
  return async (file) => {
    const stopDir = getStopDir()
    if (excludePatterns) {
      const excludedFiles = Filesystem.up({
        targets: excludePatterns,
        start: path.dirname(file),
        stop: stopDir,
      })
      const excluded = await excludedFiles.next()
      await excludedFiles.return()
      if (excluded.value) return undefined
    }
    const files = Filesystem.up({
      targets: includePatterns,
      start: path.dirname(file),
      stop: stopDir,
    })
    const first = await files.next()
    await files.return()
    if (!first.value) return options?.strict ? undefined : stopDir
    return path.dirname(first.value)
  }
}
