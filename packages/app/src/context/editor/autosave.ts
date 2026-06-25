// FORK (Phase 3.2, PLAN-EDITEUR-IDE-DEFINITIF): debounced autosave factory.
//
// When `settings.general.autoSave()` is true, every CM keystroke schedules a
// save 1s later. The schedule is reset on each new keystroke; the save only
// fires after the user has stopped typing for the debounce window.
//
// Gating rules (the critical ones):
//   • status must be "dirty" when the timer fires — never save an already-clean
//     file, never save during a save-in-flight (status:"saving").
//   • status must NOT be "conflict" or "missing" — a 409 / file-gone path
//     requires explicit user resolution; autosave would silently mask it.
//   • re-read status at fire time, not at schedule time — between schedule
//     and tick (1s window), the user may have triggered a save manually or
//     a watcher may have flipped the status.
//
// Pure factory: no Solid, no I/O. The caller passes in a content-getter
// callback and an EditorStore reference. Tests inject a manual clock to
// drive the debounce deterministically without wall-clock waits.

export interface AutosaveClock {
  setTimeout: (fn: () => void, ms: number) => unknown
  clearTimeout: (handle: unknown) => void
}

export interface AutosaveDeps {
  /** Shared FileStore — source of truth for status (PLAN Phase 2, R1). */
  fileStore: { get: (path: string) => { status: string } | undefined }
  /** EditorStore — the only path that performs the actual write. */
  editor: { save: (path: string, content: string) => Promise<unknown> }
  /** Live CM content for the path. Called at fire time, NOT at schedule. */
  contentFor: (path: string) => string
  /** User setting; autosave is a no-op when disabled. */
  enabled: () => boolean
  /** Debounce window in ms. Default 1000. */
  delay?: number
  /** Test seam: defaults to globalThis.setTimeout / clearTimeout. */
  clock?: AutosaveClock
}

export interface AutosaveHandle {
  schedule: (path: string) => void
  cancel: (path: string) => void
  cancelAll: () => void
  isPending: (path: string) => boolean
}

export function createAutosave(deps: AutosaveDeps): AutosaveHandle {
  const delay = deps.delay ?? 1000
  const clock: AutosaveClock = deps.clock ?? {
    setTimeout: (fn, ms) => setTimeout(fn, ms),
    clearTimeout: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
  }
  const timers = new Map<string, unknown>()

  const arm = (path: string, content: string) => {
    const t = clock.setTimeout(() => {
      timers.delete(path)
      const doc = deps.fileStore.get(path)
      if (!doc) return
      if (doc.status !== "dirty") return
      if (doc.status === "conflict" || doc.status === "missing" || doc.status === "saving") return
      void deps.editor.save(path, content)
    }, delay)
    timers.set(path, t)
  }

  const schedule = (path: string) => {
    cancel(path)
    if (!deps.enabled()) return
    if (deps.fileStore.get(path)?.status !== "dirty") return
    arm(path, deps.contentFor(path))
  }

  const cancel = (path: string) => {
    const t = timers.get(path)
    if (t) clock.clearTimeout(t)
    timers.delete(path)
  }

  const cancelAll = () => {
    for (const t of timers.values()) clock.clearTimeout(t)
    timers.clear()
  }

  return {
    schedule,
    cancel,
    cancelAll,
    isPending: (path) => timers.has(path),
  }
}