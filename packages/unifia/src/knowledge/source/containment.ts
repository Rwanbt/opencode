/* SPDX-License-Identifier: MIT */
/**
 * Workspace containment, decided on resolved real paths.
 *
 * One definition, shared by every component that touches the filesystem.
 * Reading and writing must agree on where the boundary is: a second copy of
 * this logic is how a reader and a writer end up disagreeing about what is
 * inside the vault.
 */

import { realpathSync } from "node:fs"
import { dirname, isAbsolute, relative, resolve } from "node:path"

/** Real path of `p`, or null when it cannot be resolved. */
export function realOrNull(p: string): string | null {
  try {
    return realpathSync.native(p)
  } catch {
    return null
  }
}

/*
 * There is deliberately no async counterpart.
 *
 * `fs/promises` exposes no `realpath.native`, and plain `realpath` normalises
 * Windows casing differently — so an async variant would be a *second*
 * containment semantics, and reader and writer could disagree about whether
 * a path is inside the vault. Resolving one path is a metadata lookup, not a
 * long read; the operations that actually block a scan are `readdir`, `stat`
 * and `readFile`, and those are the ones the read path awaits.
 */

/**
 * True when `candidate` resolves inside `realRoot`.
 *
 * Compares real paths, not lexical ones: `statSync` follows junctions and
 * symlinks, so a lexical check lets a link pointing outside the workspace
 * through untouched.
 */
export function isContained(realRoot: string, candidate: string): boolean {
  const real = realOrNull(candidate)
  if (real === null) return false
  if (real === realRoot) return true
  const rel = relative(realRoot, real)
  return rel.length > 0 && !rel.startsWith("..") && !isAbsolute(rel)
}

/**
 * True when `candidate` would resolve inside `realRoot` once created.
 *
 * A path that does not exist yet has no real path, so containment is decided
 * on its nearest existing ancestor. Without this a writer could not create a
 * file at all, and checking only the lexical path would let it create one
 * through a link that escapes the workspace.
 */
export function wouldBeContained(realRoot: string, candidate: string): boolean {
  // An existing path is decided directly.
  if (realOrNull(candidate) !== null) return isContained(realRoot, candidate)

  // Otherwise: the lexical path must not climb out...
  const normalised = resolve(candidate)
  const lexical = relative(realRoot, normalised)
  if (lexical.length === 0 || lexical.startsWith("..") || isAbsolute(lexical)) return false

  // ...and the nearest existing ancestor must itself be inside, so the new
  // file cannot be created through a link that escapes the workspace.
  let dir = dirname(normalised)
  for (;;) {
    if (realOrNull(dir) !== null) return isContained(realRoot, dir)
    const parent = dirname(dir)
    if (parent === dir) return false
    dir = parent
  }
}
