/**
 * Notification hooks extracted from layout.tsx
 *
 * - useUpdatePolling  : polls for app updates and shows a persistent toast
 * - useSDKNotificationToasts : listens to SDK events and shows per-session toasts
 */
import { createEffect, onCleanup, onMount, type Accessor } from "solid-js"
import { showToast, toaster } from "@opencode-ai/ui/toast"
import { getFilename } from "@opencode-ai/util/path"
import { base64Encode } from "@opencode-ai/util/encode"
import { playSoundById } from "@/utils/sound"
import { Worktree as WorktreeState } from "@/utils/worktree"
import { workspaceKey } from "./helpers"
import type { useGlobalSDK } from "@/context/global-sdk"
import type { useSettings } from "@/context/settings"
import type { usePlatform } from "@/context/platform"
import type { useLanguage } from "@/context/language"
import type { usePermission } from "@/context/permission"

// ---------------------------------------------------------------------------
// useUpdatePolling
// ---------------------------------------------------------------------------

export interface UpdatePollingDeps {
  platform: ReturnType<typeof usePlatform>
  settings: ReturnType<typeof useSettings>
  language: ReturnType<typeof useLanguage>
}

export function useUpdatePolling(deps: UpdatePollingDeps) {
  const { platform, settings, language } = deps

  onMount(() => {
    if (!platform.checkUpdate || !platform.update || !platform.restart) return

    let toastId: number | undefined
    let interval: ReturnType<typeof setInterval> | undefined

    const pollUpdate = () =>
      platform.checkUpdate!().then(({ updateAvailable, version }) => {
        if (!updateAvailable) return
        if (toastId !== undefined) return
        toastId = showToast({
          persistent: true,
          icon: "download",
          title: language.t("toast.update.title"),
          description: language.t("toast.update.description", { version: version ?? "" }),
          actions: [
            {
              label: language.t("toast.update.action.installRestart"),
              onClick: async () => {
                await platform.update!()
                await platform.restart!()
              },
            },
            {
              label: language.t("toast.update.action.notYet"),
              onClick: "dismiss",
            },
          ],
        })
      })

    createEffect(() => {
      if (!settings.ready()) return

      if (!settings.updates.startup()) {
        if (interval === undefined) return
        clearInterval(interval)
        interval = undefined
        return
      }

      if (interval !== undefined) return
      void pollUpdate()
      interval = setInterval(pollUpdate, 10 * 60 * 1000)
    })

    onCleanup(() => {
      if (interval === undefined) return
      clearInterval(interval)
    })
  })
}

// ---------------------------------------------------------------------------
// useSDKNotificationToasts
// ---------------------------------------------------------------------------

export interface SDKNotificationToastsDeps {
  globalSDK: ReturnType<typeof useGlobalSDK>
  globalSync: {
    child: ReturnType<typeof useGlobalSDK>["event"] extends never
      ? never
      : (dir: string, opts?: { bootstrap?: boolean }) => readonly [any, any]
  }
  settings: ReturnType<typeof useSettings>
  platform: ReturnType<typeof usePlatform>
  language: ReturnType<typeof useLanguage>
  permission: ReturnType<typeof usePermission>
  /** Reactive accessor — current directory */
  currentDir: Accessor<string>
  /** Reactive accessor — current session id from route params */
  paramsId: Accessor<string | undefined>
  /** Navigate to the given href */
  navigate: (href: string) => void
  /** Mark a directory as busy/not-busy */
  setBusy: (directory: string, value: boolean) => void
}

export function useSDKNotificationToasts(deps: SDKNotificationToastsDeps) {
  const {
    globalSDK,
    globalSync,
    settings,
    platform,
    language,
    permission,
    currentDir,
    paramsId,
    navigate,
    setBusy,
  } = deps

  onMount(() => {
    const toastBySession = new Map<string, number>()
    const alertedAtBySession = new Map<string, number>()
    const cooldownMs = 5000

    const dismissSessionAlert = (sessionKey: string) => {
      const toastId = toastBySession.get(sessionKey)
      if (toastId === undefined) return
      toaster.dismiss(toastId)
      toastBySession.delete(sessionKey)
      alertedAtBySession.delete(sessionKey)
    }

    const unsub = globalSDK.event.listen((e) => {
      if (e.details?.type === "worktree.ready") {
        setBusy(e.name, false)
        WorktreeState.ready(e.name)
        return
      }

      if (e.details?.type === "worktree.failed") {
        setBusy(e.name, false)
        WorktreeState.failed(e.name, e.details.properties?.message ?? language.t("common.requestFailed"))
        return
      }

      if (
        e.details?.type === "question.replied" ||
        e.details?.type === "question.rejected" ||
        e.details?.type === "permission.replied"
      ) {
        const props = e.details.properties as { sessionID: string }
        const sessionKey = `${e.name}:${props.sessionID}`
        dismissSessionAlert(sessionKey)
        return
      }

      if (e.details?.type !== "permission.asked" && e.details?.type !== "question.asked") return

      const title =
        e.details.type === "permission.asked"
          ? language.t("notification.permission.title")
          : language.t("notification.question.title")
      const icon = e.details.type === "permission.asked"
        ? ("checklist" as const)
        : ("bubble-5" as const)
      const directory = e.name
      const props = e.details.properties
      if (
        e.details.type === "permission.asked" &&
        permission.autoResponds(e.details.properties, directory)
      )
        return

      const [store] = globalSync.child(directory, { bootstrap: false })
      const session = store.session.find((s: any) => s.id === props.sessionID)
      const sessionKey = `${directory}:${props.sessionID}`

      const sessionTitle = session?.title ?? language.t("command.session.new")
      const projectName = getFilename(directory)
      const description =
        e.details.type === "permission.asked"
          ? language.t("notification.permission.description", { sessionTitle, projectName })
          : language.t("notification.question.description", { sessionTitle, projectName })
      const href = `/${base64Encode(directory)}/session/${props.sessionID}`

      const now = Date.now()
      const lastAlerted = alertedAtBySession.get(sessionKey) ?? 0
      if (now - lastAlerted < cooldownMs) return
      alertedAtBySession.set(sessionKey, now)

      if (e.details.type === "permission.asked") {
        if (settings.sounds.permissionsEnabled()) {
          void playSoundById(settings.sounds.permissions())
        }
        if (settings.notifications.permissions()) {
          void platform.notify(title, description, href)
        }
      }

      if (e.details.type === "question.asked") {
        if (settings.notifications.agent()) {
          void platform.notify(title, description, href)
        }
      }

      const currentSession = paramsId()
      if (
        workspaceKey(directory) === workspaceKey(currentDir()) &&
        props.sessionID === currentSession
      )
        return
      if (
        workspaceKey(directory) === workspaceKey(currentDir()) &&
        session?.parentID === currentSession
      )
        return

      dismissSessionAlert(sessionKey)

      const toastId = showToast({
        persistent: true,
        icon,
        title,
        description,
        actions: [
          {
            label: language.t("notification.action.goToSession"),
            onClick: () => navigate(href),
          },
          {
            label: language.t("common.dismiss"),
            onClick: "dismiss",
          },
        ],
      })
      toastBySession.set(sessionKey, toastId)
    })
    onCleanup(unsub)

    createEffect(() => {
      const currentSession = paramsId()
      if (!currentDir() || !currentSession) return
      const sessionKey = `${currentDir()}:${currentSession}`
      dismissSessionAlert(sessionKey)
      const [store] = globalSync.child(currentDir(), { bootstrap: false })
      const childSessions = store.session.filter((s: any) => s.parentID === currentSession)
      for (const child of childSessions) {
        dismissSessionAlert(`${currentDir()}:${child.id}`)
      }
    })
  })
}
