/**
 * Project and session mutation actions for layout.tsx.
 *
 * Factory `createProjectActions(deps)` → action functions used by the Layout
 * component to manage projects, workspaces and sessions.
 *
 * Extracted from layout.tsx to keep that file under the 1500-LOC governance
 * budget.
 */
import { produce } from "solid-js/store"
import { base64Encode } from "@opencode-ai/util/encode"
import { getFilename } from "@opencode-ai/util/path"
import { Binary } from "@opencode-ai/util/binary"
import type { Session } from "../../types/sdk-shim"
import type { LocalProject } from "@/context/layout"
import type { useGlobalSDK } from "@/context/global-sdk"
import type { useGlobalSync } from "@/context/global-sync"
import type { useLayout } from "@/context/layout"
import type { usePlatform } from "@/context/platform"
import type { useServer } from "@/context/server"
import type { useLanguage } from "@/context/language"
import type { useDialog } from "@opencode-ai/ui/context/dialog"
import { displayName, workspaceKey } from "./helpers"

export interface ProjectActionsDeps {
  globalSDK: ReturnType<typeof useGlobalSDK>
  globalSync: ReturnType<typeof useGlobalSync>
  layout: ReturnType<typeof useLayout>
  platform: ReturnType<typeof usePlatform>
  server: ReturnType<typeof useServer>
  language: ReturnType<typeof useLanguage>
  dialog: ReturnType<typeof useDialog>
  params: { readonly id?: string; readonly dir?: string }
  navigate: (href: string) => void
  navigateWithSidebarReset: (href: string) => void
  navigateToProject: (directory: string | undefined) => Promise<void>
  currentProject: () => LocalProject | undefined
  workspaceName: (directory: string, projectId?: string, branch?: string) => string | undefined
  setWorkspaceName: (directory: string, next: string, projectId?: string, branch?: string) => void
  /** Mutable ref shared with layout.tsx — incremented on each dialog open */
  dialogRef: { run: number; dead: boolean }
}

export function createProjectActions(deps: ProjectActionsDeps) {
  const {
    globalSDK,
    globalSync,
    layout,
    platform,
    server,
    language,
    dialog,
    params,
    navigate,
    navigateWithSidebarReset,
    navigateToProject,
    currentProject,
    workspaceName,
    setWorkspaceName,
    dialogRef,
  } = deps

  async function archiveSession(session: Session) {
    const [store, setStore] = globalSync.child(session.directory)
    const sessions = store.session ?? []
    const index = sessions.findIndex((s) => s.id === session.id)
    const nextSession = sessions[index + 1] ?? sessions[index - 1]

    await globalSDK.client.session.update({
      directory: session.directory,
      sessionID: session.id,
      time: { archived: Date.now() },
    })
    setStore(
      produce((draft) => {
        const match = Binary.search(draft.session, session.id, (s) => s.id)
        if (match.found) draft.session.splice(match.index, 1)
      }),
    )
    if (session.id === params.id) {
      if (nextSession) {
        navigate(`/${params.dir}/session/${nextSession.id}`)
      } else {
        navigate(`/${params.dir}/session`)
      }
    }
  }

  async function renameProject(project: LocalProject, next: string) {
    const current = displayName(project)
    if (next === current) return
    const name = next === getFilename(project.worktree) ? "" : next

    if (project.id && project.id !== "global") {
      await globalSDK.client.project.update({ projectID: project.id, directory: project.worktree, name })
      return
    }

    globalSync.project.meta(project.worktree, { name })
  }

  const renameWorkspace = (directory: string, next: string, projectId?: string, branch?: string) => {
    const current = workspaceName(directory, projectId, branch) ?? branch ?? getFilename(directory)
    if (current === next) return
    setWorkspaceName(directory, next, projectId, branch)
  }

  function closeProject(directory: string) {
    const list = layout.projects.list()
    const key = workspaceKey(directory)
    const index = list.findIndex((x) => workspaceKey(x.worktree) === key)
    const active = workspaceKey(currentProject()?.worktree ?? "") === key
    if (index === -1) return
    const next = list[index + 1]

    if (!active) {
      layout.projects.close(directory)
      return
    }

    if (!next) {
      layout.projects.close(directory)
      navigate("/")
      return
    }

    navigateWithSidebarReset(`/${base64Encode(next.worktree)}/session`)
    layout.projects.close(directory)
    queueMicrotask(() => {
      void navigateToProject(next.worktree)
    })
  }

  function toggleProjectWorkspaces(project: LocalProject) {
    const enabled = layout.sidebar.workspaces(project.worktree)()
    if (enabled) {
      layout.sidebar.toggleWorkspaces(project.worktree)
      return
    }
    if (project.vcs !== "git") return
    layout.sidebar.toggleWorkspaces(project.worktree)
  }

  const showEditProjectDialog = (project: LocalProject) => {
    const run = ++dialogRef.run
    void import("@/components/dialog-edit-project").then((x) => {
      if (dialogRef.dead || dialogRef.run !== run) return
      dialog.show(() => <x.DialogEditProject project={project} />)
    })
  }

  async function chooseProject() {
    function resolve(result: string | string[] | null) {
      if (Array.isArray(result)) {
        for (const directory of result) {
          layout.projects.open(directory)
        }
        void navigateToProject(result[0])
      } else if (result) {
        layout.projects.open(result)
        void navigateToProject(result)
      }
    }

    if (platform.openDirectoryPickerDialog && server.isLocal()) {
      const result = await platform.openDirectoryPickerDialog?.({
        title: language.t("command.project.open"),
        multiple: true,
      })
      resolve(result)
    } else {
      const run = ++dialogRef.run
      void import("@/components/dialog-select-directory").then((x) => {
        if (dialogRef.dead || dialogRef.run !== run) return
        dialog.show(
          () => <x.DialogSelectDirectory multiple={true} onSelect={resolve} />,
          () => resolve(null),
        )
      })
    }
  }

  return {
    chooseProject,
    closeProject,
    archiveSession,
    renameProject,
    renameWorkspace,
    toggleProjectWorkspaces,
    showEditProjectDialog,
  }
}
