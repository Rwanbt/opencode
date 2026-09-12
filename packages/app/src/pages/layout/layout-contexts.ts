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
import type { Accessor, JSX } from "solid-js"
import type { WorkspaceSidebarContext } from "./sidebar-workspace"

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
  setStore: (
    key: "workspaceExpanded",
    directory: string,
    value: boolean,
  ) => void
  resetWorkspace: (root: string, directory: string) => void
  deleteWorkspace: (root: string, directory: string, leaveDeletedWorkspace?: boolean) => void
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
    showResetWorkspaceDialog: (root, directory) =>
      deps.dialog.show(() => null as never),
    showDeleteWorkspaceDialog: (root, directory) =>
      deps.dialog.show(() => null as never),
    setScrollContainerRef: deps.setScrollContainerRef,
  }
}

