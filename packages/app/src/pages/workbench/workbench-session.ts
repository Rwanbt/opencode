/* SPDX-License-Identifier: MIT */

import { createSignal } from "solid-js"
import { useLanguage } from "@/context/language"
import { useMode } from "@/context/mode"
import { useSDK } from "@/context/sdk"
import { useSync } from "@/context/sync"

export type WorkbenchSession = {
  /** The conversation every Workbench surface of this workspace must show. */
  id: () => string | undefined
  /** Returns the current session, creating one on first use. */
  ensure: () => Promise<string>
  /** Sends a prompt to that session and refreshes it. */
  prompt: (text: string) => Promise<void>
  /**
   * Phase 10.1 — reverts the session so `messageId` and everything after
   * it is excluded from active history, then refreshes. Same primitive
   * Code mode's own undo/redo uses (`session.revert`, see
   * `use-session-commands.tsx`). "Regenerate" passes the id of the USER
   * message that prompted the answer being regenerated (never the
   * assistant message itself) — that excludes both the user message AND
   * the assistant answer after it. The caller then resends that user
   * message's text via `prompt`, which appends a fresh user message; the
   * excluded original is never resent, so exactly one copy of that user
   * message stays visible — no duplicate.
   */
  revert: (messageId: string) => Promise<void>
}

/**
 * Single owner of session identity across the Workbench surfaces.
 *
 * WHY it exists: `WorkbenchChat` and the Design refine prompt each called
 * `session.create` and kept the result in a signal of their own. Neither wrote
 * the new id back into the route, and the route is the only carrier that
 * survives a mode change. A conversation started in Design was therefore
 * invisible to Code, which opened a second one for the same project — and
 * inside Design a refine prompt could land in a session the thread never
 * displayed. Creation and adoption only make sense together, once.
 */
export function createWorkbenchSession(deps: { title: () => string }): WorkbenchSession {
  const sdk = useSDK()
  const sync = useSync()
  const mode = useMode()
  const language = useLanguage()

  // Bridges the gap between `session.create` resolving and the router settling
  // on the new location. The route wins as soon as it reports the id, so this
  // never becomes a second source of truth.
  const [adopted, setAdopted] = createSignal<string>()
  const id = (): string | undefined => mode.sessionId() ?? adopted()

  async function ensure(): Promise<string> {
    const existing = id()
    if (existing) return existing
    const directory = mode.directory()
    if (!directory) throw new Error(language.t("workbench.errors.sessionCreation"))
    const created = await sdk.client.session.create({ directory, title: deps.title() })
    const next = created.data?.id
    if (!next) throw new Error(language.t("workbench.errors.sessionCreation"))
    setAdopted(next)
    mode.adoptSession(next)
    return next
  }

  async function prompt(text: string): Promise<void> {
    const sessionId = await ensure()
    await sdk.client.session.prompt({ sessionID: sessionId, agent: "build", parts: [{ type: "text", text }] })
    await sync.session.sync(sessionId, { force: true })
  }

  async function revert(messageId: string): Promise<void> {
    const sessionId = id()
    if (!sessionId) return
    await sdk.client.session.revert({ sessionID: sessionId, messageID: messageId })
    await sync.session.sync(sessionId, { force: true })
  }

  return { id, ensure, prompt, revert }
}
