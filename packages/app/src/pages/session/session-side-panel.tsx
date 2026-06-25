import { For, Match, Show, Switch, createEffect, createMemo, onCleanup, type JSX } from "solid-js"
import { createStore } from "solid-js/store"
import { createMediaQuery } from "@solid-primitives/media"
import { Tabs } from "@opencode-ai/ui/tabs"
import { IconButton } from "@opencode-ai/ui/icon-button"
import { TooltipKeybind } from "@opencode-ai/ui/tooltip"
import { ResizeHandle } from "@opencode-ai/ui/resize-handle"
import { Mark } from "@opencode-ai/ui/logo"
import { DragDropProvider, DragDropSensors, DragOverlay, SortableProvider, closestCenter } from "@thisbeyond/solid-dnd"
import type { DragEvent } from "@thisbeyond/solid-dnd"
import type { FileDiff } from "@opencode-ai/sdk/v2"
import { ConstrainDragYAxis, getDraggableId } from "@/utils/solid-dnd"
import { useDialog } from "@opencode-ai/ui/context/dialog"

import { DropdownMenu } from "@opencode-ai/ui/dropdown-menu"
import { showToast } from "@opencode-ai/ui/toast"
import type { FileNode } from "@opencode-ai/sdk/v2"
import FileTree from "@/components/file-tree"
import { requestAutoEdit } from "@/pages/session/file-tabs"
import { SourceControl } from "@/components/source-control"
import { TaskPanel } from "@/components/task-panel"
import { SessionContextUsage } from "@/components/session-context-usage"
import { SessionContextTab, SortableTab, FileVisual } from "@/components/session"
import { useCommand } from "@/context/command"
import { useFile, type SelectedLineRange } from "@/context/file"
import { useEditorCloseGuard } from "@/context/editor/close-guard"
import { useLanguage } from "@/context/language"
import { useLayout } from "@/context/layout"
import { usePlatform } from "@/context/platform"
import { useSDK } from "@/context/sdk"
import { useTerminal } from "@/context/terminal"
import { createFileTabListSync } from "@/pages/session/file-tab-scroll"
import { FileTabContent } from "@/pages/session/file-tabs"
import { createOpenSessionFileTab, createSessionTabs, getTabReorderIndex, type Sizing } from "@/pages/session/helpers"
import { setSessionHandoff } from "@/pages/session/handoff"
import { useSessionLayout } from "@/pages/session/session-layout"

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
}) {
  const layout = useLayout()
  const guard = useEditorCloseGuard()
  const file = useFile()
  const language = useLanguage()
  const command = useCommand()
  const dialog = useDialog()
  const platform = usePlatform()
  const sdk = useSDK()
  const terminal = useTerminal()
  const { sessionKey, tabs, view } = useSessionLayout()

  const isDesktop = createMediaQuery("(min-width: 768px)")
  const isMobile = createMemo(() => !isDesktop())
  const isMobileDevice = createMemo(() => platform.platform === "mobile")

  // On mobile, panels are mutually exclusive and default to closed.
  // The desktop defaults (fileTree=true, reviewPanel=true) cause the 50vh
  // overlay to show at launch with the file tree at 100% width hiding review.
  // Fix: on mobile, fileOpen is suppressed when reviewOpen is active, and
  // neither panel opens the overlay without an explicit user toggle.
  const reviewOpen = createMemo(() => view().reviewPanel.opened())
  const fileOpen = createMemo(() => layout.fileTree.opened())
  const open = createMemo(() => {
    if (isMobile()) return reviewOpen() || fileOpen()
    return reviewOpen() || fileOpen()
  })
  const reviewTab = createMemo(() => true)
  const bothOpen = createMemo(() => reviewOpen() && fileOpen())
  const panelWidth = createMemo(() => {
    if (!open()) return "0px"
    if (isMobileDevice()) return "50%"
    if (bothOpen()) return `calc(100% - ${layout.session.width()}px)`
    if (reviewOpen()) return `calc(100% - ${layout.session.width()}px)`
    return `${layout.fileTree.width()}px`
  })
  const treeWidth = createMemo(() => {
    if (!fileOpen()) return "0px"
    if (isMobileDevice()) return bothOpen() ? "50%" : "100%"
    if (bothOpen()) return "50%"
    return `${layout.fileTree.width()}px`
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
    if (!view().reviewPanel.opened()) view().reviewPanel.open()
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
    review: reviewTab,
    hasReview: props.canReview,
  })
  const contextOpen = tabState.contextOpen
  const openedTabs = tabState.openedTabs
  const activeTab = tabState.activeTab
  const activeFileTab = tabState.activeFileTab

  const fileTreeTab = () => layout.fileTree.tab()

  const handleNewFile = (parentDir: string) => {
    void import("@/components/dialog-file-create").then((x) => {
      dialog.show(() => (
        <x.DialogFileCreate
          mode="file"
          parentDir={parentDir}
          onCreated={(path) => openTab(file.tab(path))}
        />
      ))
    })
  }

  const handleNewFolder = (parentDir: string) => {
    void import("@/components/dialog-file-create").then((x) => {
      dialog.show(() => <x.DialogFileCreate mode="folder" parentDir={parentDir} />)
    })
  }

  const handleRename = (node: FileNode) => {
    void import("@/components/dialog-file-rename").then((x) => {
      dialog.show(() => (
        <x.DialogFileRename
          node={node}
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

  const setFileTreeTabValue = (value: string) => {
    if (value !== "changes" && value !== "all" && value !== "git" && value !== "tasks") return
    layout.fileTree.setTab(value)
  }

  const showAllFiles = () => {
    if (fileTreeTab() !== "changes") return
    layout.fileTree.setTab("all")
  }

  const [store, setStore] = createStore({
    activeDraggable: undefined as string | undefined,
  })

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
    <aside
        id="review-panel"
        aria-label={language.t("session.panel.reviewAndFiles")}
        aria-hidden={!open()}
        inert={!open()}
        class="relative min-w-0 flex shrink-0 overflow-hidden bg-background-base"
        classList={{
          // Desktop: side panel with horizontal width transition
          "h-full": !isMobile(),
          "transition-[width] duration-[240ms] ease-[cubic-bezier(0.22,1,0.36,1)] will-change-[width] motion-reduce:transition-none":
            !isMobile() && !props.size.active() && !props.reviewSnap,
          // Mobile: vertical panel that slides down from the top
          "mobile-side-panel w-full": isMobile(),
          "pointer-events-none": !open(),
        }}
        style={isMobile()
          ? { height: open() ? "50vh" : "0px", transition: "height 240ms cubic-bezier(0.22,1,0.36,1)" }
          : { width: panelWidth() }
        }
      >
        <div class="size-full flex border-l border-border-weaker-base">
          <div
            aria-hidden={!reviewOpen()}
            inert={!reviewOpen()}
            class="relative min-w-0 h-full flex-1 overflow-hidden bg-background-base"
            classList={{
              "pointer-events-none": !reviewOpen(),
            }}
          >
            <div class="size-full min-w-0 h-full bg-background-base">
              <DragDropProvider
                onDragStart={handleDragStart}
                onDragEnd={handleDragEnd}
                onDragOver={handleDragOver}
                collisionDetector={closestCenter}
              >
                <DragDropSensors />
                <ConstrainDragYAxis />
                <Tabs value={activeTab()} onChange={openTab}>
                  <div class="sticky top-0 shrink-0 flex">
                    <Tabs.List
                      ref={(el: HTMLDivElement) => {
                        const stop = createFileTabListSync({ el, contextOpen })
                        onCleanup(stop)
                      }}
                    >
                      <Show when={reviewTab() && props.canReview()}>
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
                                dialog.show(() => <x.DialogSelectFile mode="files" onOpenFile={showAllFiles} />)
                              })
                            }}
                            aria-label={language.t("command.file.open")}
                          />
                        </TooltipKeybind>
                      </div>
                    </Tabs.List>
                  </div>

                  <Show when={reviewTab() && props.canReview()}>
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
                      <Show
                        when={view().editorSplit.tab()}
                        fallback={<FileTabContent tab={tab} />}
                      >
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
                                  title="Fermer le volet (Ctrl+\)"
                                >
                                  ✕ volet
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
            </div>
          </div>

          <div
            id="file-tree-panel"
            aria-hidden={!fileOpen()}
            inert={!fileOpen()}
            class="relative min-w-0 h-full shrink-0 overflow-hidden"
            classList={{
              "pointer-events-none": !fileOpen(),
              "transition-[width] duration-200 ease-[cubic-bezier(0.22,1,0.36,1)] will-change-[width] motion-reduce:transition-none":
                !props.size.active(),
            }}
            style={{ width: treeWidth() }}
          >
            <div
              class="h-full flex flex-col overflow-hidden group/filetree"
              classList={{ "border-l border-border-weaker-base": reviewOpen() }}
            >
              <Tabs
                variant="pill"
                value={fileTreeTab()}
                onChange={setFileTreeTabValue}
                class="h-full"
                data-scope="filetree"
              >
                <Tabs.List>
                  <Tabs.Trigger value="changes" class="flex-1" classes={{ button: "w-full" }}>
                    {props.reviewCount()}{" "}
                    {language.t(
                      props.reviewCount() === 1 ? "session.review.change.one" : "session.review.change.other",
                    )}
                  </Tabs.Trigger>
                  <Tabs.Trigger value="all" class="flex-1" classes={{ button: "w-full" }}>
                    {language.t("session.files.all")}
                  </Tabs.Trigger>
                  <Tabs.Trigger value="git" class="flex-1" classes={{ button: "w-full" }}>
                    Git
                  </Tabs.Trigger>
                  {/* FORK: ADR-0005 Phase 4 — task runner tab */}
                  <Tabs.Trigger value="tasks" class="flex-1" classes={{ button: "w-full" }}>
                    Tasks
                  </Tabs.Trigger>
                </Tabs.List>
                <Tabs.Content value="changes" class="bg-background-stronger px-3 py-0">
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
                          onFileClick={(node) => props.focusReviewDiff(node.path)}
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
                <Tabs.Content value="git" class="bg-background-stronger h-full overflow-y-auto">
                  <Show when={fileTreeTab() === "git"}>
                    <SourceControl
                      directory={sdk.directory}
                      onOpenFile={(path) => openTab(file.tab(path))}
                    />
                  </Show>
                </Tabs.Content>
                {/* FORK: ADR-0005 Phase 4 — task runner content */}
                <Tabs.Content value="tasks" class="bg-background-stronger h-full">
                  <Show when={fileTreeTab() === "tasks"}>
                    <TaskPanel
                      directory={sdk.directory}
                      onRunTask={(command, title) => {
                        const id = terminal.newWithCommand(command, title)
                        view().terminal.open()
                        return id
                      }}
                    />
                  </Show>
                </Tabs.Content>
              </Tabs>
            </div>
            <Show when={fileOpen()}>
              <div onPointerDown={() => props.size.start()}>
                <ResizeHandle
                  direction="horizontal"
                  edge="start"
                  size={layout.fileTree.width()}
                  min={200}
                  max={480}
                  onResize={(width) => {
                    props.size.touch()
                    layout.fileTree.resize(width)
                  }}
                />
              </div>
            </Show>
          </div>
        </div>
      </aside>
  )
}
