import { For, Match, Show, Switch, createEffect, createMemo, createSignal, onCleanup, type JSX } from "solid-js"
import { createStore } from "solid-js/store"
import { Tabs } from "@unifia/ui/tabs"
import { Button } from "@unifia/ui/button"
import { IconButton } from "@unifia/ui/icon-button"
import { TooltipKeybind } from "@unifia/ui/tooltip"
import { Separator } from "@/primitives/separator"
import { Mark } from "@unifia/ui/logo"
import { InspectorFrame } from "@/shell/v110-inspector-frame"
import { DragDropProvider, DragDropSensors, DragOverlay, SortableProvider, closestCenter } from "@thisbeyond/solid-dnd"
import type { DragEvent } from "@thisbeyond/solid-dnd"
import type { FileDiff } from "../../types/sdk-shim"
import { ConstrainDragYAxis, getDraggableId } from "@/utils/solid-dnd"
import { useDialog } from "@unifia/ui/context/dialog"

import { DropdownMenu } from "@unifia/ui/dropdown-menu"
import { showToast } from "@unifia/ui/toast"
import type { FileNode } from "../../types/sdk-shim"
import FileTree from "@/components/file-tree"
import { requestAutoEdit } from "@/pages/session/file-tabs"
import { SourceControl } from "@/components/source-control"
import { TaskPanel } from "@/components/task-panel"
import { SettingsObservabilityTimeline } from "@/components/settings-observability-timeline"
import { MemoryPanel } from "@/pages/session/memory-panel"
import { SessionContextUsage } from "@/components/session-context-usage"
import { SessionContextTab, SortableTab, FileVisual } from "@/components/session"
import { useCommand } from "@/context/command"
import { useFile, type SelectedLineRange } from "@/context/file"
import { createFileOpDeps } from "@/context/file/operations"
import { useEditorCloseGuard } from "@/context/editor/close-guard"
import { useLanguage } from "@/context/language"
import { useLayout } from "@/context/layout"
import { useSDK } from "@/context/sdk"
import { useTerminal } from "@/context/terminal"
import { createFileTabListSync } from "@/pages/session/file-tab-scroll"
import { FileTabContent } from "@/pages/session/file-tabs"
import { createOpenSessionFileTab, createSessionTabs, getTabReorderIndex, type Sizing } from "@/pages/session/helpers"
import { setSessionHandoff } from "@/pages/session/handoff"
import { useSessionLayout } from "@/pages/session/session-layout"
import { useShell, useViewport } from "@/shell/v110-store"

export function SessionSidePanel(props: {
  canReview: () => boolean
  diffs: () => FileDiff[]
  diffsReady: () => boolean
  empty: () => string
  hasReview: () => boolean
  reviewCount: () => number
  reviewPanel: () => JSX.Element
  activeDiff?: string
  focusReviewDiff: (path: string) => void
  reviewSnap: boolean
  size: Sizing
  sessionId?: string
}) {
  const layout = useLayout()
  const guard = useEditorCloseGuard()
  const file = useFile()
  const language = useLanguage()
  const command = useCommand()
  const dialog = useDialog()
  const sdk = useSDK()
  const terminal = useTerminal()
  const { sessionKey, tabs, view } = useSessionLayout()

  const shell = useShell(useViewport())
  const isOverlay = createMemo(() => shell.kind() === "overlay")

  // Explorer/Execution are narrow browsing panels (the old file-tree pane's
  // resizable width); Inspector holds opened files/diffs and needs the old
  // review pane's wide content width (100% minus the chat column) instead.
  const panelWidth = createMemo(() => {
    if (!layout.inspector.opened()) return "0px"
    if (layout.inspector.tab() === "inspector") return `calc(100% - ${layout.session.width()}px)`
    return `${layout.inspector.width()}px`
  })

  // RESPONSIVE-MATRIX.md desktop-compact invariant: opening the left panel
  // closes the Inspector and inversely (single-utility side, per the A1
  // viewport contract's exclusive()). One inspector pane now (v110
  // InspectorFrame), so this collapses to one pair of effects on the
  // shared opened() flag instead of two panes' worth.
  createEffect(() => {
    if (!shell.single()) return
    if (!layout.sidebar.opened()) return
    if (layout.inspector.opened()) layout.inspector.close()
  })
  createEffect(() => {
    if (!shell.single()) return
    if (!layout.inspector.opened()) return
    if (layout.sidebar.opened()) layout.sidebar.close()
  })

  const diffFiles = createMemo(() => props.diffs().map((d) => d.file))
  const kinds = createMemo(() => {
    const merge = (a: "add" | "del" | "mix" | undefined, b: "add" | "del" | "mix") => {
      if (!a) return b
      if (a === b) return a
      return "mix" as const
    }

    const normalize = (p: string) => p.replaceAll("\\\\", "/").replace(/\/+$/, "")

    const out = new Map<string, "add" | "del" | "mix">()
    for (const diff of props.diffs()) {
      const file = normalize(diff.file)
      const kind = diff.status === "added" ? "add" : diff.status === "deleted" ? "del" : "mix"

      out.set(file, kind)

      const parts = file.split("/")
      for (const [idx] of parts.slice(0, -1).entries()) {
        const dir = parts.slice(0, idx + 1).join("/")
        if (!dir) continue
        out.set(dir, merge(out.get(dir), kind))
      }
    }
    return out
  })

  const empty = (msg: string) => (
    <div class="h-full flex flex-col">
      <div class="h-6 shrink-0" aria-hidden />
      <div class="flex-1 pb-64 flex items-center justify-center text-center">
        <div class="text-12-regular text-text-weak">{msg}</div>
      </div>
    </div>
  )

  const nofiles = createMemo(() => {
    const state = file.tree.state("")
    if (!state?.loaded) return false
    return file.tree.children("").length === 0
  })

  const normalizeTab = (tab: string) => {
    if (!tab.startsWith("file://")) return tab
    return file.tab(tab)
  }

  const openReviewPanel = () => {
    layout.inspector.setTab("inspector")
    if (!layout.inspector.opened()) layout.inspector.open()
  }

  const openTab = createOpenSessionFileTab({
    normalizeTab,
    openTab: tabs().open,
    pathFromTab: file.pathFromTab,
    loadFile: file.load,
    openReviewPanel,
    setActive: tabs().setActive,
  })

  const tabState = createSessionTabs({
    tabs,
    pathFromTab: file.pathFromTab,
    normalizeTab,
    review: () => true,
    hasReview: props.canReview,
  })
  const contextOpen = tabState.contextOpen
  const openedTabs = tabState.openedTabs
  const activeTab = tabState.activeTab
  const activeFileTab = tabState.activeFileTab

  const handleNewFile = (parentDir: string) => {
    void import("@/components/dialog-file-create").then((x) => {
      dialog.show(() => (
        <x.DialogFileCreate
          mode="file"
          parentDir={parentDir}
          deps={createFileOpDeps(sdk, file)}
          onCreated={(path) => openTab(file.tab(path))}
        />
      ))
    })
  }

  const handleNewFolder = (parentDir: string) => {
    void import("@/components/dialog-file-create").then((x) => {
      dialog.show(() => <x.DialogFileCreate mode="folder" parentDir={parentDir} deps={createFileOpDeps(sdk, file)} />)
    })
  }

  const handleRename = (node: FileNode) => {
    void import("@/components/dialog-file-rename").then((x) => {
      dialog.show(() => (
        <x.DialogFileRename
          node={node}
          deps={createFileOpDeps(sdk, file)}
          onRenamed={(oldPath, newPath) => {
            tabs().close(file.tab(oldPath))
            openTab(file.tab(newPath))
          }}
        />
      ))
    })
  }

  const handleDelete = (node: FileNode) => {
    void import("@/components/dialog-file-delete").then((x) => {
      dialog.show(() => (
        <x.DialogFileDelete
          node={node}
          deps={createFileOpDeps(sdk, file)}
          onDeleted={(path) => tabs().close(file.tab(path))}
        />
      ))
    })
  }

  const handleMove = (node: FileNode) => {
    void import("@/components/dialog-file-move").then((x) => {
      dialog.show(() => (
        <x.DialogFileMove
          node={node}
          deps={createFileOpDeps(sdk, file)}
          onMoved={(oldPath, newPath) => {
            tabs().close(file.tab(oldPath))
            openTab(file.tab(newPath))
          }}
        />
      ))
    })
  }

  const handleCopyPath = (path: string) => {
    void navigator.clipboard.writeText(path).then(() => {
      showToast({ title: language.t("toast.file.pathCopied") })
    })
  }

  const handleFileDblClick = (node: FileNode) => {
    requestAutoEdit(node.path)
    openTab(file.tab(node.path))
  }

  const setExplorerView = (value: string) => {
    if (value !== "changed" && value !== "all") return
    layout.inspector.setExplorerView(value)
  }

  const showAllFiles = () => {
    if (layout.inspector.explorerView() !== "changed") return
    layout.inspector.setExplorerView("all")
  }

  const [store, setStore] = createStore({
    activeDraggable: undefined as string | undefined,
  })

  // Inspector tab's own sub-view: files (review/context/opened files, the
  // existing DragDropProvider+Tabs block below), Git (SourceControl) or
  // Tasks (TaskPanel) — both moved in from the old file-tree pane.
  // Local/unpersisted — matches the mockup's own Inspector "tool" switch
  // (showCodeInspector), just not worth a persisted preference here.
  const [inspectorView, setInspectorView] = createSignal<"files" | "git" | "tasks" | "memory">("files")

  const handleDragStart = (event: unknown) => {
    const id = getDraggableId(event)
    if (!id) return
    setStore("activeDraggable", id)
  }

  const handleDragOver = (event: DragEvent) => {
    const { draggable, droppable } = event
    if (!draggable || !droppable) return

    const currentTabs = tabs().all()
    const toIndex = getTabReorderIndex(currentTabs, draggable.id.toString(), droppable.id.toString())
    if (toIndex === undefined) return
    tabs().move(draggable.id.toString(), toIndex)
  }

  const handleDragEnd = () => {
    setStore("activeDraggable", undefined)
  }

  createEffect(() => {
    if (!file.ready()) return

    setSessionHandoff(sessionKey(), {
      files: tabs()
        .all()
        .reduce<Record<string, SelectedLineRange | null>>((acc, tab) => {
          const path = file.pathFromTab(tab)
          if (!path) return acc

          const selected = file.selectedLines(path)
          acc[path] =
            selected && typeof selected === "object" && "start" in selected && "end" in selected
              ? (selected as SelectedLineRange)
              : null

          return acc
        }, {}),
    })
  })

  return (
    // v110 InspectorFrame (shell/v110-inspector-frame.tsx, A2): one shared
    // pane, one tab visible at a time — no second Explorer, no dual-pane.
    // The frame itself is fixed-width chrome (no open/closed collapse, no
    // resize of its own; "Sizes come from A1 vars"), so this wrapper drives
    // --v110-inspector and owns the resize handle and the open/closed width.
    <div
      data-v110="inspector-content"
      aria-hidden={!layout.inspector.opened()}
      inert={!layout.inspector.opened()}
      class="relative min-w-0 flex shrink-0 overflow-hidden bg-background-base"
      classList={{
        // Desktop: side panel with horizontal width transition
        "h-full": !isOverlay(),
        "transition-[width] duration-[240ms] ease-[cubic-bezier(0.22,1,0.36,1)] will-change-[width] motion-reduce:transition-none":
          !isOverlay() && !props.size.active() && !props.reviewSnap,
        // Overlay viewports use a full-height inspector over session content.
        "mobile-side-panel w-full": isOverlay(),
        "pointer-events-none": !layout.inspector.opened(),
      }}
      style={
        isOverlay()
          ? {
              // Full height (not a half-sheet): browsing files/reviewing
              // changes is a primary mobile task, not a quick peek — the
              // panel is `position: absolute` over the session content (see
              // v110.css .mobile-side-panel), so covering the composer
              // underneath is the intended behavior while it's open.
              height: layout.inspector.opened() ? "100%" : "0px",
              transition: "height 240ms cubic-bezier(0.22,1,0.36,1)",
            }
          : {
              width: panelWidth(),
              // The frame's own `width: var(--v110-inspector, 300px)` resolves
              // against ITS containing block, which is already sized to
              // panelWidth() by this wrapper — feeding it the same calc()
              // string here would recompute it a second time against that
              // already-narrowed box (calc(100% - 600px) of 599px, not of the
              // viewport) and could go negative. 100% just fills whatever
              // width the wrapper already settled on.
              "--v110-inspector": "100%",
            }
      }
    >
      <div class="size-full flex border-l border-border-weaker-base">
        <InspectorFrame
          tab={layout.inspector.tab()}
          onTab={(tab) => layout.inspector.setTab(tab)}
          open={layout.inspector.opened()}
          onToggle={() => layout.inspector.toggle()}
          label={language.t("session.panel.reviewAndFiles")}
          title={(tab) =>
            tab === "explorer"
              ? language.t("inspector.tab.explorer")
              : tab === "execution"
                ? language.t("inspector.tab.execution")
                : language.t("inspector.tab.inspector")
          }
        >
          <Switch>
            {/* Explorer: file tree browsing. The old "Changes"/"All files"
                split (two real, still-used views) survives as an internal
                toggle instead of being dropped for a single tree. */}
            <Match when={layout.inspector.tab() === "explorer"}>
              <div class="h-full flex flex-col overflow-hidden group/filetree">
                <Tabs
                  variant="pill"
                  value={layout.inspector.explorerView()}
                  onChange={setExplorerView}
                  class="h-full"
                  data-scope="filetree"
                >
                  <Tabs.List>
                    <Tabs.Trigger value="changed" class="flex-1" classes={{ button: "w-full" }}>
                      {props.reviewCount()}{" "}
                      {language.t(
                        props.reviewCount() === 1 ? "session.review.change.one" : "session.review.change.other",
                      )}
                    </Tabs.Trigger>
                    <Tabs.Trigger value="all" class="flex-1" classes={{ button: "w-full" }}>
                      {language.t("session.files.all")}
                    </Tabs.Trigger>
                  </Tabs.List>
                  <Tabs.Content value="changed" class="bg-background-stronger px-3 py-0">
                    <Switch>
                      <Match when={props.hasReview() || !props.diffsReady()}>
                        <Show
                          when={props.diffsReady()}
                          fallback={
                            <div class="px-2 py-2 text-12-regular text-text-weak">
                              {language.t("common.loading")}
                              {language.t("common.loading.ellipsis")}
                            </div>
                          }
                        >
                          <FileTree
                            path=""
                            class="pt-3"
                            allowed={diffFiles()}
                            kinds={kinds()}
                            draggable={false}
                            active={props.activeDiff}
                            onFileClick={(node) => {
                              layout.inspector.setTab("inspector")
                              props.focusReviewDiff(node.path)
                            }}
                          />
                        </Show>
                      </Match>
                      <Match when={true}>{empty(props.empty())}</Match>
                    </Switch>
                  </Tabs.Content>
                  <Tabs.Content value="all" class="bg-background-stronger px-3 py-0">
                    <div class="flex items-center justify-between px-1 pt-2 pb-1">
                      <span class="text-11-medium text-text-weaker uppercase tracking-wide">
                        {language.t("session.files.all")}
                      </span>
                      <DropdownMenu gutter={4} placement="bottom-end">
                        <DropdownMenu.Trigger as={IconButton} icon="plus-small" variant="ghost" size="small" />
                        <DropdownMenu.Portal>
                          <DropdownMenu.Content>
                            <DropdownMenu.Item onSelect={() => handleNewFile("")}>
                              <DropdownMenu.ItemLabel>{language.t("fileOps.newFile")}</DropdownMenu.ItemLabel>
                            </DropdownMenu.Item>
                            <DropdownMenu.Item onSelect={() => handleNewFolder("")}>
                              <DropdownMenu.ItemLabel>{language.t("fileOps.newFolder")}</DropdownMenu.ItemLabel>
                            </DropdownMenu.Item>
                          </DropdownMenu.Content>
                        </DropdownMenu.Portal>
                      </DropdownMenu>
                    </div>
                    <Switch>
                      <Match when={nofiles()}>{empty(language.t("session.files.empty"))}</Match>
                      <Match when={true}>
                        <FileTree
                          path=""
                          class="pt-1"
                          modified={diffFiles()}
                          kinds={kinds()}
                          onFileClick={(node) => openTab(file.tab(node.path))}
                          onFileDblClick={handleFileDblClick}
                          onNewFile={handleNewFile}
                          onNewFolder={handleNewFolder}
                          onRename={handleRename}
                          onDelete={handleDelete}
                          onMove={handleMove}
                          onCopyPath={handleCopyPath}
                          onCopyRelativePath={handleCopyPath}
                        />
                      </Match>
                    </Switch>
                  </Tabs.Content>
                </Tabs>
              </div>
            </Match>

            {/* Inspector: opened files, Review diff, Context, Git and Tasks —
                the mockup's own Inspector "tool" switch (showCodeInspector
                in the v110 reference) groups these the same way. Git/Tasks
                are a local toggle above the file-tabs strip rather than
                extra entries in the persisted session-tabs system:
                helpers.ts's createSessionTabs already hardcodes
                "review"/"context" by name, and adding more special tabs
                there is a bigger, riskier change than this content move
                needs. */}
            <Match when={layout.inspector.tab() === "inspector"}>
              <div class="size-full min-w-0 h-full bg-background-base flex flex-col">
                <div class="shrink-0 flex items-center gap-1 px-2 pt-2">
                  <Button
                    type="button"
                    variant={inspectorView() === "files" ? "primary" : "ghost"}
                    size="small"
                    onClick={() => setInspectorView("files")}
                  >
                    {language.t("session.tab.review")}
                  </Button>
                  <Button
                    type="button"
                    variant={inspectorView() === "git" ? "primary" : "ghost"}
                    size="small"
                    onClick={() => setInspectorView("git")}
                  >
                    Git
                  </Button>
                  <Button
                    type="button"
                    variant={inspectorView() === "tasks" ? "primary" : "ghost"}
                    size="small"
                    onClick={() => setInspectorView("tasks")}
                  >
                    Tasks
                  </Button>
                  <Button
                    type="button"
                    variant={inspectorView() === "memory" ? "primary" : "ghost"}
                    size="small"
                    onClick={() => setInspectorView("memory")}
                  >
                    Memory
                  </Button>
                </div>
                <Switch>
                  <Match when={inspectorView() === "git"}>
                    <div class="flex-1 min-h-0 overflow-y-auto">
                      <SourceControl directory={sdk.directory} onOpenFile={(path) => openTab(file.tab(path))} />
                    </div>
                  </Match>
                  {/* FORK: ADR-0005 Phase 4 — task runner, moved in alongside Git. */}
                  <Match when={inspectorView() === "tasks"}>
                    <div class="flex-1 min-h-0 overflow-y-auto">
                      <TaskPanel
                        directory={sdk.directory}
                        onRunTask={(command, title) => {
                          const id = terminal.newWithCommand(command, title)
                          view().terminal.open()
                          return id
                        }}
                      />
                    </div>
                  </Match>
                  <Match when={inspectorView() === "memory"}>
                    <div class="flex-1 min-h-0 overflow-hidden">
                      <MemoryPanel />
                    </div>
                  </Match>
                  <Match when={true}>
                    <DragDropProvider
                      onDragStart={handleDragStart}
                      onDragEnd={handleDragEnd}
                      onDragOver={handleDragOver}
                      collisionDetector={closestCenter}
                    >
                      <DragDropSensors />
                      <ConstrainDragYAxis />
                      <Tabs value={activeTab()} onChange={openTab} class="flex-1 min-h-0">
                        <div class="sticky top-0 shrink-0 flex">
                          <Tabs.List
                            data-v110="code-tabs"
                            ref={(el: HTMLDivElement) => {
                              const stop = createFileTabListSync({ el, contextOpen })
                              onCleanup(stop)
                            }}
                          >
                            <Show when={props.canReview()}>
                              <Tabs.Trigger value="review">
                                <div class="flex items-center gap-1.5">
                                  <div>{language.t("session.tab.review")}</div>
                                  <Show when={props.hasReview()}>
                                    <div>{props.reviewCount()}</div>
                                  </Show>
                                </div>
                              </Tabs.Trigger>
                            </Show>
                            <Show when={contextOpen()}>
                              <Tabs.Trigger
                                value="context"
                                closeButton={
                                  <TooltipKeybind
                                    title={language.t("common.closeTab")}
                                    keybind={command.keybind("tab.close")}
                                    placement="bottom"
                                    gutter={10}
                                  >
                                    <IconButton
                                      icon="close-small"
                                      variant="ghost"
                                      class="h-5 w-5"
                                      onClick={() => tabs().close("context")}
                                      aria-label={language.t("common.closeTab")}
                                    />
                                  </TooltipKeybind>
                                }
                                hideCloseButton
                                onMiddleClick={() => tabs().close("context")}
                              >
                                <div class="flex items-center gap-2">
                                  <SessionContextUsage variant="indicator" />
                                  <div>{language.t("session.tab.context")}</div>
                                </div>
                              </Tabs.Trigger>
                            </Show>
                            <SortableProvider ids={openedTabs()}>
                              <For each={openedTabs()}>{(tab) => <SortableTab tab={tab} onTabClose={guard.close} />}</For>
                            </SortableProvider>
                            <div class="bg-background-stronger h-full shrink-0 sticky right-0 z-10 flex items-center justify-center pr-3">
                              <TooltipKeybind
                                title={language.t("command.file.open")}
                                keybind={command.keybind("file.open")}
                                class="flex items-center"
                              >
                                <IconButton
                                  icon="plus-small"
                                  variant="ghost"
                                  iconSize="large"
                                  class="!rounded-md"
                                  onClick={() => {
                                    void import("@/components/dialog-select-file").then((x) => {
                                      dialog.show(() => (
                                        <x.DialogSelectFile mode="files" onOpenFile={showAllFiles} file={file} />
                                      ))
                                    })
                                  }}
                                  aria-label={language.t("command.file.open")}
                                />
                              </TooltipKeybind>
                            </div>
                          </Tabs.List>
                        </div>

                        <Show when={props.canReview()}>
                          <Tabs.Content value="review" class="flex flex-col h-full overflow-hidden contain-strict">
                            <Show when={activeTab() === "review"}>{props.reviewPanel()}</Show>
                          </Tabs.Content>
                        </Show>

                        <Tabs.Content value="empty" class="flex flex-col h-full overflow-hidden contain-strict">
                          <Show when={activeTab() === "empty"}>
                            <div class="relative pt-2 flex-1 min-h-0 overflow-hidden">
                              <div class="h-full px-6 pb-42 -mt-4 flex flex-col items-center justify-center text-center gap-6">
                                <Mark class="w-14 opacity-10" />
                                <div class="text-14-regular text-text-weak max-w-56">
                                  {language.t("session.files.selectToOpen")}
                                </div>
                              </div>
                            </div>
                          </Show>
                        </Tabs.Content>

                        <Show when={contextOpen()}>
                          <Tabs.Content value="context" class="flex flex-col h-full overflow-hidden contain-strict">
                            <Show when={activeTab() === "context"}>
                              <div class="relative pt-2 flex-1 min-h-0 overflow-hidden">
                                <SessionContextTab />
                              </div>
                            </Show>
                          </Tabs.Content>
                        </Show>

                        {/* FORK: Stretch Phase 6 — split pane (Ctrl+\) */}
                        <Show when={activeFileTab()} keyed>
                          {(tab) => (
                            <Show when={view().editorSplit.tab()} fallback={<FileTabContent tab={tab} />}>
                              {(splitTab) => {
                                // Drag state for the split divider
                                let splitRatio = view().editorSplit.ratio()
                                let dragging = false
                                let containerRef: HTMLDivElement | undefined

                                const startDrag = (e: PointerEvent) => {
                                  dragging = true
                                  ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
                                }
                                const onDrag = (e: PointerEvent) => {
                                  if (!dragging || !containerRef) return
                                  const rect = containerRef.getBoundingClientRect()
                                  splitRatio = Math.max(0.25, Math.min(0.75, (e.clientX - rect.left) / rect.width))
                                  containerRef.style.setProperty("--split-ratio", String(splitRatio))
                                }
                                const endDrag = (e: PointerEvent) => {
                                  if (!dragging) return
                                  dragging = false
                                  ;(e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId)
                                  view().editorSplit.setRatio(splitRatio)
                                }

                                return (
                                  <div
                                    ref={containerRef}
                                    class="flex h-full w-full"
                                    style={{ "--split-ratio": String(view().editorSplit.ratio()) }}
                                  >
                                    {/* Left pane */}
                                    <div
                                      class="relative min-w-0 overflow-hidden"
                                      style={{ width: `calc(var(--split-ratio) * 100%)` }}
                                    >
                                      <FileTabContent tab={tab} />
                                    </div>

                                    {/* Drag divider */}
                                    <div
                                      class="w-[3px] shrink-0 bg-border-weak-base hover:bg-accent-primary/60 active:bg-accent-primary cursor-col-resize relative z-10 transition-colors"
                                      onPointerDown={startDrag}
                                      onPointerMove={onDrag}
                                      onPointerUp={endDrag}
                                    />

                                    {/* Right pane */}
                                    <div class="flex-1 relative min-w-0 overflow-hidden border-l border-border-weak-base">
                                      {/* Close split button */}
                                      <button
                                        type="button"
                                        class="absolute top-2 right-2 z-20 text-text-weaker hover:text-text-base text-10-regular bg-background-stronger/80 rounded px-1.5 py-0.5 backdrop-blur"
                                        onClick={() => view().editorSplit.close()}
                                        title={language.t("panel.split.close", { keybind: "Ctrl+\\" })}
                                      >
                                        {language.t("panel.split.closeButton")}
                                      </button>
                                      <FileTabContent tab={splitTab()} override />
                                    </div>
                                  </div>
                                )
                              }}
                            </Show>
                          )}
                        </Show>
                      </Tabs>
                      <DragOverlay>
                        <Show when={store.activeDraggable} keyed>
                          {(tab) => {
                            const path = file.pathFromTab(tab)
                            return (
                              <div data-component="tabs-drag-preview">
                                <Show when={path}>{(p) => <FileVisual active path={p()} />}</Show>
                              </div>
                            )
                          }}
                        </Show>
                      </DragOverlay>
                    </DragDropProvider>
                  </Match>
                </Switch>
              </div>
            </Match>

            {/* Execution: v110 names this tab "Trajectory/Observability"
                (OWNERSHIP.md, RESPONSIVE-MATRIX.md — "onglet Execution de
                l'inspector natif" IS the trajectory/observability tab, not
                a task runner). The real backend already exists and is
                session-scoped (sdk.client.observability.events/trace),
                already wired into Settings > Observability's timeline —
                reused here as-is rather than rebuilt. */}
            <Match when={layout.inspector.tab() === "execution"}>
              <SettingsObservabilityTimeline
                sessions={[{ id: props.sessionId ?? "", title: props.sessionId ?? "" }]}
                sessionId={props.sessionId}
                scope="project"
                onSelectSession={() => {}}
              />
            </Match>
          </Switch>
        </InspectorFrame>
      </div>

      {/* Inspector (wide, content-driven width) resizes via session.tsx's
          "resize-chat" handle on the chat column instead — only
          Explorer/Execution (narrow, self-driven width) get this handle,
          same split as the old fileOpen()-only gate. */}
      <Show when={layout.inspector.opened() && layout.inspector.tab() !== "inspector" && !isOverlay()}>
        <div onPointerDown={() => props.size.start()}>
          <Separator
            axis="x"
            edge="start"
            label={language.t("inspector.resize")}
            data-v110="resize-inspector"
            size={layout.inspector.width()}
            min={200}
            max={480}
            onResize={(width) => {
              props.size.touch()
              layout.inspector.resize(width)
            }}
          />
        </div>
      </Show>
    </div>
  )
}
