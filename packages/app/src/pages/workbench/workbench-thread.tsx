/* SPDX-License-Identifier: MIT */

import { For, Show, createEffect, createMemo, createSignal, type JSX } from "solid-js"
import { useLanguage } from "@/context/language"
import { useSync } from "@/context/sync"
import { Button } from "@unifia/ui/button"
import { DockShellForm, DockTray } from "@unifia/ui/dock-surface"
import { buildAttachedCommentsPrompt, createSkillPickerRows, type AttachedComment, type CommentState, type SkillPickerRow } from "@unifia/workbench-shell"
import { buildDesignSkillContext, type DesignSkillManifest } from "@unifia/skill-hub"
import { createWorkbenchSession } from "@/pages/workbench/workbench-session"
import { ConnectionBanner } from "@/pages/workbench/connection-banner"
import { ThreadCommentAttachPanel } from "@/pages/workbench/thread-comment-attach-panel"
import { WorkbenchThreadList } from "@/pages/workbench/workbench-thread-list"
import {
  addComposerAttachment,
  buildAttachmentPath,
  buildAttachmentReferences,
  markComposerAttachmentFailed,
  markComposerAttachmentUploaded,
  removeComposerAttachment,
  type ComposerAttachment,
} from "@/pages/workbench/composer-attachment"
import { buildActiveDesignSystemHint, type DesignCatalogRef } from "@/pages/workbench/context-chips"
import { SkillPicker } from "@/pages/workbench/skill-picker"
import {
  addPendingSend,
  extractMessageText,
  findRegenerateTarget,
  markPendingSendFailed,
  markPendingSendRetrying,
  removePendingSend,
  selectNextStepSuggestions,
  type NextStepSuggestion,
  type PendingSend,
} from "@/pages/workbench/workbench-thread-shared"

export type WorkbenchThreadProps = {
  mode: "work" | "design" | "automate"
  /** Placeholder shown in the composer; matches the chat semantics. */
  prompt: string
  /** Subtitle of the conversation header. */
  description: string
  /** Connection attribute names for the banner, taken from `ConnectionBanner` props. */
  connection: {
    dataAttr: "workbench-connection" | "design-connection" | "automate-connection"
    dataRetryAttr: "workbench-retry" | "design-retry" | "automate-retry"
  }
  /**
   * Phase 10.3 — "Commenter la conversation". Only Design mode has
   * element comments to attach (they reference `data-unifia-id`s inside
   * an artifact render); Work/Automate omit this prop entirely and the
   * header button doesn't render — there is nothing to comment on there.
   */
  comments?: {
    state: CommentState
    attachedIds: ReadonlySet<string>
    onToggleAttach: (commentId: string) => void
    /** Called once the attached set has actually been consumed by a send. */
    onClearAttached: () => void
    /** Resolves the entryFile for a comment's artifactId (from the live stream of open artifacts). `undefined` if that artifact tab was never opened this session. */
    resolveEntryFile: (artifactId: string) => string | undefined
  }
  /**
   * Phase 10.4 — composer file attachments. Only Design mode wires this
   * (mirrors `comments` above): Work/Automate still render the older
   * `WorkbenchChat` card, not this component, so there's nothing to wire
   * there yet. `upload` writes `path` via the same route Phase 7.3's file
   * tab uses (`createFiles`) — path generation itself
   * (`buildAttachmentPath`) stays here so it's covered by this module's
   * own tests rather than duplicated in every caller.
   */
  files?: {
    upload: (path: string, file: File) => Promise<void>
  }
  /**
   * Phase 10.5 — context-chips row under the composer: which design
   * system(s) (from `manifest.data?.designSystems`, already loaded by
   * `DesignSurface`) are marked active for the next message. Design-only,
   * like `comments` above.
   */
  contextChips?: {
    catalogs: readonly DesignCatalogRef[]
    activeIds: ReadonlySet<string>
    onToggleActive: (id: string) => void
  }
  skills?: {
    skills: readonly DesignSkillManifest[]
    hasDesignSystem: boolean
  }
}

const MODE_KEY = {
  work: "workbench.chat.work",
  design: "workbench.chat.design",
  automate: "workbench.chat.automate",
} as const

/**
 * The Open Design chat column, ported for Unifia.
 *
 * Open Design is a conversation that owns the column: a sticky header, a
 * scrolling list, and a composer that is a SIBLING of the list (not a
 * descendant) so the input stays anchored while the messages scroll.
 * Unifia previously inlined the same conversation inside a single card
 * (`max-h-56` scrollable region inside a card), which made the editor read
 * as a spec page with a chat widget instead of a conversation with an
 * artifact atelier.
 *
 * Why the composer is a sibling of the list and not a child: a child composer
 * inside a `flex-1 overflow-y-auto` list scrolls away with the last message,
 * which is what we were seeing — the input disappeared the moment the
 * assistant answered. Open Design avoids that by giving the composer its own
 * row beneath the scrollable region.
 *
 * Phase 7 — visual parity with the Code session chat. The message bubbles
 * reuse the exact `[data-component="user-message"]` / `[data-component="text-part"]`
 * slot markup that `@unifia/ui`'s `message-part.css` already styles for the
 * Code mode timeline (see `packages/ui/src/components/message-part.css`).
 * Reusing the CSS selectors gives pixel parity without importing `SessionTurn`
 * itself — that component (and `message-part.tsx`) is wired to `useData()` /
 * `useFileComponent()`, context providers that only exist above the Code
 * session route. Importing it here would mean mounting that provider tree
 * under Workbench too, which is an architecture change this pass doesn't
 * need: the ask was visual parity, not functional parity with tool-call
 * rendering. The composer shell reuses `DockShellForm` / `DockTray` from
 * `@unifia/ui/dock-surface` for the same reason — same rounded-card chrome
 * as `PromptInput`, zero context dependency.
 */
export function WorkbenchThread(props: WorkbenchThreadProps): JSX.Element {
  const sync = useSync()
  const language = useLanguage()
  const t = language.t
  const [input, setInput] = createSignal("")
  const [regenerating, setRegenerating] = createSignal(false)
  const [error, setError] = createSignal<string>()
  const [feedback, setFeedback] = createSignal<Record<string, "like" | "dislike" | undefined>>({})
  // Phase 10.2 — each composer submission that hasn't landed in
  // `sync.data` yet lives here, not behind a single `sending` gate: two
  // concurrent sends must be able to fail independently, each with its
  // own Retry button (see PendingSend in workbench-thread-shared.ts).
  const [pendingSends, setPendingSends] = createSignal<readonly PendingSend[]>([])
  // Phase 10.3 — open state of the "Commenter la conversation" popover.
  const [attachPanelOpen, setAttachPanelOpen] = createSignal(false)
  // Phase 10.4 — composer file attachments, uploaded as soon as they're
  // picked/dropped (not deferred to submit time) so the composer can show
  // a thumbnail and gate Send on the upload actually finishing.
  const [attachments, setAttachments] = createSignal<readonly ComposerAttachment[]>([])
  const [activeSkillId, setActiveSkillId] = createSignal<string>()
  const [skillPickerOpen, setSkillPickerOpen] = createSignal(false)
  let fileInputRef: HTMLInputElement | undefined

  const modeTitle = () => t(MODE_KEY[props.mode])
  const modeTitleSession = () => t("workbench.chat.sessionTitle", { mode: modeTitle() })
  // The session is owned by the route, not by this thread: every Workbench
  // surface of the workspace shows the same conversation.
  const session = createWorkbenchSession({ title: modeTitleSession })
  const activeSessionId = session.id

  createEffect(() => {
    const sessionId = activeSessionId()
    if (sessionId) void sync.session.sync(sessionId).catch((reason) => setError(reason instanceof Error ? reason.message : String(reason)))
  })

  const messages = createMemo(() => {
    const sessionId = activeSessionId()
    if (!sessionId) return []
    return (sync.data.message[sessionId] ?? [])
      .map((message) => ({
        id: message.id,
        role: message.role,
        text: extractMessageText(sync.data.part[message.id]),
      }))
      .filter((message) => message.text)
  })

  const lastAssistantId = createMemo(() => {
    const list = messages()
    for (let i = list.length - 1; i >= 0; i -= 1) {
      if (list[i]?.role === "assistant") return list[i]?.id
    }
    return undefined
  })

  /**
   * Phase 10.3 — resolves the current attachedIds into a refine prompt and
   * prefixes it onto the next outgoing message, mirroring exactly what
   * `CommentPanel.sendBatch()` already does for its own "Envoyer" button
   * (the technical prompt IS the message content that gets sent and, once
   * synced, rendered as this user's own bubble — same precedent, not a
   * new pattern). Returns "" when there's nothing to attach, or when none
   * of the attached comments' artifacts could be resolved to an
   * `entryFile` (their tab was never opened this session) — in that case
   * `attachedIds` is left untouched so the user can retry once the tab is
   * open. Clears `attachedIds` (optimistically, same as `sendBatch`'s
   * immediate `markSent`) the moment at least one comment WAS resolved.
   */
  function buildAttachedPrefix(): string {
    const comments = props.comments
    if (!comments || comments.attachedIds.size === 0) return ""
    const attached = comments.state.comments.filter((c) => comments.attachedIds.has(c.id))
    const resolved: AttachedComment[] = []
    for (const comment of attached) {
      const entryFile = comments.resolveEntryFile(comment.artifactId)
      if (entryFile) resolved.push({ ...comment, entryFile })
    }
    if (resolved.length === 0) return ""
    comments.onClearAttached()
    return buildAttachedCommentsPrompt(resolved)
  }

  async function submit(): Promise<void> {
    const raw = input().trim()
    const uploaded = attachments().filter((a) => a.status === "uploaded")
    if (!raw && uploaded.length === 0) return
    setInput("")
    const prefix = buildAttachedPrefix()
    const designSystemHint = props.contextChips
      ? buildActiveDesignSystemHint(props.contextChips.catalogs, props.contextChips.activeIds)
      : ""
    const activeSkill = props.skills?.skills.find((skill) => skill.name === activeSkillId())
    const skillContext = activeSkill ? buildDesignSkillContext(activeSkill) : ""
    const attachmentBlock = buildAttachmentReferences(attachments())
    const text = [skillContext, prefix, designSystemHint, raw, attachmentBlock].filter((part) => part.length > 0).join("\n\n")
    if (uploaded.length > 0) {
      // Already-referenced attachments are cleared immediately (same
      // optimistic timing as the comment-attach prefix above) — the files
      // themselves stay uploaded in the workspace regardless of whether
      // this particular chat message send later fails and gets retried.
      for (const a of uploaded) if (a.previewUrl) URL.revokeObjectURL(a.previewUrl)
      setAttachments((list) => list.filter((a) => a.status !== "uploaded"))
    }
    const id = crypto.randomUUID()
    setPendingSends((list) => addPendingSend(list, id, text))
    await sendPending(id, text)
  }

  /** Phase 10.2 — the actual send, shared by `submit()` and `retryPendingSend()`. */
  async function sendPending(id: string, text: string): Promise<void> {
    try {
      await session.prompt(text)
      setPendingSends((list) => removePendingSend(list, id))
    } catch {
      // The generic bottom-of-thread error banner is gone for send
      // failures specifically — the failed bubble itself carries its own
      // Retry button now (porte: two concurrent failures, two independent
      // buttons). `error` stays reserved for non-send failures (session
      // sync, below).
      setPendingSends((list) => markPendingSendFailed(list, id))
    }
  }

  function retryPendingSend(id: string): void {
    const target = pendingSends().find((p) => p.id === id)
    if (!target) return
    setPendingSends((list) => markPendingSendRetrying(list, id))
    void sendPending(id, target.text)
  }

  /** Phase 10.4 — uploads one picked/dropped file, tracking its own attachment row. */
  function attachFile(file: File): void {
    const id = crypto.randomUUID()
    const previewUrl = file.type.startsWith("image/") ? URL.createObjectURL(file) : undefined
    setAttachments((list) => addComposerAttachment(list, { id, name: file.name, status: "uploading", previewUrl }))
    const upload = props.files
    if (!upload) {
      setAttachments((list) => markComposerAttachmentFailed(list, id, "Pièces jointes indisponibles dans ce mode"))
      return
    }
    const path = buildAttachmentPath(file.name)
    void upload
      .upload(path, file)
      .then(() => setAttachments((list) => markComposerAttachmentUploaded(list, id, path)))
      .catch((reason: unknown) =>
        setAttachments((list) =>
          markComposerAttachmentFailed(list, id, reason instanceof Error ? reason.message : String(reason)),
        ),
      )
  }

  function attachFiles(files: FileList | readonly File[]): void {
    for (const file of Array.from(files)) attachFile(file)
  }

  function removeAttachment(id: string): void {
    const target = attachments().find((a) => a.id === id)
    if (target?.previewUrl) URL.revokeObjectURL(target.previewUrl)
    setAttachments((list) => removeComposerAttachment(list, id))
  }

  function applySuggestion(suggestion: NextStepSuggestion): void {
    setInput(suggestion.prompt)
  }

  /**
   * Phase 10.1 — reverts to the user message that prompted
   * `assistantMessageId` (excluding it and the answer being regenerated
   * from active history) and resends its exact text. See `revert`'s doc
   * comment in `workbench-session.ts` for why this can't duplicate the
   * user message.
   */
  async function regenerate(assistantMessageId: string): Promise<void> {
    if (regenerating()) return
    const target = findRegenerateTarget(messages(), assistantMessageId)
    if (!target) return
    setRegenerating(true)
    setError(undefined)
    try {
      await session.revert(target.userMessageId)
      await session.prompt(target.userText)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setRegenerating(false)
    }
  }

  async function copyMessage(messageId: string, text: string): Promise<void> {
    if (typeof navigator === "undefined" || !navigator.clipboard) return
    try {
      await navigator.clipboard.writeText(text)
      setFeedback((current) => ({ ...current, [messageId]: "like" }))
    } catch {
      // Clipboard refused (permissions, secure context missing): the user
      // already sees the message, nothing actionable for us to surface.
    }
  }

  function rate(messageId: string, value: "like" | "dislike"): void {
    setFeedback((current) => ({ ...current, [messageId]: value }))
  }

  const suggestions = (): readonly NextStepSuggestion[] => selectNextStepSuggestions(props.mode)

  return (
    <section class="flex h-full min-h-0 flex-col" data-workbench-thread={props.mode}>
      <header
        class="sticky top-0 z-10 flex flex-wrap items-start justify-between gap-3 border-b border-border-base bg-background-stronger px-4 py-3"
        data-workbench-thread-header
      >
        <div class="min-w-0">
          <p class="text-12-medium uppercase tracking-wide text-text-weak">{modeTitle()}</p>
          <h1 class="mt-1 truncate text-16-medium text-text-strong">{props.description}</h1>
        </div>
        <div class="flex items-center gap-2">
          <Show when={props.comments}>
            {(comments) => (
              <div class="relative">
                <button
                  type="button"
                  class="rounded border border-border-base px-2 py-1 text-12-regular"
                  classList={{ "border-border-focus": comments().attachedIds.size > 0 }}
                  data-workbench-thread-comment
                  aria-label="Commenter la conversation"
                  title="Commenter la conversation"
                  onClick={() => setAttachPanelOpen((open) => !open)}
                >
                  Commenter{comments().attachedIds.size > 0 ? ` (${comments().attachedIds.size})` : ""}
                </button>
                <div class="absolute right-0 top-full z-20 mt-1">
                  <ThreadCommentAttachPanel
                    open={attachPanelOpen()}
                    comments={comments().state.comments}
                    attachedIds={comments().attachedIds}
                    onToggle={comments().onToggleAttach}
                    onClose={() => setAttachPanelOpen(false)}
                  />
                </div>
              </div>
            )}
          </Show>
        </div>
      </header>
      <div class="border-b border-border-base px-4 py-2" data-workbench-thread-connection>
        <ConnectionBanner dataAttr={props.connection.dataAttr} dataRetryAttr={props.connection.dataRetryAttr} />
      </div>
      <WorkbenchThreadList
        messages={messages()}
        pendingSends={pendingSends()}
        lastAssistantId={lastAssistantId()}
        feedback={feedback()}
        regenerating={regenerating()}
        suggestions={suggestions()}
        t={t}
        onCopy={(messageId, text) => void copyMessage(messageId, text)}
        onRegenerate={(assistantMessageId) => void regenerate(assistantMessageId)}
        onRate={rate}
        onRetryPending={retryPendingSend}
        onApplySuggestion={applySuggestion}
      />
      <DockShellForm
        class="mx-4 mb-3 mt-2 flex flex-col"
        data-workbench-thread-composer
        onSubmit={(event) => {
          event.preventDefault()
          void submit()
        }}
        onDragOver={(event) => event.preventDefault()}
        onDrop={(event) => {
          event.preventDefault()
          const files = event.dataTransfer?.files
          if (files && files.length > 0) attachFiles(files)
        }}
      >
        <input
          ref={(el) => {
            fileInputRef = el
          }}
          type="file"
          multiple
          class="hidden"
          data-workbench-thread-file-input
          onChange={(event) => {
            const files = event.currentTarget.files
            if (files && files.length > 0) attachFiles(files)
            event.currentTarget.value = ""
          }}
        />
        <Show when={attachments().length > 0}>
          <ul class="flex flex-wrap gap-2 px-3 pt-3" data-workbench-thread-attachments>
            <For each={attachments()}>
              {(attachment) => (
                <li
                  class="flex items-center gap-2 rounded border border-border-base bg-background-base px-2 py-1"
                  data-workbench-thread-attachment={attachment.id}
                  data-workbench-thread-attachment-status={attachment.status}
                >
                  <Show
                    when={attachment.previewUrl}
                    fallback={<span class="text-12-regular text-text-weak" aria-hidden="true">📎</span>}
                  >
                    {(url) => <img src={url()} alt="" class="size-6 rounded object-cover" />}
                  </Show>
                  <span class="max-w-[140px] truncate text-12-regular">{attachment.name}</span>
                  <Show when={attachment.status === "uploading"}>
                    <span class="text-10-regular text-text-weak">…</span>
                  </Show>
                  <Show when={attachment.status === "error"}>
                    <span class="text-10-regular text-text-danger" title={attachment.error}>
                      Échec
                    </span>
                  </Show>
                  <button
                    type="button"
                    class="rounded px-1 text-10-regular text-text-weak hover:text-text-base"
                    aria-label={`Retirer ${attachment.name}`}
                    data-workbench-thread-attachment-remove={attachment.id}
                    onClick={() => removeAttachment(attachment.id)}
                  >
                    ×
                  </button>
                </li>
              )}
            </For>
          </ul>
        </Show>
        <label class="sr-only" for={`workbench-thread-${props.mode}`}>
          {t("workbench.chat.messageFor", { mode: modeTitle() })}
        </label>
        <textarea
          id={`workbench-thread-${props.mode}`}
          class="min-h-24 w-full resize-y bg-transparent px-3 pt-3 text-14-regular text-text-strong placeholder:text-text-weak focus:outline-none"
          data-workbench-thread-input
          placeholder={props.prompt}
          value={input()}
          onInput={(event) => setInput(event.currentTarget.value)}
        />
        <DockTray attach="top" class="flex items-center justify-between gap-3 px-3 py-2">
          <div class="flex items-center gap-2">
            <p class="text-12-regular text-text-weak">{t("workbench.chat.reviewResult")}</p>
            <Show when={props.skills}>
              {(skills) => {
                const rows = () => createSkillPickerRows({ skills: skills().skills, selectedId: activeSkillId(), hasDesignSystem: skills().hasDesignSystem })
                const active = () => skills().skills.find((skill) => skill.name === activeSkillId())
                const selectSkill = (row: SkillPickerRow) => {
                  setActiveSkillId(row.id)
                  setSkillPickerOpen(false)
                }
                return (
                  <div class="relative">
                    <button
                      type="button"
                      class="rounded border border-border-base px-2 py-1 text-12-regular"
                      data-workbench-skill-picker-trigger
                      aria-expanded={skillPickerOpen()}
                      onClick={() => setSkillPickerOpen((open) => !open)}
                    >
                      {active()?.name ?? "Aucun skill"}
                    </button>
                    <Show when={skillPickerOpen()}>
                      <div class="absolute bottom-full left-0 z-20 mb-2 w-80 rounded-lg border border-border-base bg-background-stronger p-3 shadow-lg">
                        <SkillPicker rows={rows()} hasDesignSystem={skills().hasDesignSystem} onSelect={selectSkill} />
                      </div>
                    </Show>
                  </div>
                )
              }}
            </Show>
            <Show when={props.files}>
              <button
                type="button"
                class="rounded border border-border-base px-2 py-1 text-12-regular"
                data-workbench-thread-attach
                aria-label="Joindre un fichier"
                title="Joindre un fichier"
                onClick={() => fileInputRef?.click()}
              >
                📎
              </button>
            </Show>
          </div>
          <Button
            type="submit"
            variant="primary"
            size="normal"
            data-workbench-thread-submit
            disabled={
              (!input().trim() && attachments().every((a) => a.status !== "uploaded")) ||
              attachments().some((a) => a.status === "uploading")
            }
          >
            {pendingSends().some((p) => p.status === "sending") ? t("workbench.chat.sending") : t("workbench.chat.send")}
          </Button>
        </DockTray>
      </DockShellForm>
      <Show when={(props.contextChips && props.contextChips.catalogs.length > 0) || attachments().some((a) => a.status === "uploaded")}>
        <ul class="mx-4 mb-3 flex flex-wrap gap-2" data-workbench-thread-context-chips>
          <Show when={props.contextChips}>
            {(contextChips) => (
              <For each={contextChips().catalogs}>
                {(catalog) => {
                  const active = () => contextChips().activeIds.has(catalog.id)
                  return (
                    <li>
                      <button
                        type="button"
                        class="rounded-full border border-border-base px-2 py-0.5 text-10-regular"
                        classList={{ "border-border-focus bg-background-base": active() }}
                        data-workbench-thread-chip="design-system"
                        data-workbench-thread-chip-active={active() ? "true" : "false"}
                        aria-pressed={active()}
                        title={`${catalog.name} v${catalog.version}`}
                        onClick={() => contextChips().onToggleActive(catalog.id)}
                      >
                        {catalog.name}
                      </button>
                    </li>
                  )
                }}
              </For>
            )}
          </Show>
          <For each={attachments().filter((a) => a.status === "uploaded")}>
            {(attachment) => (
              <li>
                <span
                  class="rounded-full border border-border-weak-base px-2 py-0.5 text-10-regular text-text-weak"
                  data-workbench-thread-chip="attachment"
                >
                  📎 {attachment.name}
                </span>
              </li>
            )}
          </For>
        </ul>
      </Show>
      <Show when={error()}>
        <p class="mx-4 mb-2 text-12-regular text-text-danger" role="alert" data-workbench-thread-error>
          {error()}
        </p>
      </Show>
    </section>
  )
}
