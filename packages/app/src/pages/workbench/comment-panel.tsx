/* SPDX-License-Identifier: MIT */

import { For, Show, createEffect, createMemo, createSignal, type JSX } from "solid-js"
import {
  EMPTY_COMMENT_STATE,
  addComment,
  buildRefineBatchPrompt,
  canSend,
  commentsForElement,
  markResolved,
  markSent,
  openComments,
  removeComment,
  updateComment,
  type CommentState,
  type CommentTargetRect,
  type DesignComment,
} from "@unifia/workbench-shell"
import { CommentPopover } from "@/pages/workbench/comment-popover"

/**
 * P19 + P20 — Panneau latéral listant les commentaires Design d'un
 * artefact ET câblant l'envoi à l'agent.
 *
 * Trois zones : Ouverts (éditables, envoyables), Envoyés (immutables,
 * P20 marque `sent` après l'envoi), Résolus (immutables, traçabilité).
 *
 * P20 — Le bouton "Tout envoyer" duplique le contenu de chaque open
 * via `buildRefineBatchPrompt` et appelle `props.onSendBatch(prompt)`.
 * Le parent (design-surface) décide comment router le prompt vers
 * l'agent (typiquement `session.prompt` avec un agent "build" dédié).
 */
export function CommentPanel(props: {
  artifactId: string
  state: CommentState
  entryFile: string
  targetElementId: string | undefined
  /** Phase 8.1 — rect du pick en cours, attaché au commentaire créé pour que son épingle sache où se dessiner. */
  targetRect: CommentTargetRect | undefined
  /** Phase 8.1 — id du commentaire à faire défiler en vue (clic sur une épingle). */
  highlightedCommentId: string | undefined
  onChange: (state: CommentState) => void
  onSendBatch: (prompt: string) => void
  onSendOne: (prompt: string) => void
}): JSX.Element {
  const [editingId, setEditingId] = createSignal<string | undefined>()
  const [draft, setDraft] = createSignal("")
  const [popoverOpen, setPopoverOpen] = createSignal(false)
  const [sending, setSending] = createSignal(false)
  const rowRefs = new Map<string, HTMLLIElement>()

  createEffect(() => {
    const id = props.highlightedCommentId
    if (!id) return
    rowRefs.get(id)?.scrollIntoView({ behavior: "smooth", block: "nearest" })
  })

  const open = createMemo(() => openComments(props.state))
  const sent = createMemo(() => props.state.comments.filter((c) => c.status === "sent"))
  const resolved = createMemo(() => props.state.comments.filter((c) => c.status === "resolved"))
  const allForElement = createMemo(() =>
    props.targetElementId ? commentsForElement(props.state, props.targetElementId) : [],
  )

  function add(note: string): void {
    if (!props.targetElementId) return
    const comment: DesignComment = {
      id: crypto.randomUUID(),
      artifactId: props.artifactId,
      elementId: props.targetElementId,
      note,
      status: "open",
      createdAt: new Date().toISOString(),
      rect: props.targetRect,
    }
    props.onChange(addComment(props.state, comment))
    setPopoverOpen(false)
  }

  function sendOne(commentId: string): void {
    const c = props.state.comments.find((x) => x.id === commentId)
    if (!c || !canSend(c)) return
    const prompt = buildRefineBatchPrompt({
      artifactId: props.artifactId,
      entryFile: props.entryFile,
      comments: { comments: [c] },
    })
    setSending(true)
    props.onSendOne(prompt)
    props.onChange(markSent(props.state, commentId))
    setSending(false)
  }

  function sendBatch(): void {
    if (open().length === 0) return
    const prompt = buildRefineBatchPrompt({
      artifactId: props.artifactId,
      entryFile: props.entryFile,
      comments: props.state,
    })
    setSending(true)
    props.onSendBatch(prompt)
    // Marque tous les open comme sent
    let next = props.state
    for (const c of open()) {
      next = markSent(next, c.id)
    }
    props.onChange(next)
    setSending(false)
  }

  return (
    <div class="flex flex-col gap-3" data-comment-panel data-comment-panel-artifact={props.artifactId}>
      <div class="flex items-center justify-between">
        <h2 class="text-14-medium">Commentaires</h2>
        <Show when={props.targetElementId}>
          <button
            type="button"
            class="rounded border border-border-base px-2 py-1 text-12-medium"
            data-comment-panel-add
            onClick={() => setPopoverOpen((v) => !v)}
            disabled={!props.targetElementId}
          >
            Ajouter
          </button>
        </Show>
      </div>
      <Show when={!props.targetElementId}>
        <p class="text-12-regular text-text-weak" data-comment-panel-no-target>
          Sélectionnez un élément du rendu pour y attacher un commentaire.
        </p>
      </Show>
      <CommentPopover
        open={popoverOpen()}
        artifactId={props.artifactId}
        elementId={props.targetElementId ?? ""}
        onCreate={(c) => add(c.note)}
        onClose={() => setPopoverOpen(false)}
      />
      <Show when={allForElement().length > 0}>
        <p class="text-12-regular text-text-weak" data-comment-panel-element-count>
          {allForElement().length} commentaire(s) sur <code class="font-mono">{props.targetElementId}</code>
        </p>
      </Show>
      <Show when={open().length > 0}>
        <section data-comment-section="open">
          <div class="flex items-center justify-between">
            <h3 class="text-12-medium uppercase tracking-wide text-text-weak">Ouverts ({open().length})</h3>
            <button
              type="button"
              class="rounded bg-primary px-2 py-1 text-12-medium text-primary-foreground disabled:opacity-50"
              data-comment-panel-send-all
              disabled={open().length === 0 || sending()}
              onClick={() => sendBatch()}
              title="Construit le prompt via buildRefineBatchPrompt et l'envoie à l'agent (P20)"
            >
              {sending() ? "Envoi…" : `Envoyer ${open().length} à l'agent`}
            </button>
          </div>
          <ul class="mt-2 flex flex-col gap-2">
            <For each={open()}>
              {(c) => (
                <li
                  ref={(element) => rowRefs.set(c.id, element)}
                  class="rounded border p-2"
                  classList={{
                    "border-border-focus bg-background-base": props.highlightedCommentId === c.id,
                    "border-border-base bg-background-stronger": props.highlightedCommentId !== c.id,
                  }}
                  data-comment-row={c.id}
                  data-comment-row-status={c.status}
                >
                  <div class="flex items-center justify-between gap-2">
                    <span class="text-10-regular text-text-weak">{c.elementId}</span>
                    <div class="flex items-center gap-1">
                      <button
                        type="button"
                        class="rounded bg-primary px-1 text-10-medium text-primary-foreground disabled:opacity-50"
                        data-comment-row-send-one
                        title="Envoyer ce commentaire ciblé uniquement (markSent après)"
                        onClick={() => sendOne(c.id)}
                      >
                        Envoyer
                      </button>
                      <button
                        type="button"
                        class="rounded px-1 text-10-regular text-text-weak hover:text-text-base"
                        data-comment-row-resolve
                        onClick={() => props.onChange(markResolved(props.state, c.id))}
                      >
                        Résoudre
                      </button>
                      <button
                        type="button"
                        class="rounded px-1 text-10-regular text-text-weak hover:text-text-danger"
                        data-comment-row-delete
                        onClick={() => props.onChange(removeComment(props.state, c.id))}
                      >
                        Supprimer
                      </button>
                    </div>
                  </div>
                  <Show when={editingId() === c.id} fallback={<p class="mt-1 text-12-regular">{c.note}</p>}>
                    <textarea
                      class="mt-1 min-h-12 w-full rounded border border-border-base bg-background-base p-1 font-mono text-12-regular"
                      data-comment-row-edit-textarea
                      value={draft()}
                      onInput={(e) => setDraft(e.currentTarget.value)}
                    />
                    <div class="mt-1 flex justify-end gap-1">
                      <button type="button" class="rounded px-1 text-10-regular" onClick={() => setEditingId(undefined)}>
                        Annuler
                      </button>
                      <button
                        type="button"
                        class="rounded px-1 text-10-regular"
                        data-comment-row-edit-save
                        onClick={() => {
                          props.onChange(updateComment(props.state, c.id, draft()))
                          setEditingId(undefined)
                        }}
                      >
                        Sauver
                      </button>
                    </div>
                  </Show>
                </li>
              )}
            </For>
          </ul>
        </section>
      </Show>
      <Show when={sent().length > 0}>
        <section data-comment-section="sent">
          <h3 class="text-12-medium uppercase tracking-wide text-text-weak">Envoyés ({sent().length})</h3>
          <ul class="mt-2 flex flex-col gap-2">
            <For each={sent()}>
              {(c) => (
                <li class="rounded border border-border-base bg-background-base p-2 opacity-70" data-comment-row={c.id} data-comment-row-status={c.status}>
                  <p class="text-10-regular text-text-weak">{c.elementId}</p>
                  <p class="mt-1 text-12-regular">{c.note}</p>
                </li>
              )}
            </For>
          </ul>
        </section>
      </Show>
      <Show when={resolved().length > 0}>
        <section data-comment-section="resolved">
          <h3 class="text-12-medium uppercase tracking-wide text-text-weak">Résolus ({resolved().length})</h3>
          <ul class="mt-2 flex flex-col gap-1">
            <For each={resolved()}>
              {(c) => (
                <li class="text-12-regular text-text-weak" data-comment-row={c.id} data-comment-row-status={c.status}>
                  {c.elementId} — {c.note}
                </li>
              )}
            </For>
          </ul>
        </section>
      </Show>
      <Show when={open().length === 0 && sent().length === 0 && resolved().length === 0}>
        <p class="text-12-regular text-text-weak" data-comment-panel-empty>
          Aucun commentaire pour l'instant.
        </p>
      </Show>
      <Show when={props.state === EMPTY_COMMENT_STATE}>
        <span data-comment-state="empty" class="hidden" />
      </Show>
    </div>
  )
}
