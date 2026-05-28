/**
 * Factory for followup-queue state management in the session page.
 * Extracted from session.tsx to keep that file under the 1500-LOC budget.
 *
 * Exports FollowupItem and FollowupEdit so session.tsx can use them for
 * the persisted store type, without redefining them locally.
 */
import { createEffect, createMemo } from "solid-js"
import type { SetStoreFunction } from "solid-js/store"
import { useMutation } from "@tanstack/solid-query"
import { sendFollowupDraft, type FollowupDraft } from "@/components/prompt-input/submit"
import { Identifier } from "@/utils/id"
import type { useSDK } from "@/context/sdk"
import type { useSync } from "@/context/sync"
import type { useGlobalSync } from "@/context/global-sync"
import type { useSettings } from "@/context/settings"
import type { useLanguage } from "@/context/language"

export type FollowupItem = FollowupDraft & { id: string }
export type FollowupEdit = Pick<FollowupItem, "id" | "prompt" | "context">

export interface FollowupStore {
  items: Record<string, FollowupItem[] | undefined>
  failed: Record<string, string | undefined>
  paused: Record<string, boolean | undefined>
  edit: Record<string, FollowupEdit | undefined>
}

const emptyFollowups: FollowupItem[] = []

interface FollowupStateDeps {
  sessionID: () => string | undefined
  followup: FollowupStore
  setFollowup: SetStoreFunction<FollowupStore>
  sdk: ReturnType<typeof useSDK>
  sync: ReturnType<typeof useSync>
  globalSync: ReturnType<typeof useGlobalSync>
  settings: ReturnType<typeof useSettings>
  language: ReturnType<typeof useLanguage>
  composer: { blocked: () => boolean }
  isBusy: (sessionID: string) => boolean
  resumeScroll: () => void
  onError: (err: unknown) => void
}

export function createFollowupState(deps: FollowupStateDeps) {
  const { sessionID, followup, setFollowup, sdk, sync, globalSync, settings, language, composer, isBusy, resumeScroll, onError } =
    deps

  const queuedFollowups = createMemo(() => {
    const id = sessionID()
    if (!id) return emptyFollowups
    return followup.items[id] ?? emptyFollowups
  })

  const editingFollowup = createMemo(() => {
    const id = sessionID()
    if (!id) return
    return followup.edit[id]
  })

  const followupMutation = useMutation(() => ({
    mutationFn: async (input: { sessionID: string; id: string; manual?: boolean }) => {
      const item = (followup.items[input.sessionID] ?? []).find((entry) => entry.id === input.id)
      if (!item) return

      if (input.manual) setFollowup("paused", input.sessionID, undefined)
      setFollowup("failed", input.sessionID, undefined)

      const ok = await sendFollowupDraft({
        client: sdk.client,
        sync,
        globalSync,
        draft: item,
        optimisticBusy: item.sessionDirectory === sdk.directory,
      }).catch((err) => {
        setFollowup("failed", input.sessionID, input.id)
        onError(err)
        return false
      })
      if (!ok) return

      setFollowup("items", input.sessionID, (items) => (items ?? []).filter((entry) => entry.id !== input.id))
      if (input.manual) resumeScroll()
    },
  }))

  const followupBusy = (sid: string) =>
    followupMutation.isPending && followupMutation.variables?.sessionID === sid

  const sendingFollowup = createMemo(() => {
    const id = sessionID()
    if (!id) return
    if (!followupBusy(id)) return
    return followupMutation.variables?.id
  })

  const queueEnabled = createMemo(() => {
    const id = sessionID()
    if (!id) return false
    return settings.general.followup() === "queue" && isBusy(id) && !composer.blocked()
  })

  const followupText = (item: FollowupDraft) => {
    const text = item.prompt
      .map((part) => {
        if (part.type === "image") return `[image:${part.filename}]`
        if (part.type === "file") return `[file:${part.path}]`
        if (part.type === "agent") return `@${part.name}`
        return part.content
      })
      .join("")
      .split(/\r?\n/)
      .map((l) => l.trim())
      .find((l) => !!l)

    if (text) return text
    return `[${language.t("common.attachment")}]`
  }

  const queueFollowup = (draft: FollowupDraft) => {
    setFollowup("items", draft.sessionID, (items) => [
      ...(items ?? []),
      { id: Identifier.ascending("message"), ...draft },
    ])
    setFollowup("failed", draft.sessionID, undefined)
    setFollowup("paused", draft.sessionID, undefined)
  }

  const followupDock = createMemo(() => queuedFollowups().map((item) => ({ id: item.id, text: followupText(item) })))

  const sendFollowup = (sid: string, id: string, opts?: { manual?: boolean }) => {
    const item = (followup.items[sid] ?? []).find((entry) => entry.id === id)
    if (!item) return Promise.resolve()
    if (followupBusy(sid)) return Promise.resolve()
    return followupMutation.mutateAsync({ sessionID: sid, id, manual: opts?.manual })
  }

  const editFollowup = (id: string) => {
    const sid = sessionID()
    if (!sid) return
    if (followupBusy(sid)) return

    const item = queuedFollowups().find((entry) => entry.id === id)
    if (!item) return

    setFollowup("items", sid, (items) => (items ?? []).filter((entry) => entry.id !== id))
    setFollowup("failed", sid, (value) => (value === id ? undefined : value))
    setFollowup("edit", sid, {
      id: item.id,
      prompt: item.prompt,
      context: item.context,
    })
  }

  const clearFollowupEdit = () => {
    const id = sessionID()
    if (!id) return
    setFollowup("edit", id, undefined)
  }

  // Auto-send: when the session is idle and there is a queued followup, fire it.
  createEffect(() => {
    const id = sessionID()
    if (!id) return
    const item = queuedFollowups()[0]
    if (!item) return
    if (followupBusy(id)) return
    if (followup.failed[id] === item.id) return
    if (followup.paused[id]) return
    if (composer.blocked()) return
    if (isBusy(id)) return
    void sendFollowup(id, item.id)
  })

  return {
    queuedFollowups,
    editingFollowup,
    followupBusy,
    sendingFollowup,
    queueEnabled,
    followupText,
    queueFollowup,
    followupDock,
    sendFollowup,
    editFollowup,
    clearFollowupEdit,
  }
}
