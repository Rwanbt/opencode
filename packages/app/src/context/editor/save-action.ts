import type { DocEffect } from "./store"

// FORK (CORRECTIF F11, 2026-07-19): shared control-flow for editor-panel.tsx's
// handleCtrlS / handleOverwrite / handleRecreate. Before this extraction, each
// handler's busy/conflict/missing/error/success branching was hand-copied
// into editor-panel.test.ts as `runHandleCtrlS`/`runHandleOverwrite`/
// `runHandleRecreate` — a real fix to one of the branches (F1, F3) had to be
// applied twice, once in the component and once in the test copy, and
// nothing enforced that the copy stayed in sync (see the old REVIEW's M4).
// Importing this ONE function from both the component and the tests means
// there is only one place the busy/conflict/missing/error/success decision
// can live, and a regression in it fails every test that exercises it.
//
// getContent() is re-read on every attempt, INCLUDING retries — this matters:
// the retry exists specifically so a Ctrl+S that raced a busy autosave
// re-sends the user's freshest keystrokes, not the stale snapshot captured
// before the wait (PLAN-READONLY-VIEWER-REACTIVITY C11).

export interface RunSaveActionOptions {
  path: string
  getContent: () => string
  attempt: (path: string, content: string) => Promise<DocEffect>
  applyDocEffect: (eff: DocEffect) => void
  /** Called for conflict/missing/error/absent — NOT for busy (that's a distinct no-op, see DocEffect's "busy" doc). */
  onNonSuccess?: (eff: DocEffect) => void
  /** Called on set/none/unchanged. Receives the exact bytes now on disk (eff.content when reformatted, otherwise the sent content) and the content that was actually sent. */
  onSuccess: (finalContent: string, sentContent: string, effect: DocEffect) => Promise<void>
  /** Omit to never retry on busy (handleOverwrite/handleRecreate's current behavior). */
  retry?: {
    waitForSlot: (path: string) => Promise<boolean>
    retriesLeft: number
  }
}

export async function runSaveAction(opts: RunSaveActionOptions): Promise<DocEffect> {
  const content = opts.getContent()
  const eff = await opts.attempt(opts.path, content)
  opts.applyDocEffect(eff)

  if (eff.type === "busy") {
    if (opts.retry && opts.retry.retriesLeft > 0) {
      const free = await opts.retry.waitForSlot(opts.path)
      if (free) {
        return runSaveAction({ ...opts, retry: { ...opts.retry, retriesLeft: opts.retry.retriesLeft - 1 } })
      }
    }
    return eff
  }

  if (eff.type === "conflict" || eff.type === "missing" || eff.type === "error" || eff.type === "absent") {
    opts.onNonSuccess?.(eff)
    return eff
  }

  // The remaining outcomes are successful: a write (set/none) or a semantic no-op (unchanged).
  const finalContent = eff.type === "set" || eff.type === "unchanged" ? eff.content : content
  await opts.onSuccess(finalContent, content, eff)
  return eff
}
