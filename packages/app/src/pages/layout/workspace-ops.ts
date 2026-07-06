/**
 * Factory for workspace (git worktree) mutation operations.
 * Extracted from layout.tsx to keep that file under the 1500-LOC governance
 * budget.
 *
 * Exports:
 *   createWorkspaceOps → { deleteWorkspace, resetWorkspace }
 *   createWorkspaceCreate → { createWorkspace }
 */
import { produce } from "solid-js/store"
import { base64Encode } from "@opencode-ai/util/encode"
import { showToast, toaster } from "@opencode-ai/ui/toast"
import type { Session } from "../../types/sdk-shim"
import type { LocalProject } from "@/context/layout"
import type { useGlobalSDK } from "@/context/global-sdk"
import type { useGlobalSync } from "@/context/global-sync"
import type { useLayout } from "@/context/layout"
import type { useLanguage } from "@/context/language"
import type { usePlatform } from "@/context/platform"
import { clearWorkspaceTerminals } from "@/context/terminal"
import { Worktree as WorktreeState } from "@/utils/worktree"
import { effectiveWorkspaceOrder, errorMessage, workspaceKey } from "./helpers"

interface WorkspaceOpsDeps {
  globalSDK: ReturnType<typeof useGlobalSDK>
  globalSync: ReturnType<typeof useGlobalSync>
  layout: Pick<ReturnType<typeof useLayout>, "projects" | "mobileSidebar">
  platform: ReturnType<typeof usePlatform>
  language: ReturnType<typeof useLanguage>
  navigate: (href: string) => void
  setBusy: (directory: string, value: boolean) => void
  currentDir: () => string
  navigateWithSidebarReset: (href: string) => void
  clearLastProjectSession: (root: string) => void
  getLastProjectSession: (root: string) => { directory: string; id: string; at: number } | undefined
  getWorkspaceOrder: (root: string) => string[] | undefined
  setWorkspaceOrder: (root: string, updater: (order: string[] | undefined) => string[]) => void
  projectRoot: (directory: string) => string
  paramsDir: () => string | undefined
}

export function createWorkspaceOps(deps: WorkspaceOpsDeps) {
  const {
    globalSDK,
    globalSync,
    layout,
    platform,
    language,
    navigate,
    setBusy,
    currentDir,
    navigateWithSidebarReset,
    clearLastProjectSession,
    getLastProjectSession,
    getWorkspaceOrder,
    setWorkspaceOrder,
    projectRoot,
    paramsDir,
  } = deps

  const deleteWorkspace = async (root: string, directory: string, leaveDeletedWorkspace = false) => {
    if (directory === root) return

    const current = currentDir()
    const currentKey = workspaceKey(current)
    const deletedKey = workspaceKey(directory)
    const shouldLeave = leaveDeletedWorkspace || (!!paramsDir() && currentKey === deletedKey)
    if (!leaveDeletedWorkspace && shouldLeave) {
      navigateWithSidebarReset(`/${base64Encode(root)}/session`)
    }

    setBusy(directory, true)

    const result = await globalSDK.client.worktree
      .remove({ directory: root, worktreeRemoveInput: { directory } })
      .then((x) => {
        if (x.error) throw x.error
        return x.data
      })
      .catch((err) => {
        showToast({
          title: language.t("workspace.delete.failed.title"),
          description: errorMessage(err, language.t("common.requestFailed")),
        })
        return false
      })

    setBusy(directory, false)

    if (!result) return

    if (workspaceKey(getLastProjectSession(root)?.directory ?? "") === workspaceKey(directory)) {
      clearLastProjectSession(root)
    }

    globalSync.set(
      "project",
      produce((draft) => {
        const project = draft.find((item) => item.worktree === root)
        if (!project) return
        project.sandboxes = (project.sandboxes ?? []).filter((sandbox) => sandbox !== directory)
      }),
    )
    setWorkspaceOrder(root, (order) => (order ?? []).filter((workspace) => workspace !== directory))

    layout.projects.close(directory)
    layout.projects.open(root)

    if (shouldLeave) return

    const nextCurrent = currentDir()
    const nextKey = workspaceKey(nextCurrent)
    const project = layout.projects.list().find((item) => item.worktree === root)
    const dirs = project
      ? effectiveWorkspaceOrder(root, [root, ...(project.sandboxes ?? [])], getWorkspaceOrder(root))
      : [root]
    const valid = dirs.some((item) => workspaceKey(item) === nextKey)

    if (paramsDir() && projectRoot(nextCurrent) === root && !valid) {
      navigateWithSidebarReset(`/${base64Encode(root)}/session`)
    }
  }

  const resetWorkspace = async (root: string, directory: string) => {
    if (directory === root) return
    setBusy(directory, true)

    const progress = showToast({
      persistent: true,
      title: language.t("workspace.resetting.title"),
      description: language.t("workspace.resetting.description"),
    })
    const dismiss = () => toaster.dismiss(progress)

    const sessions: Session[] = await globalSDK.client.session
      .list({ directory })
      .then((x) => x.data ?? [])
      .catch(() => [])

    clearWorkspaceTerminals(
      directory,
      sessions.map((s) => s.id),
      platform,
    )
    await globalSDK.client.instance.dispose({ directory }).catch(() => undefined)

    const result = await globalSDK.client.worktree
      .reset({ directory: root, worktreeResetInput: { directory } })
      .then((x) => {
        if (x.error) throw x.error
        return x.data
      })
      .catch((err) => {
        showToast({
          title: language.t("workspace.reset.failed.title"),
          description: errorMessage(err, language.t("common.requestFailed")),
        })
        return false
      })

    if (!result) {
      setBusy(directory, false)
      dismiss()
      return
    }

    const archivedAt = Date.now()
    await Promise.all(
      sessions
        .filter((session) => session.time.archived === undefined)
        .map((session) =>
          globalSDK.client.session
            .update({
              sessionID: session.id,
              directory: session.directory,
              time: { archived: archivedAt },
            })
            .catch(() => undefined),
        ),
    )

    setBusy(directory, false)
    dismiss()

    showToast({
      title: language.t("workspace.reset.success.title"),
      description: language.t("workspace.reset.success.description"),
      actions: [
        {
          label: language.t("command.session.new"),
          onClick: () => {
            const href = `/${base64Encode(directory)}/session`
            navigate(href)
            layout.mobileSidebar.hide()
          },
        },
        {
          label: language.t("common.dismiss"),
          onClick: "dismiss",
        },
      ],
    })
  }

  return { deleteWorkspace, resetWorkspace }
}

// ── createWorkspace ─────────────────────────────────────────────────────────

interface WorkspaceCreateDeps {
  globalSDK: ReturnType<typeof useGlobalSDK>
  globalSync: ReturnType<typeof useGlobalSync>
  language: ReturnType<typeof useLanguage>
  setBusy: (directory: string, value: boolean) => void
  navigateWithSidebarReset: (href: string) => void
  setWorkspaceName: (directory: string, next: string, projectId?: string, branch?: string) => void
  setWorkspaceExpanded: (directory: string, value: boolean) => void
  setWorkspaceOrder: (root: string, updater: (order: string[] | undefined) => string[]) => void
  clearSidebarHoverState: () => void
}

export function createWorkspaceCreate(deps: WorkspaceCreateDeps) {
  const {
    globalSDK,
    globalSync,
    language,
    setBusy,
    navigateWithSidebarReset,
    setWorkspaceName,
    setWorkspaceExpanded,
    setWorkspaceOrder,
    clearSidebarHoverState,
  } = deps

  const createWorkspace = async (project: LocalProject) => {
    clearSidebarHoverState()
    const created = await globalSDK.client.worktree
      .create({ directory: project.worktree })
      .then((x) => x.data)
      .catch((err) => {
        showToast({
          title: language.t("workspace.create.failed.title"),
          description: errorMessage(err, language.t("common.requestFailed")),
        })
        return undefined
      })

    if (!created?.directory) return

    setWorkspaceName(created.directory, created.branch, project.id, created.branch)

    const local = project.worktree
    const key = workspaceKey(created.directory)
    const root = workspaceKey(local)

    setBusy(created.directory, true)
    WorktreeState.pending(created.directory)
    setWorkspaceExpanded(key, true)
    if (key !== created.directory) {
      setWorkspaceExpanded(created.directory, true)
    }
    setWorkspaceOrder(project.worktree, (prev) => {
      const existing = prev ?? []
      const next = existing.filter((item) => {
        const id = workspaceKey(item)
        return id !== root && id !== key
      })
      return [created.directory, ...next]
    })

    globalSync.child(created.directory)
    navigateWithSidebarReset(`/${base64Encode(created.directory)}/session`)
  }

  return { createWorkspace }
}
