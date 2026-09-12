import type { ChildProcessWithoutNullStreams } from "node:child_process"
import { Log } from "../util/log"
import fs from "node:fs/promises"
import { Instance } from "../project/instance"
import { Process } from "../util/process"
import { NearestRoot as NearestRootPure, type RootFunction, type RootResolver } from "./root-match"

// Re-exported so server definitions can type a hand-written composite root and
// its strict twin without reaching past this module into ./root-match.
export type { RootFunction, RootResolver }

// Shared infrastructure for the LSP server definitions. Split out of
// server.ts so the per-language definitions can live in sibling modules
// without that file exceeding the size budget. The definitions import
// these; server.ts re-binds them into the LSPServer namespace.

export const log = Log.create({ service: "lsp.server" })

export const pathExists = async (p: string) =>
  fs
    .stat(p)
    .then(() => true)
    .catch(() => false)

export const run = (cmd: string[], opts: Process.RunOptions = {}) => Process.run(cmd, { ...opts, nothrow: true })
export const output = (cmd: string[], opts: Process.RunOptions = {}) => Process.text(cmd, { ...opts, nothrow: true })

export interface Handle {
  process: ChildProcessWithoutNullStreams
  initialization?: Record<string, any>
}

// Legacy wrapper (carte B10): preserves the original (includePatterns, excludePatterns?)
// signature by forwarding to the pure implementation in `./root-match` with a thunk
// returning `Instance.directory`. The thunk defers the global read until the returned
// RootFunction is actually invoked — matching the pre-refactor lazy semantics.
export const NearestRoot = (
  includePatterns: string[],
  excludePatterns?: string[],
): RootFunction => {
  const resolver: RootFunction = NearestRootPure(includePatterns, () => Instance.directory, excludePatterns)
  // The strict twin, built from the same patterns so the two can never drift.
  // `LSP.warmup` uses it to answer "does this project actually contain this
  // language?" — a question the lenient resolver cannot answer, because it
  // returns the project directory whether a marker was found or not.
  resolver.strict = NearestRootPure(includePatterns, () => Instance.directory, excludePatterns, { strict: true })
  return resolver
}

/**
 * Marks a hand-written root resolver that ALREADY returns `undefined` when it
 * finds no marker — i.e. one that is strict by construction and needs no twin.
 *
 * Declaring it explicitly is what lets `LSP.warmup` pre-spawn the server: an
 * absent `.strict` means "cannot prove this language is here", and warmup
 * skips it. Without this, a resolver that was already correct would be
 * treated as if it were lenient and silently lose its warmup.
 */
export const alreadyStrict = (resolver: RootResolver): RootFunction => {
  const root: RootFunction = resolver
  root.strict = resolver
  return root
}

// Strict wrapper (carte B11): same signature, but returns `undefined` instead of
// `Instance.directory` when no include match is found. This is the foundation for
// the strict warmup mode (carte B12+ will wire it into `LSP.warmup` so that
// servers whose root can't be resolved don't get spawned).
export const StrictNearestRoot = (
  includePatterns: string[],
  excludePatterns?: string[],
): RootFunction => NearestRootPure(includePatterns, () => Instance.directory, excludePatterns, { strict: true })

export interface Info {
  id: string
  extensions: string[]
  global?: boolean
  root: RootFunction
  spawn(root: string): Promise<Handle | undefined>
}
