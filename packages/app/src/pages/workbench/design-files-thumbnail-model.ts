/* SPDX-License-Identifier: MIT */

/**
 * Phase 7.2 — pure pieces of the file-list thumbnail feature: what a
 * thumbnail *is* (`ThumbnailPreview`), how a non-renderable file's text
 * preview is derived (`firstTextLines`), and the concurrency primitive
 * that keeps generation from stalling the list (`createSequentialQueue`).
 * The DOM/Solid wiring that actually renders a thumbnail through the
 * hidden iframe + snapshot bridge lives in `design-files-thumbnail.tsx`.
 */

export type ThumbnailPreview =
  | { kind: "image"; dataUrl: string }
  | { kind: "text"; lines: readonly string[] }
  | { kind: "error" }

export const THUMBNAIL_TEXT_LINE_COUNT = 2
export const THUMBNAIL_TEXT_LINE_MAX_CHARS = 80

/**
 * First `count` lines of `content`, each capped at `maxChars` (with a
 * trailing ellipsis) so one absurdly long line — a minified bundle, say —
 * can't blow up a list row's height.
 */
export function firstTextLines(
  content: string,
  count: number = THUMBNAIL_TEXT_LINE_COUNT,
  maxChars: number = THUMBNAIL_TEXT_LINE_MAX_CHARS,
): readonly string[] {
  return content
    .split(/\r\n|\r|\n/)
    .slice(0, count)
    .map((line) => (line.length > maxChars ? `${line.slice(0, maxChars)}…` : line))
}

/**
 * Strictly one-at-a-time async task queue.
 *
 * Firing one thumbnail generation per visible row concurrently for a
 * 50-file list would mount dozens of hidden iframes at once and stall the
 * scroll — the porte this phase is built against. Every generation
 * request is funneled through a single shared queue that runs exactly one
 * task at a time, in submission order. A task that throws never blocks
 * the ones queued behind it — `tail` is normalized to a never-rejecting
 * promise precisely so the chain keeps advancing regardless of individual
 * task outcomes.
 */
export type SequentialQueue = {
  enqueue<T>(task: () => Promise<T>): Promise<T>
  readonly pending: () => number
}

export function createSequentialQueue(): SequentialQueue {
  let tail: Promise<void> = Promise.resolve()
  let pendingCount = 0

  function enqueue<T>(task: () => Promise<T>): Promise<T> {
    pendingCount += 1
    const started = tail.then(task)
    // `.finally()` would work except its *own* returned promise also
    // rejects when `started` does, and nothing would observe that — an
    // unhandled rejection. A two-branch `.then()` that returns normally
    // on both paths settles its own promise, so it's unhandled-safe; it's
    // attached directly to `started` (not one level removed, as `tail`'s
    // normalization is) so the decrement lands in the same reaction
    // ordering a caller's `await started` observes.
    tail = started.then(
      () => undefined,
      () => undefined,
    )
    started.then(
      () => {
        pendingCount -= 1
      },
      () => {
        pendingCount -= 1
      },
    )
    return started
  }

  return { enqueue, pending: () => pendingCount }
}
