/**
 * Factory for session revert/restore mutation state in the session page.
 * Extracted from session.tsx to keep that file under the 1500-LOC budget.
 *
 * Handles draft/line/fail helpers, merge/roll/busy session-state helpers,
 * revert + restore mutations, and the rolled/actions memos.
 */
import { batch, createMemo } from "solid-js"
import { useMutation } from "@tanstack/solid-query"
import type { useNavigate } from "@solidjs/router"
import { showToast } from "@unifia/ui/toast"
import type { UserMessage } from "../../types/sdk-shim"
import type { useSDK } from "@/context/sdk"
import type { useSync } from "@/context/sync"
import type { useLanguage } from "@/context/language"
import type { usePrompt } from "@/context/prompt"
import { extractPromptFromParts } from "@/utils/prompt"
import { formatServerError } from "@/utils/server-errors"

// The minimal shape of a session info object we need here.
type SessionInfo = {
  id: string
  revert?: { messageID: string } | undefined
  [key: string]: unknown
}

export interface SessionMutationsDeps {
  sdk: ReturnType<typeof useSDK>
  sync: ReturnType<typeof useSync>
  params: Record<string, string | undefined>
  info: () => SessionInfo | undefined
  prompt: ReturnType<typeof usePrompt>
  userMessages: () => UserMessage[]
  revertMessageID: () => string | undefined
  language: ReturnType<typeof useLanguage>
  navigate: ReturnType<typeof useNavigate>
}

export function createSessionMutations(deps: SessionMutationsDeps) {
  const { sdk, sync, params, info, prompt, userMessages, revertMessageID, language, navigate } = deps

  // ── Draft / display helpers ──────────────────────────────────────────────

  const draft = (id: string) =>
    extractPromptFromParts(sync.data.part[id] ?? [], {
      directory: sdk.directory,
      attachmentName: language.t("common.attachment"),
    })

  const line = (id: string) => {
    const text = draft(id)
      .map((part) => (part.type === "image" ? `[image:${part.filename}]` : part.content))
      .join("")
      .replace(/\s+/g, " ")
      .trim()
    if (text) return text
    return `[${language.t("common.attachment")}]`
  }

  // ── Error helper ─────────────────────────────────────────────────────────

  const fail = (err: unknown) => {
    showToast({
      variant: "error",
      title: language.t("common.requestFailed"),
      description: formatServerError(err, language.t),
    })
  }

  // ── Session-state writers ─────────────────────────────────────────────────

  const merge = (next: NonNullable<ReturnType<typeof info>>) =>
    sync.set("session", (list) => {
      const idx = list.findIndex((item) => item.id === next.id)
      if (idx < 0) return list
      const out = list.slice()
      out[idx] = next as (typeof list)[number]
      return out
    })

  const roll = (sessionID: string, next: NonNullable<ReturnType<typeof info>>["revert"]) =>
    sync.set("session", (list) => {
      const idx = list.findIndex((item) => item.id === sessionID)
      if (idx < 0) return list
      const out = list.slice()
      out[idx] = { ...out[idx], revert: next }
      return out
    })

  const busy = (sessionID: string) => {
    if ((sync.data.session_status[sessionID] ?? { type: "idle" as const }).type !== "idle") return true
    return (sync.data.message[sessionID] ?? []).some(
      (item) => item.role === "assistant" && typeof item.time.completed !== "number",
    )
  }

  const halt = (sessionID: string) =>
    busy(sessionID) ? sdk.client.session.abort({ sessionID }).catch(() => {}) : Promise.resolve()

  // ── Mutations ─────────────────────────────────────────────────────────────

  const revertMutation = useMutation(() => ({
    mutationFn: async (input: { sessionID: string; messageID: string }) => {
      const prev = prompt.current().slice()
      const last = info()?.revert
      const value = draft(input.messageID)
      batch(() => {
        roll(input.sessionID, { messageID: input.messageID })
        prompt.set(value)
      })
      await halt(input.sessionID)
        .then(() => sdk.client.session.revert(input))
        .then((result) => {
          if (result.data) merge(result.data as NonNullable<ReturnType<typeof info>>)
        })
        .catch((err) => {
          batch(() => {
            roll(input.sessionID, last)
            prompt.set(prev)
          })
          fail(err)
        })
    },
  }))

  const restoreMutation = useMutation(() => ({
    mutationFn: async (id: string) => {
      const sessionID = params.id
      if (!sessionID) return

      const next = userMessages().find((item) => item.id > id)
      const prev = prompt.current().slice()
      const last = info()?.revert

      batch(() => {
        roll(sessionID, next ? { messageID: next.id } : undefined)
        if (next) {
          prompt.set(draft(next.id))
          return
        }
        prompt.reset()
      })

      const task = !next
        ? halt(sessionID).then(() => sdk.client.session.unrevert({ sessionID }))
        : halt(sessionID).then(() =>
            sdk.client.session.revert({
              sessionID,
              messageID: next.id,
            }),
          )

      await task
        .then((result) => {
          if (result.data) merge(result.data as NonNullable<ReturnType<typeof info>>)
        })
        .catch((err) => {
          batch(() => {
            roll(sessionID, last)
            prompt.set(prev)
          })
          fail(err)
        })
    },
  }))

  // ── Fork mutation ───────────────────────────────────────────────────────────
  // Branches a new session from a past user message (message-level entry
  // point to the same sdk.client.session.fork() that dialog-fork.tsx's
  // message picker already uses). No optimistic roll(): fork does not
  // mutate the current session, it navigates away to a new one.

  const forkMutation = useMutation(() => ({
    mutationFn: async (input: { sessionID: string; messageID: string }) => {
      const dir = params.dir
      if (!dir) return
      const restored = draft(input.messageID)
      const result = await sdk.client.session.fork(input)
      if (!result.data) {
        fail(new Error(language.t("common.requestFailed")))
        return
      }
      prompt.set(restored, undefined, { dir, id: result.data.id })
      navigate(`/${dir}/session/${result.data.id}`)
    },
  }))

  // ── Derived state ─────────────────────────────────────────────────────────

  const reverting = createMemo(() => revertMutation.isPending || restoreMutation.isPending)
  const restoring = createMemo(() => (restoreMutation.isPending ? restoreMutation.variables : undefined))
  const forking = createMemo(() => forkMutation.isPending)

  const revert = (input: { sessionID: string; messageID: string }) => {
    if (reverting()) return
    return revertMutation.mutateAsync(input)
  }

  const restore = (id: string) => {
    if (!params.id || reverting()) return
    return restoreMutation.mutateAsync(id)
  }

  const fork = (input: { sessionID: string; messageID: string }) => {
    if (forking()) return
    return forkMutation.mutateAsync(input)
  }

  const rolled = createMemo(() => {
    const id = revertMessageID()
    if (!id) return []
    return userMessages()
      .filter((item) => item.id >= id)
      .map((item) => ({ id: item.id, text: line(item.id) }))
  })

  const actions = { revert, fork }

  return { fail, busy, reverting, restoring, forking, revert, restore, fork, rolled, actions }
}
