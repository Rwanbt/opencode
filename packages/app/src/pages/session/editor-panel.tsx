// Editor panel extracted from file-tabs.tsx (PLAN-EDITEUR-IDE-DEFINITIF Phase 2.5).
//
// WHY extracted: the editor block (CM mount + banners + Save button + pencil
// toggle + loading spinner) is one cohesive responsibility. Splitting it
// away from the viewer block makes file-tabs.tsx an orchestrator instead of
// a god-component.
//
// The component is NOT self-contained — it depends on the parent
// (FileTabContent) for: the `editing` flag (the viewer block reads it too,
// so it must stay at the top level), the editor handle (rename-dialog and
// code-actions-panel apply edits through it), and the save/reload/overwrite/
// discard/recreate callbacks (they own the SDK + toast coordination).

import { createEffect, createMemo, lazy, onCleanup, Show, Suspense } from "solid-js"
import { useEditor } from "@/context/editor"
import { useFileStore } from "@/context/file/store"
import { useLanguage } from "@/context/language"
import { useSettings } from "@/context/settings"
import { createAutosave } from "@/context/editor/autosave"
import { runSaveAction } from "@/context/editor/save-action"
import { showToast } from "@opencode-ai/ui/toast"
import { markViewerTiming } from "@opencode-ai/util/viewer-timing"
import { IconButton } from "@opencode-ai/ui/icon-button"
import type { CodeMirrorHandle } from "@opencode-ai/ui/code-mirror"
import type {
  LspCallbacks,
  LspLocation,
} from "@opencode-ai/ui/code-mirror-lsp"
import { EditorBanner } from "@/pages/session/editor-banner"
import { consumeAutoEdit } from "@/pages/session/auto-edit"
import type { FileState } from "@/context/file/types"

const CodeMirrorEditor = lazy(() =>
  import("@opencode-ai/ui/code-mirror").then((m) => ({ default: m.CodeMirrorEditor })),
)

export interface EditorPanelProps {
  /** Canonical path of the file currently rendered (getter so Solid tracks it). */
  path: () => string | undefined
  /** Raw disk content used to seed CM when entering edit mode. */
  contents: () => string
  /** Read-mode state (loaded / loading / error). */
  state: () => FileState | undefined
  /** Whether the user is in edit mode (controlled by the parent so the viewer can react). */
  editing: () => boolean
  setEditing: (v: boolean) => void
  /** Editor entry from the editor store (dirty / saving / conflict / missing). */
  editorEntry: () => import("@/context/editor/store").EditorEntry | undefined
  /** Reference to the live CM handle — shared with rename-dialog and code-actions-panel. */
  editorHandle: CodeMirrorHandle | undefined
  setEditorHandle: (handle: CodeMirrorHandle | undefined) => void
  /** LSP callbacks (built in file-tabs.tsx via createLspCallbacks). */
  lspCallbacks: LspCallbacks
  onNavigate: (file: string) => void
  onReferences: (refs: LspLocation[]) => void
  // FORK (PLAN-READONLY-VIEWER-REACTIVITY C1): optional `content` is the
  // exact final bytes now on disk (the sent content, or the server's
  // reformatted result if `formatted` was true) — lets the caller seed the
  // viewer cache directly instead of re-fetching over the SDK. Omitted by
  // onDiscard, which has no fresh content to offer (nothing was written).
  onSave: (content?: string) => Promise<void>
  onReload: (content?: string) => Promise<void>
  onOverwrite: (content?: string) => Promise<void>
  onDiscard: () => void
  onRecreate: (content?: string) => Promise<void>
}

export function EditorPanel(props: EditorPanelProps) {
  const editorStore = useEditor()
  const fileStore = useFileStore()
  const language = useLanguage()
  const settings = useSettings()

  // FORK (Phase 3.2): debounced autosave factory, scoped to this editor
  // instance. The CM handle is in scope here (not at EditorProvider level),
  // so this is the right place to wire `contentFor`. Per-keystroke
  // scheduling happens in handleEditorChange; the factory's own status
  // gating handles saving/conflict/missing re-checks at fire time.
  const autosave = createAutosave({
    fileStore,
    editor: editorStore,
    contentFor: () => props.editorHandle?.getContent() ?? "",
    enabled: () => settings.general.autoSave(),
  })
  onCleanup(() => autosave.cancelAll())

  // FORK (round 3, PLAN-FIX-CLOSE-GUARD-SAVE): register a CM live-content
  // getter on FileStore so consumers without a CM handle in scope (e.g. the
  // close-guard dialog) can read the freshest bytes at save time. Why a
  // getter rather than mirroring into `FileDoc.draft` per keystroke: CM owns
  // the live buffer, copying a 1MB string on every keystroke is a perf
  // killer, and the getter is read at save time so it can never go stale.
  //
  // IMPORTANT: read `props.editorHandle` BEFORE the `if (!p) return` guard
  // so Solid tracks the handle dependency. If guarded first, the effect
  // only re-runs on path changes and would capture the initial (undefined)
  // handle — yielding a getter that always returns "".
  //
  // IMPORTANT: use onCleanup so Solid unregisters the getter BEFORE
  // re-running the effect on the next path change AND on dispose. A closure
  // returned from createEffect is NOT a cleanup in Solid (React semantics) —
  // it would be passed as the previous value and never invoked, so switching
  // tabs would leave the old path's getter bound to a CM handle that now
  // displays a different file (cross-file save corruption via close-guard).
  createEffect(() => {
    const p = props.path()
    const h = props.editorHandle
    if (!p) return
    fileStore.setDraftGetter(p, () => h?.getContent() ?? "")
    onCleanup(() => {
      fileStore.setDraftGetter(p, undefined)
    })
  })

  // Guard: hide the pencil for binary files (NUL bytes) and files over 1 MB.
  const canEdit = createMemo(() => {
    if (!props.state()?.loaded) return false
    const text = props.contents()
    if (text.length > 1_000_000) return false
    if (text.includes("\0")) return false
    return true
  })

  // Derived: true once the editor store entry is ready (after open() resolves).
  // Also false when the file is missing so the CM panel is not shown.
  const showEditor = createMemo(() => {
    if (!props.editing()) return false
    const p = props.path()
    if (!p) return false
    const entry = editorStore.get(p)
    return entry !== undefined && !entry.missing
  })

  const handleEnterEdit = async () => {
    const p = props.path()
    if (!p) return
    props.setEditing(true)
    try {
      // Use ?? not ||: a brand-new empty file has contents() === "" which is
      // falsy but a valid fallback. The store's readRaw() will succeed on the
      // empty file; if it fails (race with the filesystem watcher) the "" seed
      // lets the editor open immediately instead of showing a false
      // "this file was deleted" banner.
      await editorStore.open(p, props.contents() ?? undefined)
    } catch {
      props.setEditing(false)
      showToast({ variant: "error", title: language.t("toast.file.openFailed") })
    }
  }

  // Called by CM on every user keystroke: update dirty state.
  // NOT inside a createEffect — runs imperatively in CM's updateListener.
  const handleEditorChange = (content: string) => {
    const p = props.path()
    if (!p) return
    const entry = editorStore.get(p)
    if (!entry) return
    const dirty = content !== entry.baseline.content
    editorStore.setDirty(p, dirty)
    // FORK (Phase 3.2): arm the debounce on every keystroke. The factory
    // re-checks FileStore status at fire time, so a manual save mid-debounce
    // (status → saving) automatically aborts the scheduled save.
    if (dirty) autosave.schedule(p)
  }

  const applyDocEffect = (eff: { type: string; content?: string }) => {
    if (eff.type === "set" && eff.content !== undefined) {
      props.editorHandle?.setContent(eff.content)
    }
  }

  // FORK (PLAN-READONLY-VIEWER-REACTIVITY C11): wait for an in-flight save
  // (autosave or a concurrent manual save) to release the path, so a "busy"
  // Ctrl+S can retry instead of being silently dropped or — the actual bug —
  // treated as a success. Bounded by maxWaitMs so a stuck save (e.g. a hung
  // request) can't wedge the retry forever; the caller just gives up for
  // this keypress and the user can press Ctrl+S again.
  const waitForSaveSlot = async (p: string, maxWaitMs = 5000) => {
    const start = Date.now()
    while (editorStore.get(p)?.saving) {
      if (Date.now() - start > maxWaitMs) return false
      await new Promise((resolve) => setTimeout(resolve, 50))
    }
    return true
  }

  // FORK (CORRECTIF F11): the busy/conflict/missing/error/success branching
  // below is shared with handleOverwrite/handleRecreate via runSaveAction
  // (save-action.ts) — imported here AND by editor-panel.test.ts, so there
  // is one place that decision lives instead of a hand-copied test mirror.
  const handleCtrlS = async () => {
    const p = props.path()
    if (!p) return
    // FORK (PLAN-READONLY-VIEWER-REACTIVITY Phase 0): "save-start" means
    // "the user pressed Ctrl+S" — mark once here, not per retry attempt
    // (runSaveAction's internal recursion re-reads content but must not
    // re-mark timing on each busy retry).
    markViewerTiming("save-start", { path: p })
    const format = settings.general.formatOnSave()
    try {
      await runSaveAction({
        path: p,
        getContent: () => props.editorHandle?.getContent() ?? "",
        attempt: (path, content) => editorStore.save(path, content, format),
        applyDocEffect,
        // WHY: save() never throws (catches internally). A conflict/missing
        // result is already surfaced by the EditorBanner via the reactive
        // editorEntry — don't claim success here. REGRESSION FIX
        // 2026-06-27: an explicit "error" effect now surfaces a SaveFailed
        // toast so a silently-failed backend write (e.g. atomicWrite
        // post-rename mismatch from Windows FS caching) doesn't claim
        // success.
        onNonSuccess: (eff) => {
          if (eff.type === "error") {
            showToast({ variant: "error", title: language.t("toast.file.saveFailed") })
          }
        },
        onSuccess: async (finalContent, _sentContent, effect) => {
          if (effect.type !== "unchanged") await props.onSave(finalContent)
          showToast({ variant: "success", title: language.t("toast.file.saved") })
          // FORK (AutoExit-Edit-On-Save 2026-06-29): flip editing to false so
          // the viewer re-mounts and the editor (CM) unmounts. NOT done on
          // conflict/missing/error/busy above — banner must remain visible /
          // the retry must get a chance to run first.
          markViewerTiming("editing-false", { path: p })
          props.setEditing(false)
        },
        // FORK (C11): "busy" means nothing was attempted (another save, e.g.
        // autosave, was already in flight) — this is NOT a success. Wait for
        // the in-flight save to finish, then retry with the freshest CM
        // content (getContent() above is re-read on each retry) so no
        // keystrokes are silently dropped and the mode never exits on a
        // no-op save. maxRetries bounds the recursion — a "busy" result can
        // only mean another save just released or is about to; retrying
        // more than a couple times would indicate a pathological save loop.
        retry: { waitForSlot: waitForSaveSlot, retriesLeft: 2 },
      })
    } catch {
      showToast({ variant: "error", title: language.t("toast.file.saveFailed") })
    }
  }

  const handleReload = async () => {
    const p = props.path()
    if (!p) return
    try {
      const eff = await editorStore.reload(p)
      applyDocEffect(eff)
      // FORK (C1): reload() always resolves to {type:"set", content} on
      // success (or {type:"missing"} on failure) — never "none", so this is
      // the exact fresh disk content whenever present.
      await props.onReload(eff.type === "set" ? eff.content : undefined)
    } catch {
      showToast({ variant: "error", title: language.t("toast.file.reloadFailed") })
    }
  }

  const handleOverwrite = async () => {
    const p = props.path()
    if (!p) return
    try {
      await runSaveAction({
        path: p,
        getContent: () => props.editorHandle?.getContent() ?? "",
        // See handleCtrlS — also surface backend errors here, and don't
        // treat a "busy" no-op (another save raced in) as a resolved
        // conflict (C11). No `retry` here: unlike handleCtrlS, an overwrite
        // busy no-op does not retry — the user re-clicks "Overwrite disk".
        attempt: (path, content) => editorStore.resolveConflict(path, content, "overwrite"),
        applyDocEffect,
        // FORK (CORRECTIF F1): resolveConflict("overwrite") can return
        // "missing" (readRaw not-found) or "conflict" (disk changed again
        // between readRaw and the internal write) — neither is a success.
        // Falling through to onOverwrite/setEditing(false) would seed the
        // viewer with bytes never written to disk and unmount CodeMirror,
        // losing the unsaved buffer. The EditorBanner renders the
        // conflict/missing state reactively.
        onNonSuccess: (eff) => {
          if (eff.type === "error") {
            showToast({ variant: "error", title: language.t("toast.file.saveFailed") })
          }
        },
        onSuccess: async (finalContent) => {
          await props.onOverwrite(finalContent)
          // FORK (AutoExit-Edit-On-Save 2026-06-29): flip editing to false
          // so the viewer re-mounts after the user explicitly resolved the
          // conflict by overwriting disk. NOT done on non-success above.
          markViewerTiming("editing-false", { path: p })
          props.setEditing(false)
        },
      })
    } catch {
      showToast({ variant: "error", title: language.t("toast.file.saveFailed") })
    }
  }

  const handleDiscard = () => {
    const p = props.path()
    if (!p) return
    editorStore.close(p)
    props.setEditing(false)
    void props.onDiscard()
  }

  const handleRecreate = async () => {
    const p = props.path()
    if (!p) return
    const format = settings.general.formatOnSave()
    try {
      await runSaveAction({
        path: p,
        getContent: () => props.editorHandle?.getContent() ?? "",
        // See handleCtrlS — "busy" is a no-op, not a failure (C11). No
        // `retry` here, matching current behavior — the user re-clicks
        // "Recreate file".
        attempt: (path, content) => editorStore.recreate(path, content, format),
        applyDocEffect,
        // FORK (CORRECTIF F3): conflict/missing/error are all non-success —
        // a "none" from a caught exception, or a conflict/missing from the
        // internal write, must not seed the viewer with phantom content nor
        // claim a silent success.
        onNonSuccess: (eff) => {
          if (eff.type === "error") {
            showToast({ variant: "error", title: language.t("toast.file.saveFailed") })
          }
        },
        onSuccess: async (finalContent) => {
          // BUGFIX (found while wiring C1): props.onRecreate was declared
          // but never called — the viewer cache never refreshed after
          // recreating a file that had been deleted on disk, until some
          // unrelated trigger (e.g. a tab switch) forced a reload.
          await props.onRecreate(finalContent)
        },
      })
    } catch {
      showToast({ variant: "error", title: language.t("toast.file.saveFailed") })
    }
  }

  // Auto-enter edit mode when the file was opened via double-click.
  createEffect(() => {
    const p = props.path()
    if (!p || props.editing()) return
    if (!canEdit()) return
    if (consumeAutoEdit(p)) {
      void handleEnterEdit()
    }
  })

  // Auto-apply external reloads to the CM buffer when the watcher triggers
  // store.reload() on a clean entry (onExternalChange → clean → reload).
  // The `setContent` guard (doc === content → no-op) makes this idempotent.
  createEffect(() => {
    if (!showEditor()) return
    const entry = props.editorEntry()
    if (!entry) return
    if (entry.dirty || entry.stale || entry.saving || entry.conflict || entry.missing) return
    props.editorHandle?.setContent(entry.baseline.content)
  })

  // FORK (Phase 3.2): when status leaves "dirty" (manual save completed,
  // conflict surfaced, file went missing, or the tab is closing), cancel
  // any in-flight autosave timer — otherwise a save would fire 1s after
  // a conflict is on screen, masking the user-visible banner.
  createEffect(() => {
    const p = props.path()
    if (!p) return
    const entry = editorStore.get(p)
    if (!entry) return
    if (!entry.dirty) autosave.cancel(p)
  })

  return (
    <>
      {/* Pencil toggle — hidden for binary and large files (ADR-0005 §10).
          UX (review 2026-06-24 Sprint 3.1): always fully visible so users
          don't have to discover a hover-only control. */}
      <Show when={!props.editing() && canEdit() && props.path()}>
        <div class="absolute top-2 right-4 z-10">
          <IconButton
            icon="edit-small-2"
            variant="ghost"
            size="small"
            class="size-8 opacity-100 transition-opacity"
            onClick={handleEnterEdit}
            aria-label={language.t("editor.aria.edit")}
          />
        </div>
      </Show>

      {/* Sprint 3.1 — explicit Save button while editing (visible on
          every platform, including mobile/tablet where Ctrl+S is unavailable).
          Primary colour when dirty (actionable), ghost when clean (still
          allows force-save / autosave-toggle). */}
      <Show when={props.editing() && props.path()}>
        <div class="absolute top-2 right-4 z-10 flex items-center gap-2">
          <Show when={props.editorEntry()?.saving}>
            <span class="text-12-regular text-text-weak">{language.t("toast.file.saving")}</span>
          </Show>
          <button
            type="button"
            onClick={() => void handleCtrlS()}
            disabled={props.editorEntry()?.saving}
            data-testid="editor-save-button"
            aria-label={language.t("common.save")}
            title={language.t("common.save")}
            classList={{
              "h-8 w-8 flex items-center justify-center rounded-md border transition-colors": true,
              "border-accent bg-accent text-background": props.editorEntry()?.dirty,
              "border-border-base text-text-weak hover:text-text-base hover:bg-surface-base-hover": !props.editorEntry()?.dirty,
              "opacity-50 pointer-events-none": !!props.editorEntry()?.saving,
            }}
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
              <path
                d="M2.5 2h7L11.5 4v7.5a.5.5 0 0 1-.5.5H2.5a.5.5 0 0 1-.5-.5v-9a.5.5 0 0 1 .5-.5Z"
                stroke="currentColor"
                stroke-width="1.3"
                stroke-linejoin="round"
              />
              <path d="M4.5 2v3h4V2.6" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round" />
              <rect x="4.3" y="7.3" width="5.4" height="3.7" rx="0.3" stroke="currentColor" stroke-width="1.3" />
            </svg>
          </button>
        </div>
      </Show>

      {/* CM editor + conflict/stale/missing banners (ADR-0005 ⑥) */}
      <div class="cm-editor-banners">
        <Show when={props.editing()}>
          <Show when={props.editorEntry()} keyed>
            {(entry) => (
              <EditorBanner
                entry={entry}
                onReload={() => void handleReload()}
                onOverwrite={() => void handleOverwrite()}
                onDiscard={handleDiscard}
                onRecreate={() => void handleRecreate()}
              />
            )}
          </Show>
        </Show>
      </div>

      <Show when={showEditor()}>
        <Show when={props.path()} keyed>
          {(p) => (
            <Suspense>
              <CodeMirrorEditor
                path={p}
                initialContent={editorStore.get(p)?.baseline.content ?? ""}
                onChange={handleEditorChange}
                onSave={() => void handleCtrlS()}
                ref={(h) => {
                  props.setEditorHandle(h)
                }}
                lsp={props.lspCallbacks}
                onNavigate={props.onNavigate}
                onReferences={props.onReferences}
              />
            </Suspense>
          )}
        </Show>
      </Show>

      {/* Loading spinner while store.open() is in flight after entering edit mode */}
      <Show when={props.editing() && !showEditor() && !props.editorEntry()?.missing}>
        <div class="px-6 py-4 text-text-weak">{language.t("common.loading")}...</div>
      </Show>
    </>
  )
}