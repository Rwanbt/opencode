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

import { createEffect, createMemo, lazy, Match, onCleanup, Show, Suspense, Switch } from "solid-js"
import { useEditor } from "@/context/editor"
import { useFileStore } from "@/context/file/store"
import { useLanguage } from "@/context/language"
import { useSettings } from "@/context/settings"
import { createAutosave } from "@/context/editor/autosave"
import { showToast } from "@opencode-ai/ui/toast"
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
  onSave: () => Promise<void>
  onReload: () => Promise<void>
  onOverwrite: () => Promise<void>
  onDiscard: () => void
  onRecreate: () => Promise<void>
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

  const handleCtrlS = async () => {
    const p = props.path()
    if (!p) return
    const content = props.editorHandle?.getContent() ?? ""
    const format = settings.general.formatOnSave()
    try {
      const eff = await editorStore.save(p, content, format)
      applyDocEffect(eff)
      // WHY: save() never throws (catches internally). A conflict/missing
      // result is already surfaced by the EditorBanner via the reactive
      // editorEntry — don't claim success here.
      if (eff.type === "conflict" || eff.type === "missing") return
      await props.onSave()
      showToast({ variant: "success", title: language.t("toast.file.saved") })
    } catch {
      showToast({ variant: "error", title: language.t("toast.file.saveFailed") })
    }
  }

  const handleReload = async () => {
    const p = props.path()
    if (!p) return
    try {
      applyDocEffect(await editorStore.reload(p))
      await props.onReload()
    } catch {
      showToast({ variant: "error", title: language.t("toast.file.reloadFailed") })
    }
  }

  const handleOverwrite = async () => {
    const p = props.path()
    if (!p) return
    const content = props.editorHandle?.getContent() ?? ""
    try {
      applyDocEffect(await editorStore.resolveConflict(p, content, "overwrite"))
      await props.onOverwrite()
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
    const content = props.editorHandle?.getContent() ?? ""
    const format = settings.general.formatOnSave()
    try {
      applyDocEffect(await editorStore.recreate(p, content, format))
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
            classList={{
              "h-8 px-3 inline-flex items-center gap-1.5 rounded-md text-12-medium border transition-colors": true,
              "border-accent bg-accent text-background": props.editorEntry()?.dirty,
              "border-border-base text-text-weak hover:text-text-base hover:bg-surface-base-hover": !props.editorEntry()?.dirty,
              "opacity-50 pointer-events-none": !!props.editorEntry()?.saving,
            }}
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
              <path d="M3 7.5L5.5 10L11 4" stroke="currentColor" stroke-width="1.6" stroke-linecap="square" />
            </svg>
            <span>{language.t("common.save")}</span>
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