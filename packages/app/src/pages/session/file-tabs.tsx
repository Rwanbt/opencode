import { createEffect, createMemo, createSignal, lazy, Match, onCleanup, Show, Suspense, Switch } from "solid-js"
import { Dynamic } from "solid-js/web"
import { makeEventListener } from "@solid-primitives/event-listener"
import type { FileSearchHandle } from "@opencode-ai/ui/file"
import { sampledChecksum } from "@opencode-ai/util/encode"
import { Tabs } from "@opencode-ai/ui/tabs"
import { showToast } from "@opencode-ai/ui/toast"
import { useFile, type SelectedLineRange } from "@/context/file"
import { getSessionHandoff } from "@/pages/session/handoff"
import { useSessionLayout } from "@/pages/session/session-layout"
import { createSessionTabs } from "@/pages/session/helpers"
// FORK: editor (ADR-0005)
import { useEditor } from "@/context/editor"
import { useSDK } from "@/context/sdk"
import type { CodeMirrorHandle } from "@opencode-ai/ui/code-mirror"
import type { LspCallbacks, LspLocation, LspCodeAction, LspWorkspaceEdit } from "@opencode-ai/ui/code-mirror-lsp"
import { applyTextEdits, createLspCallbacks, editsForFile } from "@/pages/session/lsp-handlers"
import { RenameDialog, type RenameState } from "@/pages/session/rename-dialog"
import { CodeActionsPanel, type CodeActionPos } from "@/pages/session/code-actions-panel"
import { ReferencesPanel, uriToDisplayPath } from "@/pages/session/references-panel"
import { EditorPanel } from "@/pages/session/editor-panel"
import { ViewerPanel } from "@/pages/session/viewer-panel"
import { createCommentsOverlay } from "@/pages/session/comments-overlay"
import { installFileKeybindings } from "@/pages/session/file-keybindings"
import { requestAutoEdit as _requestAutoEdit } from "@/pages/session/auto-edit"

// Lazy-load CodeMirror so the ~400 KB CM bundle is excluded from the initial
// chunk — only fetched when the user first enters edit mode.
const CodeMirrorEditor = lazy(() =>
  import("@opencode-ai/ui/code-mirror").then((m) => ({ default: m.CodeMirrorEditor })),
)

// Re-export `requestAutoEdit` from auto-edit.ts so existing consumers
// (session-side-panel.tsx) keep their import path stable.
export const requestAutoEdit = _requestAutoEdit

type ScrollPos = { x: number; y: number }

function createScrollSync(input: { tab: () => string; view: ReturnType<typeof useSessionLayout>["view"] }) {
  let scroll: HTMLDivElement | undefined
  let scrollFrame: number | undefined
  let restoreFrame: number | undefined
  let pending: ScrollPos | undefined
  const [code, setCode] = createSignal<HTMLElement[]>([])

  const getCode = () => {
    const el = scroll
    if (!el) return []

    const host = el.querySelector("diffs-container")
    if (!(host instanceof HTMLElement)) return []

    const root = host.shadowRoot
    if (!root) return []

    return Array.from(root.querySelectorAll("[data-code]")).filter(
      (node): node is HTMLElement => node instanceof HTMLElement && node.clientWidth > 0,
    )
  }

  const save = (next: ScrollPos) => {
    pending = next
    if (scrollFrame !== undefined) return

    scrollFrame = requestAnimationFrame(() => {
      scrollFrame = undefined

      const out = pending
      pending = undefined
      if (!out) return

      input.view().setScroll(input.tab(), out)
    })
  }

  const onCodeScroll = (event: Event) => {
    const el = scroll
    if (!el) return

    const target = event.currentTarget
    if (!(target instanceof HTMLElement)) return

    save({
      x: target.scrollLeft,
      y: el.scrollTop,
    })
  }

  const sync = () => {
    const next = getCode()
    const current = code()
    if (next.length === current.length && next.every((el, i) => el === current[i])) return
    setCode(next)
  }

  const restore = () => {
    const el = scroll
    if (!el) return

    const pos = input.view().scroll(input.tab())
    if (!pos) return

    sync()

    if (code().length > 0) {
      for (const item of code()) {
        if (item.scrollLeft !== pos.x) item.scrollLeft = pos.x
      }
    }

    if (el.scrollTop !== pos.y) el.scrollTop = pos.y
    if (code().length > 0) return
    if (el.scrollLeft !== pos.x) el.scrollLeft = pos.x
  }

  const queueRestore = () => {
    if (restoreFrame !== undefined) return

    restoreFrame = requestAnimationFrame(() => {
      restoreFrame = undefined
      restore()
    })
  }

  const handleScroll = (event: Event & { currentTarget: HTMLDivElement }) => {
    if (code().length === 0) sync()

    save({
      x: code()[0]?.scrollLeft ?? event.currentTarget.scrollLeft,
      y: event.currentTarget.scrollTop,
    })
  }

  createEffect(() => {
    for (const item of code()) makeEventListener(item, "scroll", onCodeScroll)
  })

  const setViewport = (el: HTMLDivElement) => {
    scroll = el
    restore()
  }

  onCleanup(() => {
    if (scrollFrame !== undefined) cancelAnimationFrame(scrollFrame)
    if (restoreFrame !== undefined) cancelAnimationFrame(restoreFrame)
  })

  return {
    handleScroll,
    queueRestore,
    setViewport,
  }
}

// FORK: Stretch Phase 6 — `override` bypasses the Tabs.Content visibility
// system so the component can be shown in the split-pane right panel.
export function FileTabContent(props: { tab: string; override?: boolean }) {
  const file = useFile()
  const { sessionKey, tabs, view } = useSessionLayout()
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

// LSP callbacks — stable reference, file path is passed per-call.
  const lspCallbacks: LspCallbacks = createLspCallbacks(sdk, {
    prepareRename: (word, line, character) => handlePrepareRename(word, line, character),
    triggerCodeAction: (line, character, endLine, endCharacter) =>
      void handleTriggerCodeAction(line, character, endLine, endCharacter),
  })

  // Phase 2: go-to-definition — opens the target file in a new tab.
  // Line-level scroll is deferred to Phase 3 (requires EditorHandle.scrollToLine).
  const handleNavigate = (targetFile: string) => {
    void tabs().open(file.tab(targetFile))
  }

  // Stretch Phase 2: find-all-references (Shift+F12) — inline references panel.
  const [refLocations, setRefLocations] = createSignal<LspLocation[]>([])

  const handleReferences = (refs: LspLocation[]) => {
    setRefLocations(refs)
  }

  // Stretch Phase 2: rename symbol (F2 → dialog → POST /lsp/rename → apply edits)
  const [renameState, setRenameState] = createSignal<RenameState | null>(null)
  const [renameInput, setRenameInput] = createSignal("")
  const [renameLoading, setRenameLoading] = createSignal(false)

  const handlePrepareRename = (word: string, line: number, character: number) => {
    setRenameState({ word, line, character })
    setRenameInput(word)
  }

  async function confirmRename() {
    const state = renameState()
    const newName = renameInput().trim()
    const p = path()
    if (!state || !newName || !p || newName === state.word) {
      setRenameState(null)
      return
    }
    setRenameLoading(true)
    try {
      const url = sdk.url
      const body = JSON.stringify({ file: p, line: state.line, character: state.character, newName })
      const res = await fetch(`${url}/lsp/rename`, { method: "POST", headers: { "Content-Type": "application/json" }, body })
      if (!res.ok) throw new Error(`${res.status}`)
      const edit = (await res.json()) as LspWorkspaceEdit
      const changes = edit.changes ?? {}

      // Apply edits to current file if present
      const currentEdits = editsForFile(edit, p)
      const handle = editorHandle()
      if (currentEdits?.length && handle) {
        const updated = applyTextEdits(handle.getContent(), currentEdits)
        handle.setContent(updated)
      }

      // Count affected files for toast
      const fileCount = Object.keys(changes).length
      showToast({
        variant: "success",
        title: `Renommé en "${newName}"`,
        description: fileCount > 1 ? `${fileCount} fichiers modifiés` : "Fichier courant mis à jour",
      })
    } catch (e) {
      showToast({ variant: "error", title: "Rename échoué", description: String(e) })
    } finally {
      setRenameLoading(false)
      setRenameState(null)
    }
  }

  // Stretch Phase 2: code actions (Ctrl+.)
  const [codeActions, setCodeActions] = createSignal<LspCodeAction[]>([])
  const [codeActionsLoading, setCodeActionsLoading] = createSignal(false)
  const [codeActionPos, setCodeActionPos] = createSignal<CodeActionPos | null>(null)

  const handleTriggerCodeAction = async (line: number, character: number, endLine: number, endCharacter: number) => {
    const p = path()
    if (!p) return
    setCodeActionPos({ line, character, endLine, endCharacter })
    setCodeActionsLoading(true)
    setCodeActions([])
    try {
      const url = sdk.url
      const body = JSON.stringify({ file: p, line, character, endLine, endCharacter })
      const res = await fetch(`${url}/lsp/code-action`, { method: "POST", headers: { "Content-Type": "application/json" }, body })
      if (!res.ok) return
      const actions = (await res.json()) as LspCodeAction[]
      setCodeActions(actions)
    } catch {
      // silent — no actions is valid
    } finally {
      setCodeActionsLoading(false)
    }
  }

  async function applyCodeAction(action: LspCodeAction) {
    const p = path()
    const pos = codeActionPos()
    if (!p || !pos) return

    setCodeActions([])

    // 1. Apply WorkspaceEdit if present
    if (action.edit?.changes) {
      const currentEdits = editsForFile(action.edit, p)
      const handle = editorHandle()
      if (currentEdits?.length && handle) {
        handle.setContent(applyTextEdits(handle.getContent(), currentEdits))
      }
      const fileCount = Object.keys(action.edit.changes).length
      if (fileCount > 1) {
        showToast({ variant: "success", title: action.title, description: `${fileCount} fichiers modifiés` })
      }
    }

    // 2. Execute command if present (after edit, per LSP spec)
    if (action.command?.command) {
      const url = sdk.url
      const body = JSON.stringify({
        file: p,
        line: pos.line,
        character: pos.character,
        command: action.command.command,
        commandArgs: action.command.arguments ?? [],
      })
      await fetch(`${url}/lsp/execute-command`, { method: "POST", headers: { "Content-Type": "application/json" }, body }).catch(() => null)
    }
  }

  const path = createMemo(() => file.pathFromTab(props.tab))
  const state = createMemo(() => {
    const p = path()
    if (!p) return
    return file.get(p)
  })
  const contents = createMemo(() => state()?.content?.content ?? "")
  const cacheKey = createMemo(() => sampledChecksum(contents()))
  // WHY: <Match when={state()?.loaded}>{renderFile(contents())}</Match> only
  // calls renderFile ONCE (when `loaded` flips false→true). When the
  // store's .content is mutated via produce() (e.g. on force-refetch),
  // the JSX is not re-rendered because the call to contents() inside
  // renderFile was captured at first render. viewerSource wraps the
  // content in a fresh object on every change, and the `keyed` prop
  // re-mounts the child whenever the object identity differs.
  const viewerSource = createMemo(() => {
    const s = state()
    if (!s?.loaded) return null
    return { content: s.content?.content ?? "" }
  })
  const selectedLines = createMemo<SelectedLineRange | null>(() => {
    const p = path()
    if (!p) return null
    if (file.ready()) return (file.selectedLines(p) as SelectedLineRange | undefined) ?? null
    return (getSessionHandoff(sessionKey())?.files[p] as SelectedLineRange | undefined) ?? null
  })

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
  // WHY force:true + WHY still here after Phase 2.4b/c/e: the FileStore IS
  // updated by editor.save()/reload()/etc. via the mirror added in 2.4c, and
  // the load() skip-when-clean gate now consults FileStore (2.4e). But the
  // viewer's RENDER path still reads `state()?.content?.content` from this
  // file.tsx local cache (file-tabs.tsx:307). Until the viewer subscribes to
  // FileStore directly (Phase 3+), the only way to refresh its render is a
  // force:true re-read here. Tracked as the last un-migrated consumer in
  // PLAN-EDITEUR-IDE-DEFINITIF.
  const refreshAfterEditor = async () => {
    const p = path()
    if (!p) return
    await file.load(p, { force: true })
  }
  // END FORK

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
    isActiveTab: () => props.override ? true : activeFileTab() === props.tab,
  })

  // Tab keybindings (Phase 2.5): Ctrl+F focuses the search box, Ctrl+\ toggles
  // the split pane. Moved to file-keybindings.ts. Both handlers gate on the
  // active tab unless `override` (split-pane right panel).
  installFileKeybindings({
    tab: props.tab,
    override: props.override,
    editing,
    isActiveTab: () => props.override ? true : activeFileTab() === props.tab,
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

  // WHY: source is a getter (() => string), not a value, so the JSX reads
  // it inside each render — when the store mutates .content via produce,
  // source() returns the new string and Solid re-evaluates the `contents`
  // expression in the Dynamic's file prop, which triggers a re-render of
  // the file component. A plain string value would be captured at first
  // render and never refresh.

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
        actions={codeActions}
        loading={codeActionsLoading}
        onSelect={(action) => void applyCodeAction(action)}
        onClose={() => setCodeActions([])}
      />

      {/* Stretch Phase 2: Rename dialog (F2) */}
      <RenameDialog
        state={renameState}
        input={renameInput}
        loading={renameLoading}
        onInput={setRenameInput}
        onConfirm={() => void confirmRename()}
        onCancel={() => setRenameState(null)}
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
