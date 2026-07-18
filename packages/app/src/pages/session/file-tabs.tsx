// File tabs orchestrator (PLAN-EDITEUR-IDE-DEFINITIF Phase 4.1).
//
// WHY orchestrator: file-tabs.tsx used to be a 494-LOC monolith mixing
// editor, viewer, scroll-sync, comments, keybindings, LSP wiring, and rename/
// code-action glue. After Phase 2.5 + 4.1 it is a thin composition layer:
// every responsibility is in a dedicated module (`scroll-content-sync`,
// `lsp-actions`, `comments-overlay`, `file-keybindings`, etc.) and this file
// only owns the cross-module wiring — path → state → contents, active-tab
// resolution, and the restore-scroll effect.

import { createEffect, createMemo, createSignal, Show } from "solid-js"
import { Dynamic } from "solid-js/web"
import type { FileSearchHandle } from "@opencode-ai/ui/file"
import { Tabs } from "@opencode-ai/ui/tabs"
import { useFile } from "@/context/file"
import { useSessionLayout } from "@/pages/session/session-layout"
import { createSessionTabs } from "@/pages/session/helpers"
// FORK: editor (ADR-0005)
import { useEditor } from "@/context/editor"
import { useSDK } from "@/context/sdk"
import type { CodeMirrorHandle } from "@opencode-ai/ui/code-mirror"
import type { LspCallbacks, LspLocation } from "@opencode-ai/ui/code-mirror-lsp"
import { createLspCallbacks } from "@/pages/session/lsp-handlers"
import { RenameDialog } from "@/pages/session/rename-dialog"
import { CodeActionsPanel } from "@/pages/session/code-actions-panel"
import { ReferencesPanel, uriToDisplayPath } from "@/pages/session/references-panel"
import { EditorPanel } from "@/pages/session/editor-panel"
import { ViewerPanel } from "@/pages/session/viewer-panel"
import { createCommentsOverlay } from "@/pages/session/comments-overlay"
import { installFileKeybindings } from "@/pages/session/file-keybindings"
import { requestAutoEdit as _requestAutoEdit } from "@/pages/session/auto-edit"
import { createScrollSync } from "@/pages/session/scroll-content-sync"
import { createLspActions } from "@/pages/session/lsp-actions"
import { markViewerTiming } from "@opencode-ai/util/viewer-timing"

// Re-export `requestAutoEdit` from auto-edit.ts so existing consumers
// (session-side-panel.tsx) keep their import path stable.
export const requestAutoEdit = _requestAutoEdit

// FORK: Stretch Phase 6 — `override` bypasses the Tabs.Content visibility
// system so the component can be shown in the split-pane right panel.
export function FileTabContent(props: { tab: string; override?: boolean }) {
  const file = useFile()
  const { tabs, view } = useSessionLayout()
  const activeFileTab = createSessionTabs({
    tabs,
    pathFromTab: file.pathFromTab,
    normalizeTab: (tab) => (tab.startsWith("file://") ? file.tab(tab) : tab),
  }).activeFileTab

  // FORK: editor state (ADR-0005) + Phase 2 LSP callbacks
  const sdk = useSDK()
  const editorStore = useEditor()
  const [editing, setEditing] = createSignal(false)
  const [editorHandle, setEditorHandle] = createSignal<CodeMirrorHandle | undefined>(undefined)

  const path = createMemo(() => file.pathFromTab(props.tab))
  const state = createMemo(() => {
    const p = path()
    if (!p) return
    return file.get(p)
  })
  const contents = createMemo(() => state()?.content?.content ?? "")

  // Reactive pointer to the store entry for this file (proxy — tracks fine-grained
  // property changes like `conflict`, `stale`, `missing` in JSX).
  const editorEntry = createMemo(() => {
    const p = path()
    if (!p) return undefined
    return editorStore.get(p)
  })

  // Editor action side-effects: refresh the read-mode cache after a write so
  // the viewer reflects the new bytes. EditorPanel handles save/reload/etc.;
  // these wrappers only coordinate the post-action file.load().
  //
  // FORK (PLAN-READONLY-VIEWER-REACTIVITY Phase 0 / cause C1): this
  // file.load({force:true}) is the suspected dominant source of
  // save→viewer-ready latency — it re-fetches from the backend (two SDK
  // calls internally) a file whose content editorStore.save() already wrote
  // into FileStore synchronously. refresh-sdk-start/-complete measure that
  // round-trip in isolation so Phase 2's fix can be justified by a real
  // number instead of a hunch.
  const refreshAfterEditor = async () => {
    const p = path()
    if (!p) return
    markViewerTiming("refresh-sdk-start", { path: p })
    await file.load(p, { force: true })
    markViewerTiming("refresh-sdk-complete", { path: p })
  }

  // LSP glue (rename + code actions) — owns its own signals + handlers. The
  // `confirmRename` / `applyCodeAction` closures call `editorHandle` to apply
  // WorkspaceEdit results; everything else (fetch, toast) is encapsulated.
  const lspActions = createLspActions({
    sdk,
    path,
    editorHandle,
  })

  // LSP callbacks (read-side, consumed by CodeMirror) — wired to the
  // write-side glue via prepareRename / triggerCodeAction.
  const lspCallbacks: LspCallbacks = createLspCallbacks(sdk, {
    prepareRename: (word, line, character) => lspActions.handlePrepareRename(word, line, character),
    triggerCodeAction: (line, character, endLine, endCharacter) =>
      void lspActions.handleTriggerCodeAction(line, character, endLine, endCharacter),
  })

  // Phase 2: go-to-definition — opens the target file in a new tab.
  const handleNavigate = (targetFile: string) => {
    void tabs().open(file.tab(targetFile))
  }

  // Stretch Phase 2: find-all-references (Shift+F12) — inline references panel.
  const [refLocations, setRefLocations] = createSignal<LspLocation[]>([])

  const handleReferences = (refs: LspLocation[]) => {
    setRefLocations(refs)
  }

  let find: FileSearchHandle | null = null

  const search = {
    register: (handle: FileSearchHandle | null) => {
      find = handle
    },
  }

  const scrollSync = createScrollSync({
    tab: () => props.tab,
    view,
  })

  // Comments overlay (Phase 2.5): line-comment controller + selection preview +
  // cross-file previews + path-reset effect + focus-open effect — all moved to
  // comments-overlay.tsx. Exposes the same surface (commentsUi, fileComments,
  // commentedLines, activeSelection) that ViewerPanel consumes.
  const commentsOverlay = createCommentsOverlay({
    path,
    contents,
    tab: props.tab,
    getFileSource: (p) => file.get(p)?.content?.content,
    setSelectedLines: (p, range) => file.setSelectedLines(p, range),
    editing,
    isActiveTab: () => (props.override ? true : activeFileTab() === props.tab),
  })

  // Tab keybindings (Phase 2.5): Ctrl+F focuses the search box, Ctrl+\ toggles
  // the split pane. Moved to file-keybindings.ts. Both handlers gate on the
  // active tab unless `override` (split-pane right panel).
  installFileKeybindings({
    tab: props.tab,
    override: props.override,
    editing,
    isActiveTab: () => (props.override ? true : activeFileTab() === props.tab),
    path,
    find: () => find,
    view,
  })

  let prev = {
    loaded: false,
    ready: false,
    active: false,
  }

  createEffect(() => {
    const loaded = !!state()?.loaded
    const ready = file.ready()
    const active = props.override ? true : activeFileTab() === props.tab
    const restore = (loaded && !prev.loaded) || (ready && !prev.ready) || (active && loaded && !prev.active)
    prev = { loaded, ready, active }
    if (!restore) return
    scrollSync.queueRestore()
  })

  // FORK: Stretch Phase 6 — When override=true (split-pane right panel) we
  // bypass Tabs.Content so the content is always visible. We use Dynamic to
  // avoid defining a component inside the function body (causes remounts).
  const tabsContentProps = () =>
    props.override
      ? { component: "div" as const, class: "mt-3 relative h-full overflow-auto" }
      : { component: Tabs.Content as any, value: props.tab, class: "mt-3 relative h-full" }

  return (
    <Dynamic {...tabsContentProps()}>
      {/* FORK: editor block (Phase 2.5) — extracted to editor-panel.tsx.
          Owns the pencil toggle, Save button, EditorBanner, CM mount, and
          loading spinner. Calls `refreshAfterEditor` (above) after a
          successful save/reload/overwrite/discard so the viewer cache stays
          in sync. */}
      <Show when={path()}>
        <EditorPanel
          path={path}
          contents={contents}
          state={state}
          editing={editing}
          setEditing={setEditing}
          editorEntry={editorEntry}
          editorHandle={editorHandle()}
          setEditorHandle={setEditorHandle}
          lspCallbacks={lspCallbacks}
          onNavigate={handleNavigate}
          onReferences={handleReferences}
          onSave={() => refreshAfterEditor()}
          onReload={() => refreshAfterEditor()}
          onOverwrite={() => refreshAfterEditor()}
          onDiscard={() => refreshAfterEditor()}
          onRecreate={() => refreshAfterEditor()}
        />
      </Show>

      {/* Stretch Phase 2: Code actions panel (Ctrl+.) */}
      <CodeActionsPanel
        actions={lspActions.codeActions}
        loading={lspActions.codeActionsLoading}
        onSelect={(action) => void lspActions.applyCodeAction(action)}
        onClose={lspActions.closeCodeActions}
      />

      {/* Stretch Phase 2: Rename dialog (F2) */}
      <RenameDialog
        state={lspActions.renameState}
        input={lspActions.renameInput}
        loading={lspActions.renameLoading}
        onInput={lspActions.setRenameInput}
        onConfirm={() => void lspActions.confirmRename()}
        onCancel={lspActions.cancelRename}
      />

      {/* Stretch Phase 2: References panel (Shift+F12) */}
      <ReferencesPanel
        locations={refLocations}
        onSelect={(loc) => handleNavigate(uriToDisplayPath(loc.uri))}
        onClose={() => setRefLocations([])}
      />
      {/* END FORK */}

      <Show when={!editing()}>
        <ViewerPanel
          path={path}
          state={state}
          contents={contents}
          scrollSync={scrollSync}
          commentsUi={commentsOverlay.commentsUi}
          search={search}
          activeSelection={commentsOverlay.activeSelection}
          commentedLines={commentsOverlay.commentedLines}
        />
      </Show>
    </Dynamic>
  )
}