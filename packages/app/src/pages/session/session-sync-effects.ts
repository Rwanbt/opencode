/**
 * Factory for session sync effects in the session page.
 * Extracted from session.tsx to keep that file under the 1500-LOC budget.
 *
 * Covers: session refresh, todo load, VCS file-watcher, VCS eager-load,
 * VCS eager-prefetch, session-end reload, session diff eager/RAF, file-tree
 * refresh, and active-file reload on directory change.
 *
 * All frames/timers are owned here and cleaned up via onCleanup.
 */
import { createEffect, onCleanup, untrack, on } from "solid-js"
import type { useSDK } from "@/context/sdk"
import type { useSync } from "@/context/sync"
import type { useLayout } from "@/context/layout"
import type { useFile } from "@/context/file"
import type { useGlobalSync } from "@/context/global-sync"
import type { VcsMode } from "@/pages/session/session-vcs"
import { getSessionPrefetch, SESSION_PREFETCH_TTL } from "@/context/global-sync/session-prefetch"

export interface SessionSyncEffectsDeps {
  sdk: ReturnType<typeof useSDK>
  sync: ReturnType<typeof useSync>
  globalSync: ReturnType<typeof useGlobalSync>
  layout: ReturnType<typeof useLayout>
  file: ReturnType<typeof useFile>
  params: Record<string, string | undefined>
  sessionKey: () => string
  vcsMode: () => VcsMode | undefined
  wantsReview: () => boolean
  composer: { blocked: () => boolean }
  isDesktop: () => boolean
  loadVcs: (mode: VcsMode, force?: boolean) => Promise<void>
  refreshVcs: () => void
  activeFileTab: () => string | undefined
  fileTreeTab: () => "changes" | "all" | "git" | "tasks"
  /** Returns whether the vcs diff for the given mode is already loaded */
  isVcsReady: (mode: VcsMode) => boolean
}

export function createSessionSyncEffects(deps: SessionSyncEffectsDeps) {
  const {
    sdk,
    sync,
    globalSync,
    layout,
    file,
    params,
    sessionKey,
    vcsMode,
    wantsReview,
    composer,
    isDesktop,
    loadVcs,
    refreshVcs,
    activeFileTab,
    fileTreeTab,
    isVcsReady,
  } = deps

  // ── Frame / timer handles ─────────────────────────────────────────────────

  let refreshFrame: number | undefined
  let refreshTimer: number | undefined
  let todoFrame: number | undefined
  let todoTimer: number | undefined
  let diffFrame: number | undefined
  let diffTimer: number | undefined

  // ── Effect 1: Session refresh on directory / session-id change ────────────

  createEffect(
    on([() => sdk.directory, () => params.id] as const, ([, id]) => {
      if (refreshFrame !== undefined) cancelAnimationFrame(refreshFrame)
      if (refreshTimer !== undefined) window.clearTimeout(refreshTimer)
      refreshFrame = undefined
      refreshTimer = undefined
      if (!id) return

      const cached = untrack(() => sync.data.message[id] !== undefined)
      const stale = !cached
        ? false
        : (() => {
            const info = getSessionPrefetch(sdk.directory, id)
            if (!info) return true
            return Date.now() - info.at > SESSION_PREFETCH_TTL
          })()
      untrack(() => {
        void sync.session.sync(id)
      })

      refreshFrame = requestAnimationFrame(() => {
        refreshFrame = undefined
        refreshTimer = window.setTimeout(() => {
          refreshTimer = undefined
          if (params.id !== id) return
          untrack(() => {
            if (stale) void sync.session.sync(id, { force: true })
          })
        }, 0)
      })
    }),
  )

  // ── Effect 2: Todo load when session is active or composer is blocked ─────

  createEffect(
    on(
      () => {
        const id = params.id
        return [
          sdk.directory,
          id,
          id ? (sync.data.session_status[id]?.type ?? "idle") : "idle",
          id ? composer.blocked() : false,
        ] as const
      },
      ([dir, id, status, blocked]) => {
        if (todoFrame !== undefined) cancelAnimationFrame(todoFrame)
        if (todoTimer !== undefined) window.clearTimeout(todoTimer)
        todoFrame = undefined
        todoTimer = undefined
        if (!id) return
        if (status === "idle" && !blocked) return
        const cached = untrack(
          () => sync.data.todo[id] !== undefined || globalSync.data.session_todo[id] !== undefined,
        )

        todoFrame = requestAnimationFrame(() => {
          todoFrame = undefined
          todoTimer = window.setTimeout(() => {
            todoTimer = undefined
            if (sdk.directory !== dir || params.id !== id) return
            untrack(() => {
              void sync.session.todo(id, cached ? { force: true } : undefined)
            })
          }, 0)
        })
      },
      { defer: true },
    ),
  )

  // ── Effect 3: VCS file-watcher refresh ────────────────────────────────────

  const stopVcs = sdk.event.listen((evt) => {
    if (evt.details.type !== "file.watcher.updated") return
    const props =
      typeof evt.details.properties === "object" && evt.details.properties
        ? (evt.details.properties as Record<string, unknown>)
        : undefined
    const watchedFile = typeof props?.file === "string" ? props.file : undefined
    if (!watchedFile || watchedFile.startsWith(".git/")) return
    refreshVcs()
  })
  onCleanup(stopVcs)

  // ── Effect 4: Load VCS diff when mode + wantsReview change ───────────────

  createEffect(() => {
    const mode = vcsMode()
    if (!mode) return
    if (!wantsReview()) return
    void loadVcs(mode)
  })

  // ── Effect 5: Eager prefetch of VCS diff (800ms delay, idempotent) ────────
  // Ensures first panel toggle is instant instead of cold-fetching.

  createEffect(() => {
    const mode = vcsMode()
    if (!mode) return
    if (sync.project?.vcs !== "git") return
    if (isVcsReady(mode)) return
    const timer = window.setTimeout(() => {
      void loadVcs(mode)
    }, 800)
    onCleanup(() => window.clearTimeout(timer))
  })

  // ── Effect 6: Reload VCS diff when session transitions back to idle ───────

  createEffect(
    on(
      () => sync.data.session_status[params.id ?? ""]?.type,
      (next, prev) => {
        const mode = vcsMode()
        if (!mode) return
        if (!wantsReview()) return
        if (next !== "idle" || prev === undefined || prev === "idle") return
        void loadVcs(mode, true)
      },
      { defer: true },
    ),
  )

  // ── Effect 7: Session diff eager load ────────────────────────────────────

  createEffect(() => {
    const id = params.id
    if (!id) return

    if (!wantsReview()) return
    if (sync.data.session_diff[id] !== undefined) return
    if (sync.status === "loading") return

    void sync.session.diff(id)
  })

  // ── Effect 8: Session diff RAF (debounced force-reload) ──────────────────

  createEffect(
    on(
      () => [sessionKey(), wantsReview()] as const,
      ([key, wants]) => {
        if (diffFrame !== undefined) cancelAnimationFrame(diffFrame)
        if (diffTimer !== undefined) window.clearTimeout(diffTimer)
        diffFrame = undefined
        diffTimer = undefined
        if (!wants) return

        const id = params.id
        if (!id) return
        if (!untrack(() => sync.data.session_diff[id] !== undefined)) return

        diffFrame = requestAnimationFrame(() => {
          diffFrame = undefined
          diffTimer = window.setTimeout(() => {
            diffTimer = undefined
            if (sessionKey() !== key) return
            void sync.session.diff(id, { force: true })
          }, 0)
        })
      },
      { defer: true },
    ),
  )

  // ── Effect 9: File-tree refresh on directory / tab change ─────────────────

  let treeDir: string | undefined
  createEffect(() => {
    const dir = sdk.directory
    if (!isDesktop()) return
    if (!layout.fileTree.opened()) return
    if (sync.status === "loading") return

    fileTreeTab()
    const refresh = treeDir !== dir
    treeDir = dir
    void (refresh ? file.tree.refresh("") : file.tree.list(""))
  })

  // ── Effect 10: Active file reload when directory changes ──────────────────

  createEffect(
    on(
      () => sdk.directory,
      () => {
        const tab = activeFileTab()
        if (!tab) return
        const path = file.pathFromTab(tab)
        if (!path) return
        void file.load(path, { force: true })
      },
      { defer: true },
    ),
  )

  // ── Cleanup ───────────────────────────────────────────────────────────────

  onCleanup(() => {
    if (refreshFrame !== undefined) cancelAnimationFrame(refreshFrame)
    if (refreshTimer !== undefined) window.clearTimeout(refreshTimer)
    if (todoFrame !== undefined) cancelAnimationFrame(todoFrame)
    if (todoTimer !== undefined) window.clearTimeout(todoTimer)
    if (diffFrame !== undefined) cancelAnimationFrame(diffFrame)
    if (diffTimer !== undefined) window.clearTimeout(diffTimer)
  })

  return {}
}
