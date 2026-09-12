/* SPDX-License-Identifier: MIT */

import { Show, createSignal, type JSX } from "solid-js"
import { newCommentId, type DesignComment } from "@unifia/workbench-shell"

/**
 * P19 — Popover de saisie d'un commentaire attaché à un élément
 * (identifié par son `data-unifia-id`).
 *
 * Le composant est *controlled* : `open`, `onClose`, `onCreate` sont
 * fournis par le parent (panneau ou toolbar). Le state local se limite
 * à la note en cours de saisie. Pas d'i18n pour l'instant — les
 * chaînes sont en français en dur (runbook P19 ne mentionne pas
 * l'i18n pour ces UI, et le test parity.test.ts ne couvre pas ces
 * clés ; on pourra i18n-er plus tard si besoin).
 */
export function CommentPopover(props: {
  open: boolean
  artifactId: string
  elementId: string
  onCreate: (comment: DesignComment) => void
  onClose: () => void
}): JSX.Element {
  const [note, setNote] = createSignal("")
  function submit(): void {
    const value = note().trim()
    if (!value) return
    const comment: DesignComment = {
      id: newCommentId(),
      artifactId: props.artifactId,
      elementId: props.elementId,
      note: value,
      status: "open",
      createdAt: new Date().toISOString(),
    }
    props.onCreate(comment)
    setNote("")
    props.onClose()
  }
  return (
    <Show when={props.open}>
      <div
        class="flex flex-col gap-2 rounded-lg border border-border-base bg-background-stronger p-3 shadow-md"
        data-comment-popover
        data-comment-popover-element={props.elementId}
        role="dialog"
        aria-label="Nouveau commentaire"
      >
        <p class="text-12-medium" data-comment-popover-target>
          Cible : <code class="font-mono">{props.elementId}</code>
        </p>
        <textarea
          class="min-h-16 w-full resize-none rounded border border-border-base bg-background-base p-2 font-mono text-12-regular"
          data-comment-popover-textarea
          placeholder="Décrivez la modification souhaitée… (Ctrl+Entrée pour envoyer)"
          value={note()}
          onInput={(event) => setNote(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
              event.preventDefault()
              submit()
            } else if (event.key === "Escape") {
              event.preventDefault()
              props.onClose()
            }
          }}
          autofocus
        />
        <div class="flex items-center justify-end gap-2">
          <button
            type="button"
            class="rounded border border-border-base px-2 py-1 text-12-regular"
            data-comment-popover-cancel
            onClick={() => props.onClose()}
          >
            Annuler
          </button>
          <button
            type="button"
            class="rounded bg-primary px-2 py-1 text-12-medium text-primary-foreground disabled:opacity-50"
            data-comment-popover-submit
            disabled={note().trim().length === 0}
            onClick={() => submit()}
          >
            Ajouter
          </button>
        </div>
      </div>
    </Show>
  )
}
