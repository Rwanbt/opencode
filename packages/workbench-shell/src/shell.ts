/* SPDX-License-Identifier: MIT */

/**
 * WorkbenchShell — Plan V3 §20, the part of "Shell Unifia et expérience
 * Code/Work" that can be proven without pixels.
 *
 * §20's exit criteria are not visual. "Code et Work partagent les sessions",
 * "un artefact créé dans Work s'ouvre dans Code/Design", "le changement de mode
 * ne change pas de runtime" and "le shell reste utilisable sans réseau" are all
 * statements about addressing and ownership. They are also the ones that fail
 * silently: a shell where each mode lazily builds its own adapter looks
 * identical from the outside — sessions appear shared right up until two
 * runtimes disagree.
 *
 * So the shell owns exactly one runtime reference, addresses sessions and
 * artifacts by identity rather than by mode, and counts every runtime it is
 * handed. The rendered UI is a consumer of this model, and is not delivered
 * here.
 */

import type { RuntimeAdapter, RuntimeId, Session } from "@unifia/contracts"
import { SHELL_MODES, WORK_V1_FUNCTIONS, isDestructive, isReadOnly, type DestructiveAction, type ShellMode, type WorkFunction } from "./modes.js"

/** Where a result came from. §20: "la provenance de chaque résultat est visible." */
export type Provenance = {
  sessionId: string
  mode: ShellMode
  runtimeId: RuntimeId
  producedAt: number
}

export type ShellResult<T> = { value: T; provenance: Provenance }

/** A shell-addressed artifact. The lineage id carries no mode. */
export type ArtifactRef = { artifactId: string; createdIn: ShellMode }

export type PreviewToken = { id: string; action: DestructiveAction; target: string; issuedAt: number }

export type ShellRefusal =
  | { reason: "unknown-mode"; mode: string }
  | { reason: "write-in-read-only"; fn: WorkFunction }
  | { reason: "preview-required"; action: DestructiveAction }
  | { reason: "preview-mismatch"; action: DestructiveAction }
  | { reason: "preview-spent"; action: DestructiveAction }
  | { reason: "missing-provenance" }

export class ShellError extends Error {
  readonly refusal: ShellRefusal
  constructor(refusal: ShellRefusal) {
    super(`shell refused: ${refusal.reason}`)
    this.name = "ShellError"
    this.refusal = refusal
  }
}

export type ShellOptions = {
  runtime: RuntimeAdapter
  runtimeId: RuntimeId
  now?: () => number
  readOnly?: boolean
}

export class WorkbenchShell {
  readonly #runtime: RuntimeAdapter
  readonly #runtimeId: RuntimeId
  readonly #now: () => number
  readonly #readOnly: boolean
  readonly #artifacts = new Map<string, ArtifactRef>()
  readonly #previews = new Map<string, PreviewToken>()
  readonly #spent = new Set<string>()
  #mode: ShellMode = "code"
  #modeSwitches = 0
  #previewCounter = 0

  constructor(options: ShellOptions) {
    this.#runtime = options.runtime
    this.#runtimeId = options.runtimeId
    this.#now = options.now ?? (() => Date.now())
    this.#readOnly = options.readOnly ?? false
  }

  get mode(): ShellMode { return this.#mode }
  get modeSwitches(): number { return this.#modeSwitches }
  get readOnly(): boolean { return this.#readOnly }

  /** The one runtime, exposed so a caller can assert its identity across modes. */
  get runtime(): RuntimeAdapter { return this.#runtime }

  /**
   * Changes mode. Deliberately returns the same runtime reference: §20 says the
   * mode switch must not change runtime, and the cheapest way to guarantee that
   * is to have nothing here that could construct one.
   */
  switchMode(mode: ShellMode): RuntimeAdapter {
    if (!(SHELL_MODES as readonly string[]).includes(mode)) throw new ShellError({ reason: "unknown-mode", mode })
    if (mode !== this.#mode) this.#modeSwitches += 1
    this.#mode = mode
    return this.#runtime
  }

  /** Functions this shell offers. A read-only shell offers strictly fewer. */
  functions(): readonly WorkFunction[] {
    return this.#readOnly ? WORK_V1_FUNCTIONS.filter(isReadOnly) : WORK_V1_FUNCTIONS
  }

  /** Guards a function call; the mobile projection refuses writes here, not at the call site. */
  invoke<T>(fn: WorkFunction, sessionId: string, produce: () => T): ShellResult<T> {
    if (this.#readOnly && !isReadOnly(fn)) throw new ShellError({ reason: "write-in-read-only", fn })
    return { value: produce(), provenance: { sessionId, mode: this.#mode, runtimeId: this.#runtimeId, producedAt: this.#now() } }
  }

  /** A read-only view onto the same runtime — §20's "le mobile peut consommer les mêmes contrats en lecture". */
  projectReadOnly(): WorkbenchShell {
    return new WorkbenchShell({ runtime: this.#runtime, runtimeId: this.#runtimeId, now: this.#now, readOnly: true })
  }

  async openSession(sessionId: string): Promise<Session | undefined> {
    const sessions = await this.#runtime.listSessions({ workspaceId: "*" })
    return sessions.find((session) => session.id === sessionId)
  }

  /** Records an artifact against the mode that made it, without binding it there. */
  createArtifact(artifactId: string): ArtifactRef {
    const ref: ArtifactRef = { artifactId, createdIn: this.#mode }
    this.#artifacts.set(artifactId, ref)
    return ref
  }

  /**
   * Opens an artifact from the current mode.
   *
   * `createdIn` is provenance, never a permission: §20 requires an artifact
   * made in Work to open in Code and Design, so this method must not consult it
   * when deciding whether to return.
   */
  openArtifact(artifactId: string): ShellResult<ArtifactRef> | undefined {
    const ref = this.#artifacts.get(artifactId)
    if (!ref) return undefined
    return { value: ref, provenance: { sessionId: artifactId, mode: this.#mode, runtimeId: this.#runtimeId, producedAt: this.#now() } }
  }

  /** Issues the preview §20 requires before a destructive action. */
  preview(action: DestructiveAction, target: string): PreviewToken {
    const token: PreviewToken = { id: `preview-${++this.#previewCounter}`, action, target, issuedAt: this.#now() }
    this.#previews.set(token.id, token)
    return token
  }

  /**
   * Runs a destructive action against a preview the user has seen.
   *
   * The token is single-use and bound to both the action and its target:
   * a preview of deleting artifact A is not consent to delete artifact B, and
   * replaying one token is not consent given twice.
   */
  commit<T>(action: string, target: string, token: PreviewToken | undefined, run: () => T): T {
    if (!isDestructive(action)) return run()
    if (!token) throw new ShellError({ reason: "preview-required", action })
    if (this.#spent.has(token.id)) throw new ShellError({ reason: "preview-spent", action })
    const issued = this.#previews.get(token.id)
    if (!issued || issued.action !== action || issued.target !== target) throw new ShellError({ reason: "preview-mismatch", action })
    this.#spent.add(token.id)
    return run()
  }
}

/** Refuses a result that arrived without provenance. */
export function surface<T>(result: ShellResult<T> | { value: T; provenance?: undefined }): ShellResult<T> {
  if (!result.provenance) throw new ShellError({ reason: "missing-provenance" })
  return result
}
