import { createEffect, createMemo, createSignal, For, lazy, Match, on, onCleanup, Show, Suspense, Switch } from "solid-js"
import { createStore } from "solid-js/store"
import { Dynamic } from "solid-js/web"
import { makeEventListener } from "@solid-primitives/event-listener"
import type { FileSearchHandle } from "@opencode-ai/ui/file"
import { useFileComponent } from "@opencode-ai/ui/context/file"
import { cloneSelectedLineRange, previewSelectedLines } from "@opencode-ai/ui/pierre/selection-bridge"
import { createLineCommentController } from "@opencode-ai/ui/line-comment-annotations"
import { sampledChecksum } from "@opencode-ai/util/encode"
import { DropdownMenu } from "@opencode-ai/ui/dropdown-menu"
import { IconButton } from "@opencode-ai/ui/icon-button"
import { Tabs } from "@opencode-ai/ui/tabs"
import { ScrollView } from "@opencode-ai/ui/scroll-view"
import { showToast } from "@opencode-ai/ui/toast"
import { selectionFromLines, useFile, type FileSelection, type SelectedLineRange } from "@/context/file"
import { useComments } from "@/context/comments"
import { useLanguage } from "@/context/language"
import { usePrompt } from "@/context/prompt"
import { getSessionHandoff } from "@/pages/session/handoff"
import { useSessionLayout } from "@/pages/session/session-layout"
import { createSessionTabs } from "@/pages/session/helpers"
// FORK: editor (ADR-0005)
import { useEditor } from "@/context/editor"
import { useSettings } from "@/context/settings"
import { useSDK } from "@/context/sdk"
import type { CodeMirrorHandle } from "@opencode-ai/ui/code-mirror"
import type { LspCallbacks, LspLocation, LspCodeAction, LspWorkspaceEdit } from "@opencode-ai/ui/code-mirror-lsp"
import { applyTextEdits, createLspCallbacks, editsForFile } from "@/pages/session/lsp-handlers"
import { RenameDialog, type RenameState } from "@/pages/session/rename-dialog"
import { CodeActionsPanel, type CodeActionPos } from "@/pages/session/code-actions-panel"
import { ReferencesPanel, uriToDisplayPath } from "@/pages/session/references-panel"
import { EditorPanel } from "@/pages/session/editor-panel"
import { requestAutoEdit as _requestAutoEdit } from "@/pages/session/auto-edit"
import { EditorBanner } from "@/pages/session/editor-banner"

// Lazy-load CodeMirror so the ~400 KB CM bundle is excluded from the initial
// chunk — only fetched when the user first enters edit mode.
const CodeMirrorEditor = lazy(() =>
  import("@opencode-ai/ui/code-mirror").then((m) => ({ default: m.CodeMirrorEditor })),
)

// Re-export `requestAutoEdit` from auto-edit.ts so existing consumers
// (session-side-panel.tsx) keep their import path stable.
export const requestAutoEdit = _requestAutoEdit

function FileCommentMenu(props: {
  moreLabel: string
  editLabel: string
  deleteLabel: string
  onEdit: VoidFunction
  onDelete: VoidFunction
}) {
  return (
    <div onMouseDown={(event) => event.stopPropagation()} onClick={(event) => event.stopPropagation()}>
      <DropdownMenu gutter={4} placement="bottom-end">
        <DropdownMenu.Trigger
          as={IconButton}
          icon="dot-grid"
          variant="ghost"
          size="small"
          class="size-6 rounded-md"
          aria-label={props.moreLabel}
        />
        <DropdownMenu.Portal>
          <DropdownMenu.Content>
            <DropdownMenu.Item onSelect={props.onEdit}>
              <DropdownMenu.ItemLabel>{props.editLabel}</DropdownMenu.ItemLabel>
            </DropdownMenu.Item>
            <DropdownMenu.Item onSelect={props.onDelete}>
              <DropdownMenu.ItemLabel>{props.deleteLabel}</DropdownMenu.ItemLabel>
            </DropdownMenu.Item>
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu>
    </div>
  )
}

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
  const comments = useComments()
  const language = useLanguage()
  const prompt = usePrompt()
  const fileComponent = useFileComponent()
  const { sessionKey, tabs, view } = useSessionLayout()
  const activeFileTab = createSessionTabs({
    tabs,
    pathFromTab: file.pathFromTab,
    normalizeTab: (tab) => (tab.startsWith("file://") ? file.tab(tab) : tab),
  }).activeFileTab

  // FORK: editor state (ADR-0005) + Phase 2 LSP callbacks
  const sdk = useSDK()
  const editorStore = useEditor()
  const settings = useSettings()
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
  // WHY force:true: file.load() has a silent-skip when `loaded: true`
  // (file.tsx:167). Without the force, the viewer's content stays stale
  // until the next close+reopen. Tracked in PLAN-EDITEUR-IDE-DEFINITIF
  // (Phase 2.4f removes these calls once FileStore handles refresh internally).
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

  const selectionPreview = (source: string, selection: FileSelection) => {
    return previewSelectedLines(source, {
      start: selection.startLine,
      end: selection.endLine,
    })
  }

  const buildPreview = (filePath: string, selection: FileSelection) => {
    const source = filePath === path() ? contents() : file.get(filePath)?.content?.content
    if (!source) return undefined
    return selectionPreview(source, selection)
  }

  const addCommentToContext = (input: {
    file: string
    selection: SelectedLineRange
    comment: string
    preview?: string
    origin?: "review" | "file"
  }) => {
    const selection = selectionFromLines(input.selection)
    const preview = input.preview ?? buildPreview(input.file, selection)

    const saved = comments.add({
      file: input.file,
      selection: input.selection,
      comment: input.comment,
    })
    prompt.context.add({
      type: "file",
      path: input.file,
      selection,
      comment: input.comment,
      commentID: saved.id,
      commentOrigin: input.origin,
      preview,
    })
  }

  const updateCommentInContext = (input: {
    id: string
    file: string
    selection: SelectedLineRange
    comment: string
  }) => {
    comments.update(input.file, input.id, input.comment)
    const preview = input.file === path() ? buildPreview(input.file, selectionFromLines(input.selection)) : undefined
    prompt.context.updateComment(input.file, input.id, {
      comment: input.comment,
      ...(preview ? { preview } : {}),
    })
  }

  const removeCommentFromContext = (input: { id: string; file: string }) => {
    comments.remove(input.file, input.id)
    prompt.context.removeComment(input.file, input.id)
  }

  const fileComments = createMemo(() => {
    const p = path()
    if (!p) return []
    return comments.list(p)
  })

  const commentedLines = createMemo(() => fileComments().map((comment) => comment.selection))

  const [note, setNote] = createStore({
    openedComment: null as string | null,
    commenting: null as SelectedLineRange | null,
    selected: null as SelectedLineRange | null,
  })

  const syncSelected = (range: SelectedLineRange | null) => {
    const p = path()
    if (!p) return
    file.setSelectedLines(p, range ? cloneSelectedLineRange(range) : null)
  }

  const activeSelection = () => note.selected ?? selectedLines()

  const commentsUi = createLineCommentController({
    comments: fileComments,
    label: language.t("ui.lineComment.submit"),
    draftKey: () => path() ?? props.tab,
    mention: {
      items: file.searchFilesAndDirectories,
    },
    state: {
      opened: () => note.openedComment,
      setOpened: (id) => setNote("openedComment", id),
      selected: () => note.selected,
      setSelected: (range) => setNote("selected", range),
      commenting: () => note.commenting,
      setCommenting: (range) => setNote("commenting", range),
      syncSelected,
      hoverSelected: syncSelected,
    },
    getHoverSelectedRange: activeSelection,
    cancelDraftOnCommentToggle: true,
    clearSelectionOnSelectionEndNull: true,
    onSubmit: ({ comment, selection }) => {
      const p = path()
      if (!p) return
      addCommentToContext({ file: p, selection, comment, origin: "file" })
    },
    onUpdate: ({ id, comment, selection }) => {
      const p = path()
      if (!p) return
      updateCommentInContext({ id, file: p, selection, comment })
    },
    onDelete: (comment) => {
      const p = path()
      if (!p) return
      removeCommentFromContext({ id: comment.id, file: p })
    },
    editSubmitLabel: language.t("common.save"),
    renderCommentActions: (_, controls) => (
      <FileCommentMenu
        moreLabel={language.t("common.moreOptions")}
        editLabel={language.t("common.edit")}
        deleteLabel={language.t("common.delete")}
        onEdit={controls.edit}
        onDelete={controls.remove}
      />
    ),
  })

  createEffect(() => {
    if (typeof window === "undefined") return

    const onKeyDown = (event: KeyboardEvent) => {
      if (!props.override && activeFileTab() !== props.tab) return
      if (!(event.metaKey || event.ctrlKey) || event.altKey || event.shiftKey) return
      if (event.key.toLowerCase() !== "f") return
      // FORK: in edit mode CM's searchKeymap handles Ctrl+F itself — let the
      // event propagate down to the CM editor element instead of intercepting.
      if (editing()) return
      // END FORK
      event.preventDefault()
      event.stopPropagation()
      find?.focus()
    }

    makeEventListener(window, "keydown", onKeyDown, { capture: true })
  })

  // FORK: Stretch Phase 6 — Ctrl+\ toggles split pane for the active tab
  createEffect(() => {
    if (typeof window === "undefined") return
    const onSplitKey = (event: KeyboardEvent) => {
      if (!props.override && activeFileTab() !== props.tab) return
      if (!(event.ctrlKey || event.metaKey) || event.key !== "\\") return
      event.preventDefault()
      event.stopPropagation()
      const splitView = view().editorSplit
      if (splitView.tab()) {
        splitView.close()
      } else {
        const p = path()
        if (p) splitView.open(props.tab)
      }
    }
    makeEventListener(window, "keydown", onSplitKey, { capture: true })
  })

  createEffect(
    on(
      path,
      () => {
        commentsUi.note.reset()
      },
      { defer: true },
    ),
  )

  createEffect(() => {
    const focus = comments.focus()
    const p = path()
    if (!focus || !p) return
    if (focus.file !== p) return
    if (!props.override && activeFileTab() !== props.tab) return

    const target = fileComments().find((comment) => comment.id === focus.id)
    if (!target) return

    commentsUi.note.openComment(target.id, target.selection, { cancelDraft: true })
    requestAnimationFrame(() => comments.clearFocus())
  })

  const _cancelCommenting = () => {
    const p = path()
    if (p) file.setSelectedLines(p, null)
    setNote("commenting", null)
  }

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
  const renderFile = (source: () => string) => (
    <div class="relative overflow-hidden pb-40">
      <Dynamic
        component={fileComponent}
        mode="text"
        file={{
          name: path() ?? "",
          contents: source(),
          cacheKey: source().length,
        }}
        enableLineSelection
        enableHoverUtility
        selectedLines={activeSelection()}
        commentedLines={commentedLines()}
        onRendered={() => {
          scrollSync.queueRestore()
        }}
        annotations={commentsUi.annotations()}
        renderAnnotation={commentsUi.renderAnnotation}
        renderHoverUtility={commentsUi.renderHoverUtility}
        onLineSelected={(range: SelectedLineRange | null) => {
          commentsUi.onLineSelected(range)
        }}
        onLineNumberSelectionEnd={commentsUi.onLineNumberSelectionEnd}
        onLineSelectionEnd={(range: SelectedLineRange | null) => {
          commentsUi.onLineSelectionEnd(range)
        }}
        search={search}
        class="select-text"
        media={{
          mode: "auto",
          path: path(),
          current: state()?.content,
          onLoad: scrollSync.queueRestore,
          onError: (args: { kind: "image" | "audio" | "svg" }) => {
            if (args.kind !== "svg") return
            showToast({
              variant: "error",
              title: language.t("toast.file.loadFailed.title"),
            })
          },
        }}
      />
    </div>
  )

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
        <ScrollView class="h-full" viewportRef={scrollSync.setViewport} onScroll={scrollSync.handleScroll as any}>
          <Switch>
            <Match when={state()?.loaded}>{renderFile(() => contents())}</Match>
            <Match when={state()?.loading}>
              <div class="px-6 py-4 text-text-weak">{language.t("common.loading")}...</div>
            </Match>
            <Match when={state()?.error}>{(err) => <div class="px-6 py-4 text-text-weak">{err()}</div>}</Match>
          </Switch>
        </ScrollView>
      </Show>
    </Dynamic>
  )
}
