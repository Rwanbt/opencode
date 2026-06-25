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
import { EditorBanner } from "@/pages/session/editor-banner"

// Lazy-load CodeMirror so the ~400 KB CM bundle is excluded from the initial
// chunk — only fetched when the user first enters edit mode.
const CodeMirrorEditor = lazy(() =>
  import("@opencode-ai/ui/code-mirror").then((m) => ({ default: m.CodeMirrorEditor })),
)

// Paths that should auto-enter edit mode when their tab mounts (double-click).
const autoEditPaths = new Set<string>()
export function requestAutoEdit(path: string) {
  autoEditPaths.add(path)
}

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
  let editorHandle: CodeMirrorHandle | undefined

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

  function uriToDisplayPath(uri: string): string {
    const p = uri.startsWith("file://") ? decodeURIComponent(uri.slice(7).replace(/^\/([A-Z]:)/, "$1")) : uri
    return p.replace(/\\/g, "/")
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
      if (currentEdits?.length && editorHandle) {
        const updated = applyTextEdits(editorHandle.getContent(), currentEdits)
        editorHandle.setContent(updated)
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
  type CodeActionPos = { line: number; character: number; endLine: number; endCharacter: number }
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
      if (currentEdits?.length && editorHandle) {
        editorHandle.setContent(applyTextEdits(editorHandle.getContent(), currentEdits))
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

  // Guard: hide the pencil for binary files (NUL bytes) and files over 1 MB.
  const canEdit = createMemo(() => {
    if (!state()?.loaded) return false
    const text = contents()
    if (text.length > 1_000_000) return false
    if (text.includes("\0")) return false
    return true
  })

  // Derived: true once the editor store entry is ready (after open() resolves).
  // Also false when the file is missing so the CM panel is not shown.
  const showEditor = createMemo(() => {
    if (!editing()) return false
    const p = path()
    if (!p) return false
    const entry = editorStore.get(p)
    return entry !== undefined && !entry.missing
  })

  const handleEnterEdit = async () => {
    const p = path()
    if (!p) return
    setEditing(true)
    try {
      // Use ?? not ||: a brand-new empty file has contents() === "" which is
      // falsy but a valid fallback. The store's readRaw() will succeed on the
      // empty file; if it fails (race with the filesystem watcher) the "" seed
      // lets the editor open immediately instead of showing a false
      // "this file was deleted" banner.
      await editorStore.open(p, contents() ?? undefined)
    } catch {
      setEditing(false)
      showToast({ variant: "error", title: language.t("toast.file.openFailed") })
    }
  }

  // Called by CM on every user keystroke: update dirty state.
  // NOT inside a createEffect — runs imperatively in CM's updateListener.
  const handleEditorChange = (content: string) => {
    const p = path()
    if (!p) return
    const entry = editorStore.get(p)
    if (!entry) return
    editorStore.setDirty(p, content !== entry.baseline.content)
  }

  const applyDocEffect = (eff: { type: string; content?: string }) => {
    if (eff.type === "set" && eff.content !== undefined) {
      editorHandle?.setContent(eff.content)
    }
  }

  const handleCtrlS = async () => {
    const p = path()
    if (!p) return
    const content = editorHandle?.getContent() ?? ""
    const format = settings.general.autoSave()
    try {
      const eff = await editorStore.save(p, content, format)
      applyDocEffect(eff)
      // WHY: save() never throws (catches internally). A conflict/missing
      // result is already surfaced by the EditorBanner via the reactive
      // editorEntry — don't claim success here.
      if (eff.type === "conflict" || eff.type === "missing") return
      // Refresh the read-only cache so a close+reopen shows the saved
      // content (otherwise `load()` skips refetch because `loaded: true`,
      // see file.tsx:167).
      await file.load(p, { force: true })
      showToast({ variant: "success", title: language.t("toast.file.saved") })
    } catch {
      showToast({ variant: "error", title: language.t("toast.file.saveFailed") })
    }
  }

  const handleReload = async () => {
    const p = path()
    if (!p) return
    try {
      applyDocEffect(await editorStore.reload(p))
    } catch {
      showToast({ variant: "error", title: language.t("toast.file.reloadFailed") })
    }
  }

  const handleOverwrite = async () => {
    const p = path()
    if (!p) return
    const content = editorHandle?.getContent() ?? ""
    try {
      applyDocEffect(await editorStore.resolveConflict(p, content, "overwrite"))
    } catch {
      showToast({ variant: "error", title: language.t("toast.file.saveFailed") })
    }
  }

  const handleDiscard = () => {
    const p = path()
    if (!p) return
    editorStore.close(p)
    setEditing(false)
    // Refresh the read-only cache so the user sees the actual on-disk
    // content (in case the file was changed externally during the edit
    // session). Defense-in-depth vs. the handleCtrlS refresh.
    void file.load(p, { force: true })
  }

  const handleRecreate = async () => {
    const p = path()
    if (!p) return
    const content = editorHandle?.getContent() ?? ""
    const format = settings.general.autoSave()
    try {
      applyDocEffect(await editorStore.recreate(p, content, format))
    } catch {
      showToast({ variant: "error", title: language.t("toast.file.saveFailed") })
    }
  }

  // Auto-enter edit mode when the file was opened via double-click.
  createEffect(() => {
    const p = path()
    if (!p || editing()) return
    if (!canEdit()) return
    if (autoEditPaths.has(p)) {
      autoEditPaths.delete(p)
      void handleEnterEdit()
    }
  })

  // Auto-apply external reloads to the CM buffer when the watcher triggers
  // store.reload() on a clean entry (onExternalChange → clean → reload).
  // The `setContent` guard (doc === content → no-op) makes this idempotent.
  createEffect(() => {
    if (!showEditor()) return
    const entry = editorEntry()
    if (!entry) return
    // Only apply when the buffer is clean (no pending dirty/stale/saving/conflict).
    // A dirty buffer is never touched by the watcher — it sets `stale` instead.
    if (entry.dirty || entry.stale || entry.saving || entry.conflict || entry.missing) return
    editorHandle?.setContent(entry.baseline.content)
  })
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
      {/* FORK: edit-mode pencil toggle — hidden for binary and large files (ADR-0005 §10).
          UX (review 2026-06-24 Sprint 3.1): always fully visible so users
          don't have to discover a hover-only control. The Save button appears
          next to it once the editor is mounted and there are unsaved changes. */}
      <Show when={!editing() && canEdit() && path()}>
        <div class="absolute top-2 right-4 z-10">
          <IconButton
            icon="edit-small-2"
            variant="ghost"
            size="small"
            class="size-8 opacity-100 transition-opacity"
            onClick={handleEnterEdit}
            aria-label="Edit file"
          />
        </div>
      </Show>

      {/* FORK: Sprint 3.1 — explicit Save button while editing (visible on
          every platform, including mobile/tablet where Ctrl+S is unavailable).
          Primary colour when dirty (actionable), ghost when clean (still
          allows force-save / autosave-toggle). */}
      <Show when={editing() && path()}>
        <div class="absolute top-2 right-4 z-10 flex items-center gap-2">
          <Show when={editorEntry()?.saving}>
            <span class="text-12-regular text-text-weak">{language.t("toast.file.saving")}</span>
          </Show>
          <button
            type="button"
            onClick={() => void handleCtrlS()}
            disabled={editorEntry()?.saving}
            data-testid="editor-save-button"
            aria-label={language.t("common.save")}
            classList={{
              "h-8 px-3 inline-flex items-center gap-1.5 rounded-md text-12-medium border transition-colors": true,
              "border-accent bg-accent text-background": editorEntry()?.dirty,
              "border-border-base text-text-weak hover:text-text-base hover:bg-surface-base-hover": !editorEntry()?.dirty,
              "opacity-50 pointer-events-none": !!editorEntry()?.saving,
            }}
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
              <path d="M3 7.5L5.5 10L11 4" stroke="currentColor" stroke-width="1.6" stroke-linecap="square" />
            </svg>
            <span>{language.t("common.save")}</span>
          </button>
        </div>
      </Show>

      {/* FORK: CM editor + conflict/stale/missing banners (ADR-0005 ⑥) */}
      <div class="cm-editor-banners">
        <Show when={editing()}>
          <Show when={editorEntry()} keyed>
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
        <Show when={path()} keyed>
          {(p) => (
            <Suspense>
              <CodeMirrorEditor
                path={p}
                initialContent={editorStore.get(p)?.baseline.content ?? ""}
                onChange={handleEditorChange}
                onSave={() => void handleCtrlS()}
                ref={(h) => {
                  editorHandle = h
                }}
                lsp={lspCallbacks}
                onNavigate={handleNavigate}
                onReferences={handleReferences}
              />
            </Suspense>
          )}
        </Show>
      </Show>

      {/* Loading spinner while store.open() is in flight after entering edit mode */}
      <Show when={editing() && !showEditor() && !editorEntry()?.missing}>
        <div class="px-6 py-4 text-text-weak">{language.t("common.loading")}...</div>
      </Show>

      {/* Stretch Phase 2: Code actions panel (Ctrl+.) */}
      <Show when={codeActionsLoading() || codeActions().length > 0}>
        <div class="border-t border-border-weak-base bg-background-stronger shrink-0">
          <div class="flex items-center gap-2 px-3 py-1 sticky top-0 bg-background-stronger border-b border-border-weak-base">
            <span class="text-11-regular text-text-weaker flex-1">Actions ({codeActionsLoading() ? "…" : codeActions().length})</span>
            <button type="button" onClick={() => setCodeActions([])} class="text-10-regular text-text-weaker hover:text-text-base px-1">✕</button>
          </div>
          <div class="max-h-48 overflow-y-auto">
            <Show when={codeActionsLoading()}>
              <p class="text-11-regular text-text-weaker px-3 py-2">Chargement…</p>
            </Show>
            <For each={codeActions()}>
              {(action) => (
                <button
                  type="button"
                  onClick={() => void applyCodeAction(action)}
                  class="w-full text-left px-3 py-1.5 flex items-center gap-2 hover:bg-surface-hover"
                >
                  <Show when={action.isPreferred}>
                    <span class="text-accent-primary text-10-regular shrink-0">✦</span>
                  </Show>
                  <span class="text-12-regular text-text-base flex-1 truncate">{action.title}</span>
                  <Show when={action.kind}>
                    <span class="text-10-regular text-text-weakest shrink-0">{action.kind}</span>
                  </Show>
                </button>
              )}
            </For>
          </div>
        </div>
      </Show>

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
      <Show when={refLocations().length > 0}>
        <div class="border-t border-border-weak-base bg-background-stronger flex flex-col max-h-48 overflow-y-auto shrink-0">
          <div class="flex items-center justify-between px-3 py-1.5 border-b border-border-weak-base sticky top-0 bg-background-stronger z-10">
            <span class="text-11-regular text-text-weaker uppercase tracking-wide">
              Références ({refLocations().length})
            </span>
            <button
              type="button"
              onClick={() => setRefLocations([])}
              class="text-10-regular text-text-weaker hover:text-text-base px-1"
            >
              ✕
            </button>
          </div>
          <For each={refLocations()}>
            {(loc) => {
              const displayPath = uriToDisplayPath(loc.uri)
              const short = displayPath.split("/").slice(-2).join("/")
              return (
                <button
                  type="button"
                  class="flex items-center gap-2 px-3 py-1 hover:bg-surface-base text-left w-full"
                  onClick={() => handleNavigate(displayPath)}
                >
                  <span class="text-11-regular text-text-base truncate flex-1 font-mono">{short}</span>
                  <span class="text-10-regular text-text-weaker shrink-0">
                    :{loc.range.start.line + 1}:{loc.range.start.character + 1}
                  </span>
                </button>
              )
            }}
          </For>
        </div>
      </Show>
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
