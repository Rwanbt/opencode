/**
 * SidebarPanel — the per-project content panel shown in the sidebar.
 *
 * Extracted from layout.tsx to keep that file under the 1500-LOC governance
 * budget. The panel calls its own hooks internally (useLayout, useLanguage,
 * useNotification, useProviders, useGlobalSync, useParams) and receives the
 * remaining Layout-local state/functions through a SidebarPanelContext prop.
 */
import { createMemo, For, Show, type Accessor } from "solid-js"
import { useParams } from "@solidjs/router"
import { base64Encode } from "@opencode-ai/util/encode"
import { getFilename } from "@opencode-ai/util/path"
import { Button } from "@opencode-ai/ui/button"
import { DropdownMenu } from "@opencode-ai/ui/dropdown-menu"
import { IconButton } from "@opencode-ai/ui/icon-button"
import { Tooltip } from "@opencode-ai/ui/tooltip"
import { closestCenter, DragDropProvider, DragDropSensors, DragOverlay, SortableProvider, type DragEvent } from "@thisbeyond/solid-dnd"
import type { LocalProject } from "@/context/layout"
import { useLayout } from "@/context/layout"
import { useGlobalSync } from "@/context/global-sync"
import { useLanguage } from "@/context/language"
import { useNotification } from "@/context/notification"
import { useProviders } from "@/hooks/use-providers"
import { ConstrainDragXAxis } from "@/utils/solid-dnd"
import { LocalWorkspace, SortableWorkspace, WorkspaceDragOverlay, type WorkspaceSidebarContext } from "./sidebar-workspace"

export type SidebarPanelContext = {
  /** Whether the sidebar is in hover-expanded (non-persistent-open) mode. */
  sidebarHovering: Accessor<boolean>
  /** Returns the child directories (workspaces) of a project in display order. */
  workspaceIds: (project: LocalProject) => string[]
  /** Persisted custom name for a workspace directory. */
  workspaceName: (directory: string, projectId?: string, branch?: string) => string | undefined
  /** Display label for a workspace (custom name → branch → folder name). */
  workspaceLabel: (directory: string, branch?: string, projectId?: string) => string
  /** Persist a new project name via the server. */
  renameProject: (project: LocalProject, next: string) => void
  /** Open the directory picker to add a project. */
  chooseProject: () => void
  /** Navigate to `href` and collapse the hover sidebar. */
  navigateWithSidebarReset: (href: string) => void
  /** Open the edit-project dialog for the given project. */
  showEditProjectDialog: (project: LocalProject) => void
  /** Toggle workspace-branches view for the given project. */
  toggleProjectWorkspaces: (project: LocalProject) => void
  /** Create a new workspace (git worktree) for the given project. */
  createWorkspace: (project: LocalProject) => void
  /** Open the connect-provider dialog. */
  connectProvider: () => void
  /** Close the project and navigate away if needed. */
  closeProject: (directory: string) => void
  /** The shared workspace sidebar context used by LocalWorkspace/SortableWorkspace. */
  workspaceSidebarCtx: WorkspaceSidebarContext
  /** Stable clock signal used for session sort-order (ticks every minute). */
  sortNow: () => number
  /** The project shown in the current hovered / opened sidebar panel. */
  sidebarProject: Accessor<LocalProject | undefined>
  /** Whether the "getting started" card has been dismissed. */
  gettingStartedDismissed: Accessor<boolean>
  /** Dismiss the "getting started" card. */
  setGettingStartedDismissed: (v: boolean) => void
  /** The active workspace being dragged (from Layout's store). */
  activeWorkspace: Accessor<string | undefined>
  onWorkspaceDragStart: (event: unknown) => void
  onWorkspaceDragEnd: () => void
  onWorkspaceDragOver: (event: DragEvent) => void
}

interface SidebarPanelProps {
  project: Accessor<LocalProject | undefined>
  mobile?: boolean
  merged?: boolean
  ctx: SidebarPanelContext
}

export function SidebarPanel(props: SidebarPanelProps) {
  const layout = useLayout()
  const language = useLanguage()
  const notification = useNotification()
  const providers = useProviders()
  const globalSync = useGlobalSync()
  const params = useParams()
  const ctx = props.ctx

  const project = props.project
  const merged = createMemo(() => props.mobile || (props.merged ?? layout.sidebar.opened()))
  const hover = createMemo(() => !props.mobile && props.merged === false && !layout.sidebar.opened())
  const popover = createMemo(() => !!props.mobile || props.merged === false || layout.sidebar.opened())
  const empty = createMemo(() => !params.dir && layout.projects.list().length === 0)
  const panel = createMemo(() => Math.max(Math.max(layout.sidebar.width(), 244) - 64, 0))
  const projectName = createMemo(() => {
    const item = project()
    if (!item) return ""
    return item.name || getFilename(item.worktree)
  })
  const projectId = createMemo(() => project()?.id ?? "")
  const worktree = createMemo(() => project()?.worktree ?? "")
  const slug = createMemo(() => {
    const dir = worktree()
    if (!dir) return ""
    return base64Encode(dir)
  })
  const workspaces = createMemo(() => {
    const item = project()
    if (!item) return [] as string[]
    return ctx.workspaceIds(item)
  })
  const unseenCount = createMemo(() =>
    workspaces().reduce((total, directory) => total + notification.project.unseenCount(directory), 0),
  )
  const clearNotifications = () =>
    workspaces()
      .filter((directory) => notification.project.unseenCount(directory) > 0)
      .forEach((directory) => notification.project.markViewed(directory))
  const workspacesEnabled = createMemo(() => {
    const item = project()
    if (!item) return false
    if (item.vcs !== "git") return false
    return layout.sidebar.workspaces(item.worktree)()
  })
  const canToggle = createMemo(() => {
    const item = project()
    if (!item) return false
    return item.vcs === "git" || layout.sidebar.workspaces(item.worktree)()
  })
  const homedir = createMemo(() => globalSync.data.path.home)

  const { InlineEditor } = ctx.workspaceSidebarCtx

  return (
    <div
      classList={{
        "flex flex-col min-h-0 min-w-0 box-border rounded-tl-[12px] px-3": true,
        "border border-b-0 border-border-weak-base": !merged(),
        "border-l border-t border-border-weaker-base": merged(),
        "bg-background-base": merged() || hover(),
        "bg-background-stronger": !merged() && !hover(),
        "flex-1 min-w-0": props.mobile,
        "max-w-full overflow-hidden": props.mobile,
      }}
      style={{
        width: props.mobile ? undefined : `${panel()}px`,
      }}
    >
      <Show
        when={project()}
        fallback={
          <Show when={empty()}>
            <div class="flex-1 min-h-0 -mt-4 flex items-center justify-center px-6 pb-64 text-center">
              <div class="mt-8 flex max-w-60 flex-col items-center gap-6 text-center">
                <div class="flex flex-col gap-3">
                  <div class="text-14-medium text-text-strong">{language.t("sidebar.empty.title")}</div>
                  <div class="text-14-regular text-text-base" style={{ "line-height": "var(--line-height-normal)" }}>
                    {language.t("sidebar.empty.description")}
                  </div>
                </div>
                <Button size="large" icon="folder-add-left" onClick={ctx.chooseProject}>
                  {language.t("command.project.open")}
                </Button>
              </div>
            </div>
          </Show>
        }
      >

          <div class="shrink-0 pl-1 py-1">
            <div class="group/project flex items-start justify-between gap-2 py-2 pl-2 pr-0">
              <div class="flex flex-col min-w-0">
                <InlineEditor
                  id={`project:${projectId()}`}
                  value={projectName}
                  onSave={(next) => {
                    const item = project()
                    if (!item) return
                    ctx.renameProject(item, next)
                  }}
                  class="text-14-medium text-text-strong truncate"
                  displayClass="text-14-medium text-text-strong truncate"
                  stopPropagation
                />

                <Tooltip
                  placement="bottom"
                  gutter={2}
                  value={worktree()}
                  class="shrink-0"
                  contentStyle={{
                    "max-width": "640px",
                    transform: "translate3d(52px, 0, 0)",
                  }}
                >
                  <span class="text-12-regular text-text-base truncate select-text">
                    {worktree().replace(homedir(), "~")}
                  </span>
                </Tooltip>
              </div>

              <DropdownMenu modal={!ctx.sidebarHovering()}>
                <DropdownMenu.Trigger
                  as={IconButton}
                  icon="dot-grid"
                  variant="ghost"
                  data-action="project-menu"
                  data-project={slug()}
                  class="shrink-0 size-6 rounded-md transition-opacity data-[expanded]:bg-surface-base-active"
                  classList={{
                    "opacity-100": props.mobile || merged(),
                    "opacity-0 group-hover/project:opacity-100 group-focus-within/project:opacity-100 data-[expanded]:opacity-100":
                      !props.mobile && !merged(),
                  }}
                  aria-label={language.t("common.moreOptions")}
                />
                <DropdownMenu.Portal>
                  <DropdownMenu.Content class="mt-1">
                    <DropdownMenu.Item
                      onSelect={() => {
                        const item = project()
                        if (!item) return
                        ctx.showEditProjectDialog(item)
                      }}
                    >
                      <DropdownMenu.ItemLabel>{language.t("common.edit")}</DropdownMenu.ItemLabel>
                    </DropdownMenu.Item>
                    <DropdownMenu.Item
                      data-action="project-workspaces-toggle"
                      data-project={slug()}
                      disabled={!canToggle()}
                      onSelect={() => {
                        const item = project()
                        if (!item) return
                        ctx.toggleProjectWorkspaces(item)
                      }}
                    >
                      <DropdownMenu.ItemLabel>
                        {workspacesEnabled()
                          ? language.t("sidebar.workspaces.disable")
                          : language.t("sidebar.workspaces.enable")}
                      </DropdownMenu.ItemLabel>
                    </DropdownMenu.Item>
                    <DropdownMenu.Item
                      data-action="project-clear-notifications"
                      data-project={slug()}
                      disabled={unseenCount() === 0}
                      onSelect={clearNotifications}
                    >
                      <DropdownMenu.ItemLabel>
                        {language.t("sidebar.project.clearNotifications")}
                      </DropdownMenu.ItemLabel>
                    </DropdownMenu.Item>
                    <DropdownMenu.Separator />
                    <DropdownMenu.Item
                      data-action="project-close-menu"
                      data-project={slug()}
                      onSelect={() => {
                        const dir = worktree()
                        if (!dir) return
                        ctx.closeProject(dir)
                      }}
                    >
                      <DropdownMenu.ItemLabel>{language.t("common.close")}</DropdownMenu.ItemLabel>
                    </DropdownMenu.Item>
                  </DropdownMenu.Content>
                </DropdownMenu.Portal>
              </DropdownMenu>
            </div>
          </div>

          <div class="flex-1 min-h-0 flex flex-col">
            <Show
              when={workspacesEnabled()}
              fallback={
                <>
                  <div class="shrink-0 py-4">
                    <Button
                      size="large"
                      icon="new-session"
                      class="w-full"
                      onClick={() => {
                        const dir = worktree()
                        if (!dir) return
                        ctx.navigateWithSidebarReset(`/${base64Encode(dir)}/session`)
                      }}
                    >
                      {language.t("command.session.new")}
                    </Button>
                  </div>
                  <div class="flex-1 min-h-0">
                    <LocalWorkspace
                      ctx={ctx.workspaceSidebarCtx}
                      project={project()!}
                      sortNow={ctx.sortNow}
                      mobile={props.mobile}
                      popover={popover()}
                    />
                  </div>
                </>
              }
            >

                <div class="shrink-0 py-4">
                  <Button
                    size="large"
                    icon="plus-small"
                    class="w-full"
                    onClick={() => {
                      const item = project()
                      if (!item) return
                      ctx.createWorkspace(item)
                    }}
                  >
                    {language.t("workspace.new")}
                  </Button>
                </div>
                <div class="relative flex-1 min-h-0">
                  <DragDropProvider
                    onDragStart={ctx.onWorkspaceDragStart}
                    onDragEnd={ctx.onWorkspaceDragEnd}
                    onDragOver={ctx.onWorkspaceDragOver}
                    collisionDetector={closestCenter}
                  >
                    <DragDropSensors />
                    <ConstrainDragXAxis />
                    <div
                      ref={(el) => {
                        ctx.workspaceSidebarCtx.setScrollContainerRef(el, props.mobile)
                      }}
                      class="size-full flex flex-col py-2 gap-4 overflow-y-auto no-scrollbar [overflow-anchor:none]"
                    >
                      <SortableProvider ids={workspaces()}>
                        <For each={workspaces()}>
                          {(directory) => (
                            <SortableWorkspace
                              ctx={ctx.workspaceSidebarCtx}
                              directory={directory}
                              project={project()!}
                              sortNow={ctx.sortNow}
                              mobile={props.mobile}
                              popover={popover()}
                            />
                          )}
                        </For>
                      </SortableProvider>
                    </div>
                    <DragOverlay>
                      <WorkspaceDragOverlay
                        sidebarProject={ctx.sidebarProject}
                        activeWorkspace={ctx.activeWorkspace}
                        workspaceLabel={ctx.workspaceLabel}
                      />
                    </DragOverlay>
                  </DragDropProvider>
                </div>

            </Show>
          </div>

      </Show>

      <div
        class="shrink-0 px-3 py-3"
        classList={{
          hidden: ctx.gettingStartedDismissed() || !(providers.all().length > 0 && providers.paid().length === 0),
        }}
      >
        <div class="rounded-xl bg-background-base shadow-xs-border-base" data-component="getting-started">
          <div class="p-3 flex flex-col gap-6">
            <div class="flex flex-col gap-2">
              <div class="text-14-medium text-text-strong">{language.t("sidebar.gettingStarted.title")}</div>
              <div class="text-14-regular text-text-base" style={{ "line-height": "var(--line-height-normal)" }}>
                {language.t("sidebar.gettingStarted.line1")}
              </div>
              <div class="text-14-regular text-text-base" style={{ "line-height": "var(--line-height-normal)" }}>
                {language.t("sidebar.gettingStarted.line2")}
              </div>
            </div>
            <div data-component="getting-started-actions">
              <Button size="large" icon="plus-small" onClick={ctx.connectProvider}>
                {language.t("command.provider.connect")}
              </Button>
              <Button size="large" variant="ghost" onClick={() => ctx.setGettingStartedDismissed(true)}>
                {language.t("toast.update.action.notYet")}
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
