/* SPDX-License-Identifier: MIT */

/**
 * Phase 10.4 — pure helpers for composer file attachments.
 *
 * Upload itself (`createFiles`, the same route Phase 7.3's file tab
 * uses) and preview-URL creation (`URL.createObjectURL`) are I/O and
 * live in `WorkbenchThread`, which the parent (`design-surface.tsx`)
 * feeds through the `files.upload` prop. Everything list-shaped —
 * adding an attachment, transitioning its status, building the prompt
 * reference — is pure and lives here, same split as `PendingSend` in
 * `workbench-thread-shared.ts`.
 */

export type ComposerAttachmentStatus = "uploading" | "uploaded" | "error"

export type ComposerAttachment = {
  id: string
  name: string
  status: ComposerAttachmentStatus
  /** Workspace-relative path, set once the upload succeeds. */
  path?: string
  /** Set once the upload fails. */
  error?: string
  /** Object URL for an image preview thumbnail; undefined for non-image files. */
  previewUrl?: string
}

export function addComposerAttachment(
  list: readonly ComposerAttachment[],
  attachment: ComposerAttachment,
): readonly ComposerAttachment[] {
  return [...list, attachment]
}

/** No-op (same reference) if `id` isn't in the list. */
export function markComposerAttachmentUploaded(
  list: readonly ComposerAttachment[],
  id: string,
  path: string,
): readonly ComposerAttachment[] {
  if (!list.some((a) => a.id === id)) return list
  return list.map((a) => (a.id === id ? { ...a, status: "uploaded" as const, path, error: undefined } : a))
}

/** No-op (same reference) if `id` isn't in the list. */
export function markComposerAttachmentFailed(
  list: readonly ComposerAttachment[],
  id: string,
  error: string,
): readonly ComposerAttachment[] {
  if (!list.some((a) => a.id === id)) return list
  return list.map((a) => (a.id === id ? { ...a, status: "error" as const, error } : a))
}

/** No-op (same reference) if `id` isn't in the list. */
export function removeComposerAttachment(
  list: readonly ComposerAttachment[],
  id: string,
): readonly ComposerAttachment[] {
  if (!list.some((a) => a.id === id)) return list
  return list.filter((a) => a.id !== id)
}

/**
 * The block appended to the outgoing message so the agent can locate
 * the attached file(s) by workspace-relative path. Only "uploaded"
 * attachments are referenced — an attachment still "uploading" or that
 * failed has no path to give the agent, so it's silently excluded (the
 * composer gates Send while any attachment is still uploading; a
 * failed one stays visible with its own error until removed or retried).
 * Returns "" when there's nothing to reference, so the caller only
 * appends when non-empty (same contract as `buildAttachedCommentsPrompt`).
 */
export function buildAttachmentReferences(list: readonly ComposerAttachment[]): string {
  const uploaded = list.filter(
    (a): a is ComposerAttachment & { path: string } => a.status === "uploaded" && a.path !== undefined,
  )
  if (uploaded.length === 0) return ""
  return ["Attached files:", ...uploaded.map((a) => `- ${a.path}`)].join("\n")
}

const UNSAFE_FILENAME_CHARS = /[^A-Za-z0-9._-]/g

/** Replaces every character outside a conservative safe set with "_" — no path separators, no leading dot-dot, no spaces to fight quoting. */
export function sanitizeAttachmentFilename(name: string): string {
  const base = name.split(/[/\\]/).pop() || "file"
  const sanitized = base.replace(UNSAFE_FILENAME_CHARS, "_")
  return sanitized || "file"
}

/**
 * Namespaces every attachment under `attachments/`, prefixed by a
 * timestamp — `createFiles` refuses (EEXIST) on a path that already
 * exists, and two attachments named "photo.png" from two different
 * messages must not collide.
 */
export function buildAttachmentPath(name: string, now: number = Date.now()): string {
  return `attachments/${now}-${sanitizeAttachmentFilename(name)}`
}
