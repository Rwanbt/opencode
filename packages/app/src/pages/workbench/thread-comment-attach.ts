/* SPDX-License-Identifier: MIT */

import type { DesignComment } from "@unifia/workbench-shell"

/**
 * Phase 10.3 — pure helpers for "Commenter la conversation".
 *
 * `attachedIds` is deliberately NOT a field on `CommentState` (see
 * `design-surface.tsx`'s doc comment on `attachedCommentIds`): it's an
 * ephemeral, per-composer-draft selection of "which comments ride along
 * with my next message", not a property of the comment itself. Keeping
 * it as a sibling `Set<string>` means it never needs to be persisted,
 * migrated, or reasoned about by `design-comment-store.ts`.
 */

/**
 * Splits every comment in the workspace into "Attachés" (its id is in
 * `attachedIds`) and "Enregistrés" (everything else) — the two sections
 * `ThreadCommentAttachPanel` renders. Order within each group is
 * preserved from `comments`.
 */
export function partitionAttachedComments(
  comments: readonly DesignComment[],
  attachedIds: ReadonlySet<string>,
): { attached: readonly DesignComment[]; saved: readonly DesignComment[] } {
  const attached: DesignComment[] = []
  const saved: DesignComment[] = []
  for (const comment of comments) {
    if (attachedIds.has(comment.id)) attached.push(comment)
    else saved.push(comment)
  }
  return { attached, saved }
}

/**
 * Toggles a single comment id in/out of the attached set. Always
 * returns a new Set (never mutates `ids`), matching the Solid signal
 * update convention used everywhere else in this codebase
 * (`setState((prev) => reducer(prev, ...))`).
 */
export function toggleAttachedCommentId(ids: ReadonlySet<string>, commentId: string): ReadonlySet<string> {
  const next = new Set(ids)
  if (next.has(commentId)) next.delete(commentId)
  else next.add(commentId)
  return next
}
