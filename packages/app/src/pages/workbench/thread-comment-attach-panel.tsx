/* SPDX-License-Identifier: MIT */

import { For, Show, createMemo, type JSX } from "solid-js"
import type { DesignComment } from "@unifia/workbench-shell"
import { partitionAttachedComments } from "@/pages/workbench/thread-comment-attach"

/**
 * Phase 10.3 — "Commenter la conversation" popover.
 *
 * NOT a reuse of `CommentPanel` (section 8): that component is scoped to
 * one artifact (`artifactId`/`entryFile`/`targetElementId` props), its
 * three sections are Open/Sent/Resolved (a comment's own workflow
 * status), and its "Ajouter" flow requires a freshly-picked element
 * target. This panel is opened from the thread header — not scoped to
 * any single artifact tab — and its two sections (Attachés/Enregistrés)
 * are a completely different axis: whether a comment rides along with
 * the NEXT message, independent of its open/sent/resolved status.
 * Bolting a third rendering mode onto `CommentPanel` for this would have
 * meant conditional props threading through an already 270-line
 * component for a UI shape it wasn't built for. Same French-only,
 * no-i18n convention as `CommentPanel`/`CommentPopover` (this UI predates
 * i18n and the parity test doesn't cover it).
 */
export function ThreadCommentAttachPanel(props: {
  open: boolean
  comments: readonly DesignComment[]
  attachedIds: ReadonlySet<string>
  onToggle: (commentId: string) => void
  onClose: () => void
}): JSX.Element {
  const partition = createMemo(() => partitionAttachedComments(props.comments, props.attachedIds))

  return (
    <Show when={props.open}>
      <div
        class="flex w-80 flex-col gap-3 rounded-lg border border-border-base bg-background-stronger p-3 shadow-md"
        data-thread-comment-attach-panel
        role="dialog"
        aria-label="Commenter la conversation"
      >
        <div class="flex items-center justify-between">
          <h2 class="text-14-medium">Commenter la conversation</h2>
          <button
            type="button"
            class="rounded px-1 text-12-regular text-text-weak hover:text-text-base"
            data-thread-comment-attach-close
            aria-label="Fermer"
            onClick={() => props.onClose()}
          >
            ×
          </button>
        </div>
        <Show when={partition().attached.length === 0 && partition().saved.length === 0}>
          <p class="text-12-regular text-text-weak" data-thread-comment-attach-empty>
            Aucun commentaire pour l'instant. Ajoute-en un depuis un artefact avant de l'attacher ici.
          </p>
        </Show>
        <Show when={partition().attached.length > 0}>
          <section data-thread-comment-attach-section="attached">
            <h3 class="text-12-medium uppercase tracking-wide text-text-weak">
              Attachés ({partition().attached.length})
            </h3>
            <p class="mt-1 text-10-regular text-text-weak">Inclus comme contexte dans le prochain message envoyé.</p>
            <ul class="mt-2 flex max-h-40 flex-col gap-2 overflow-y-auto">
              <For each={partition().attached}>
                {(comment) => (
                  <li
                    class="rounded border border-border-focus bg-background-base p-2"
                    data-thread-comment-attach-row={comment.id}
                  >
                    <div class="flex items-center justify-between gap-2">
                      <span class="truncate text-10-regular text-text-weak">{comment.elementId}</span>
                      <button
                        type="button"
                        class="shrink-0 rounded px-1 text-10-regular text-text-weak hover:text-text-base"
                        data-thread-comment-attach-toggle={comment.id}
                        onClick={() => props.onToggle(comment.id)}
                      >
                        Détacher
                      </button>
                    </div>
                    <p class="mt-1 truncate text-12-regular">{comment.note}</p>
                  </li>
                )}
              </For>
            </ul>
          </section>
        </Show>
        <Show when={partition().saved.length > 0}>
          <section data-thread-comment-attach-section="saved">
            <h3 class="text-12-medium uppercase tracking-wide text-text-weak">
              Enregistrés ({partition().saved.length})
            </h3>
            <ul class="mt-2 flex max-h-40 flex-col gap-2 overflow-y-auto">
              <For each={partition().saved}>
                {(comment) => (
                  <li
                    class="rounded border border-border-base bg-background-base p-2"
                    data-thread-comment-attach-row={comment.id}
                  >
                    <div class="flex items-center justify-between gap-2">
                      <span class="truncate text-10-regular text-text-weak">{comment.elementId}</span>
                      <button
                        type="button"
                        class="shrink-0 rounded bg-primary px-1 text-10-medium text-primary-foreground"
                        data-thread-comment-attach-toggle={comment.id}
                        onClick={() => props.onToggle(comment.id)}
                      >
                        Attacher
                      </button>
                    </div>
                    <p class="mt-1 truncate text-12-regular">{comment.note}</p>
                  </li>
                )}
              </For>
            </ul>
          </section>
        </Show>
      </div>
    </Show>
  )
}
