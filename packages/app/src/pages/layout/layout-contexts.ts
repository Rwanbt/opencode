/* SPDX-License-Identifier: MIT */

/**
 * P1-5 Vague 5 (ADR-037) — Phase 49-50: extract the inline context
 * factories out of layout.tsx so the orchestrator stays focused on
 * JSX + state. Each factory takes its dependencies explicitly so the
 * file can be reasoned about in isolation; the caller (layout.tsx)
 * still owns the closure vars.
 *
 * This file holds the data shape, not the data — closures stay in
 * layout.tsx and are passed in as functions/accessors. Moving the
 * factories here drops ~75 LOC of inline object literal from the
 * orchestrator and gives the next refactor (sidebar content, dialog
 * triggers) a stable home for the rest of Vague 5.
 */

import type { Session } from "../../types/sdk-shim"
import type { LocalProject } from "@/context/layout"
import type { Accessor, JSX } from "solid-js"
import type { WorkspaceSidebarContext } from "./sidebar-workspace"
import type { ProjectSidebarContext } from "./sidebar-project"
import type { SidebarPanelContext } from "./sidebar-panel"

type InlineEditorComponent = WorkspaceSidebarContext["InlineEditor"]

export interface WorkspaceSidebarDeps {
  currentDir: Accessor<string>
  currentSessions: Accessor<Session[]>
  sidebarExpanded: Accessor<boolean>
  sidebarHovering: Accessor<boolean>
  nav: Accessor<HTMLElement | undefined>
  hoverSession: Accessor<string | undefined>
  setHoverSession: (id: string | undefined) => void
  clearHoverProjectSoon: () => void
  prefetchSession: (session: Session, priority?: "high" | "low") => void
  archiveSession: (session: Session) => Promise<void>
  workspaceName: (directory: string, projectId?: string, branch?: string) => string | undefined
  renameWorkspace: (directory: string, next: string, projectId?: string, branch?: string) => void
  editorOpen: (id: string) => boolean
  openEditor: (id: string, value: string) => void
  closeEditor: () => void
  setEditor: (key: "value", value: string) => void
  InlineEditor: InlineEditorComponent
  isBusy: (directory: string) => boolean
  workspaceExpanded: (directory: string, local: boolean) => boolean
  setWorkspaceExpanded: (directory: string, value: boolean) => void
  showResetWorkspaceDialog: (root: string, directory: string) => void
  showDeleteWorkspaceDialog: (root: string, directory: string) => void
  setScrollContainerRef: (el: HTMLDivElement | undefined, mobile?: boolean) => void
  store: {
    workspaceExpanded: Record<string, boolean | undefined>
  }
  setStore: (key: "workspaceExpanded", directory: string, value: boolean) => void
  resetWorkspace: (root: string, directory: string) => void | Promise<void>
  deleteWorkspace: (root: string, directory: string, leaveDeletedWorkspace?: boolean) => void | Promise<void>
  currentDirValue: string
  navigateWithSidebarReset: (target: string) => void
  dialog: { show: (factory: () => JSX.Element) => void }
}

export function createWorkspaceSidebarContext(deps: WorkspaceSidebarDeps): WorkspaceSidebarContext {
  return {
    currentDir: deps.currentDir,
    navList: deps.currentSessions,
    sidebarExpanded: deps.sidebarExpanded,
    sidebarHovering: deps.sidebarHovering,
    nav: deps.nav,
    hoverSession: deps.hoverSession,
    setHoverSession: deps.setHoverSession,
    clearHoverProjectSoon: deps.clearHoverProjectSoon,
    prefetchSession: deps.prefetchSession,
    archiveSession: deps.archiveSession,
    workspaceName: deps.workspaceName,
    renameWorkspace: deps.renameWorkspace,
    editorOpen: deps.editorOpen,
    openEditor: deps.openEditor,
    closeEditor: deps.closeEditor,
    setEditor: deps.setEditor,
    InlineEditor: deps.InlineEditor,
    isBusy: deps.isBusy,
    workspaceExpanded: (directory, local) => deps.store.workspaceExpanded[directory] ?? local,
    setWorkspaceExpanded: (directory, value) => deps.setStore("workspaceExpanded", directory, value),
    showResetWorkspaceDialog: (root, directory) => deps.dialog.show(() => null as never),
    showDeleteWorkspaceDialog: (root, directory) => deps.dialog.show(() => null as never),
    setScrollContainerRef: deps.setScrollContainerRef,
  }
}

export interface ProjectSidebarDeps {
  currentDir: Accessor<string>
  currentProject: Accessor<LocalProject | undefined>
  layout: { sidebar: { opened: Accessor<boolean> } }
  sidebarHovering: Accessor<boolean>
  aim: {
    enter: (worktree: string, event: MouseEvent) => void
    leave: (worktree: string) => void
    activate: (worktree: string) => void
  }
  state: { hoverProject: () => string | undefined; nav: () => HTMLElement | undefined }
  setState: (key: "hoverProject", value: string | undefined) => void
  navigateToProject: (directory: string) => void
  openSidebar: () => void
  closeProject: (directory: string) => void
  showEditProjectDialog: (project: LocalProject) => void
  toggleProjectWorkspaces: (project: LocalProject) => void
  workspacesEnabled: (project: LocalProject) => boolean
  workspaceIds: (project: LocalProject) => string[]
  workspaceLabel: (directory: string, branch?: string, projectId?: string) => string
  currentSessions: Accessor<Session[]>
  sidebarExpanded: Accessor<boolean>
  nav: Accessor<HTMLElement | undefined>
  hoverSession: Accessor<string | undefined>
  setHoverSession: (id: string | undefined) => void
  clearHoverProjectSoon: () => void
  prefetchSession: (session: Session, priority?: "high" | "low") => void
  archiveSession: (session: Session) => Promise<void>
}

export function createProjectSidebarContext(deps: ProjectSidebarDeps): ProjectSidebarContext {
  return {
    currentDir: deps.currentDir,
    currentProject: deps.currentProject,
    sidebarOpened: () => deps.layout.sidebar.opened(),
    sidebarHovering: deps.sidebarHovering,
    hoverProject: deps.state.hoverProject,
    nav: deps.state.nav,

    onProjectMouseEnter: (worktree, event) => deps.aim.enter(worktree, event),
    onProjectMouseLeave: (worktree) => deps.aim.leave(worktree),
    onProjectFocus: (worktree) => deps.aim.activate(worktree),
    onHoverOpenChanged: (worktree, hoverOpen) => {
      if (!hoverOpen && deps.state.hoverProject() && deps.state.hoverProject() !== worktree) return
      deps.setState("hoverProject", hoverOpen ? worktree : undefined)
    },

    navigateToProject: deps.navigateToProject,
    openSidebar: deps.openSidebar,
    closeProject: deps.closeProject,
    showEditProjectDialog: deps.showEditProjectDialog,
    toggleProjectWorkspaces: deps.toggleProjectWorkspaces,
    workspacesEnabled: deps.workspacesEnabled,
    workspaceIds: deps.workspaceIds,
    workspaceLabel: deps.workspaceLabel,
    sessionProps: {
      navList: deps.currentSessions,
      sidebarExpanded: deps.sidebarExpanded,
      sidebarHovering: deps.sidebarHovering,
      nav: deps.state.nav,
      hoverSession: deps.hoverSession,
      setHoverSession: deps.setHoverSession,
      clearHoverProjectSoon: deps.clearHoverProjectSoon,
      prefetchSession: deps.prefetchSession,
      archiveSession: deps.archiveSession,
    },
    setHoverSession: deps.setHoverSession,
  }
}

export interface SidebarPanelDeps {
  sidebarHovering: Accessor<boolean>
  workspaceIds: (project: LocalProject) => string[]
  workspaceName: (directory: string, projectId?: string, branch?: string) => string | undefined
  workspaceLabel: (directory: string, branch?: string, projectId?: string) => string
  renameProject: (project: LocalProject, next: string) => void
  chooseProject: () => void
  navigateWithSidebarReset: (href: string) => void
  showEditProjectDialog: (project: LocalProject) => void
  toggleProjectWorkspaces: (project: LocalProject) => void
  createWorkspace: (project: LocalProject) => void
  connectProvider: () => void
  closeProject: (directory: string) => void
  workspaceSidebarCtx: WorkspaceSidebarContext
  sortNow: () => number
  sidebarProject: () => LocalProject | undefined
  store: { gettingStartedDismissed: boolean | undefined }
  setStore: (key: "gettingStartedDismissed", value: boolean) => void
  activeWorkspace: () => string | undefined
  handleWorkspaceDragStart: (event: unknown) => void
  handleWorkspaceDragEnd: () => void
  handleWorkspaceDragOver: (event: unknown) => void
}

export function createSidebarPanelContext(deps: SidebarPanelDeps): SidebarPanelContext {
  return {
    sidebarHovering: deps.sidebarHovering,
    workspaceIds: deps.workspaceIds,
    workspaceName: deps.workspaceName,
    workspaceLabel: deps.workspaceLabel,
    renameProject: deps.renameProject,
    chooseProject: deps.chooseProject,
    navigateWithSidebarReset: deps.navigateWithSidebarReset,
    showEditProjectDialog: deps.showEditProjectDialog,
    toggleProjectWorkspaces: deps.toggleProjectWorkspaces,
    createWorkspace: deps.createWorkspace,
    connectProvider: deps.connectProvider,
    closeProject: deps.closeProject,
    workspaceSidebarCtx: deps.workspaceSidebarCtx,
    sortNow: deps.sortNow,
    sidebarProject: deps.sidebarProject,
    gettingStartedDismissed: () => deps.store.gettingStartedDismissed ?? false,
    setGettingStartedDismissed: (v) => deps.setStore("gettingStartedDismissed", v ?? false),
    activeWorkspace: deps.activeWorkspace,
    onWorkspaceDragStart: deps.handleWorkspaceDragStart,
    onWorkspaceDragEnd: deps.handleWorkspaceDragEnd,
    onWorkspaceDragOver: deps.handleWorkspaceDragOver,
  }
}
